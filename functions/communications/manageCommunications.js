import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import { getBusinessProfile } from "../utils/businessProfile.js";
import { logEmailEvent } from "../utils/emailLog.js";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const clean = (value, max = 5000) => String(value || "").trim().slice(0, max);
const timestamp = (value) => value?.toDate?.().toISOString?.() || null;

function useSendGridSandboxMode() {
  if (process.env.SENDGRID_SANDBOX_MODE !== undefined) {
    return process.env.SENDGRID_SANDBOX_MODE === "true";
  }
  return process.env.FUNCTIONS_EMULATOR === "true";
}

function useLocalEmailSandbox() {
  return process.env.FUNCTIONS_EMULATOR === "true" && useSendGridSandboxMode();
}

function requireAdmin(request) {
  if (!request.auth?.token?.admin) {
    throw new HttpsError("permission-denied", "Only admins can manage communications.");
  }
}

function serializeDoc(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    createdAt: timestamp(data.createdAt),
    updatedAt: timestamp(data.updatedAt),
    lastMessageAt: timestamp(data.lastMessageAt),
    readAt: timestamp(data.readAt),
    resolvedAt: timestamp(data.resolvedAt),
  };
}

export const getCommunications = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    requireAdmin(request);
    const requestedLimit = Math.min(Math.max(Number(request.data?.limit || 100), 1), 200);
    const userId = clean(request.data?.userId, 200);
    let query = db.collection("communications");
    if (userId) query = query.where("userId", "==", userId);
    const snapshot = await query.orderBy("lastMessageAt", "desc").limit(requestedLimit).get();
    const communications = await Promise.all(snapshot.docs.map(async (communicationDoc) => {
      const messageSnapshot = await communicationDoc.ref.collection("messages")
        .orderBy("createdAt", "asc")
        .limit(100)
        .get();
      return {
        ...serializeDoc(communicationDoc),
        messages: messageSnapshot.docs.map(serializeDoc),
      };
    }));
    return { communications };
  },
);

export const getCommunicationSummary = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    requireAdmin(request);
    const snapshot = await db.collection("communications")
      .where("unreadByAdmin", "==", true)
      .limit(100)
      .get();
    return { unread: snapshot.size };
  },
);

export const getCommunicationLinkOptions = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    requireAdmin(request);
    const [usersSnapshot, ordersSnapshot] = await Promise.all([
      db.collection("users").limit(500).get(),
      db.collection("orders").limit(500).get(),
    ]);
    return {
      users: usersSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          name: clean(data.name || data.displayName || data.fullName, 200),
          email: clean(data.email, 320),
        };
      }).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
      orders: ordersSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          customerName: clean(data.userName || data.customerName || data.customer?.name, 200),
          customerEmail: clean(data.userEmail || data.customerEmail || data.email || data.customer?.email, 320),
        };
      }),
    };
  },
);

export const updateCommunication = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    requireAdmin(request);
    const communicationId = clean(request.data?.communicationId, 200);
    if (!communicationId) throw new HttpsError("invalid-argument", "Communication is required.");
    const ref = db.collection("communications").doc(communicationId);
    const existing = await ref.get();
    if (!existing.exists) throw new HttpsError("not-found", "Communication not found.");

    const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    const allowedStatuses = new Set(["new", "open", "waiting", "resolved", "archived"]);
    if (request.data?.status !== undefined) {
      const status = clean(request.data.status, 30);
      if (!allowedStatuses.has(status)) throw new HttpsError("invalid-argument", "Invalid status.");
      update.status = status;
      update.resolvedAt = status === "resolved"
        ? admin.firestore.FieldValue.serverTimestamp()
        : admin.firestore.FieldValue.delete();
    }
    if (request.data?.unreadByAdmin !== undefined) {
      update.unreadByAdmin = request.data.unreadByAdmin === true;
      if (!update.unreadByAdmin) {
        update.readAt = admin.firestore.FieldValue.serverTimestamp();
        update.readByUid = request.auth.uid;
      }
    }
    if (request.data?.assignment === "self") {
      update.assignedToUid = request.auth.uid;
      update.assignedToName = clean(request.auth.token?.name || request.auth.token?.email, 200);
    } else if (request.data?.assignment === "unassigned") {
      update.assignedToUid = "";
      update.assignedToName = "";
    }
    if (Array.isArray(request.data?.orderIds)) {
      const orderIds = [...new Set(request.data.orderIds.map((id) => clean(id, 200)).filter(Boolean))].slice(0, 20);
      const orderSnapshots = await Promise.all(orderIds.map((orderId) => db.collection("orders").doc(orderId).get()));
      const missingOrderIds = orderSnapshots.filter((snapshot) => !snapshot.exists).map((snapshot) => snapshot.id);
      if (missingOrderIds.length) {
        throw new HttpsError("invalid-argument", `Order not found: ${missingOrderIds.join(", ")}`);
      }
      update.orderIds = orderIds;
    }
    if (request.data?.userId !== undefined) {
      const userId = clean(request.data.userId, 200);
      if (userId && !(await db.collection("users").doc(userId).get()).exists) {
        throw new HttpsError("invalid-argument", "User not found.");
      }
      update.userId = userId;
    }

    const note = clean(request.data?.note, 10000);
    const batch = db.batch();
    batch.update(ref, update);
    if (note) {
      const noteRef = ref.collection("messages").doc();
      batch.set(noteRef, {
        direction: "internal",
        source: "admin_note",
        bodyText: note,
        internal: true,
        sentByUid: request.auth.uid,
        sentByEmail: clean(request.auth.token?.email, 320),
        sentByName: clean(request.auth.token?.name, 200),
        deliveryStatus: "not_applicable",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      batch.update(ref, { lastMessageAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    await batch.commit();
    return { success: true };
  },
);

export const replyToCommunication = onCall(
  {
    region: "australia-southeast1",
    secrets: [SENDGRID_API_KEY],
  },
  async (request) => {
    requireAdmin(request);
    const communicationId = clean(request.data?.communicationId, 200);
    const bodyText = clean(request.data?.bodyText, 20000);
    if (!communicationId || !bodyText) {
      throw new HttpsError("invalid-argument", "Communication and reply are required.");
    }
    const communicationRef = db.collection("communications").doc(communicationId);
    const communicationSnapshot = await communicationRef.get();
    if (!communicationSnapshot.exists) throw new HttpsError("not-found", "Communication not found.");
    const communication = communicationSnapshot.data();
    const to = clean(communication.contactEmail, 320);
    if (!to) throw new HttpsError("failed-precondition", "This communication has no reply email.");
    const business = await getBusinessProfile();
    const subjectBase = clean(communication.subject, 500) || "Your enquiry";
    const subject = /^re:/i.test(subjectBase) ? subjectBase : `Re: ${subjectBase}`;
    const localSandbox = useLocalEmailSandbox();
    const sendGridSandbox = useSendGridSandboxMode();
    const messageRef = communicationRef.collection("messages").doc();
    await messageRef.set({
      direction: "outbound",
      source: "admin_reply",
      fromEmail: business.email,
      toEmail: to,
      subject,
      bodyText,
      sentByUid: request.auth.uid,
      sentByEmail: clean(request.auth.token?.email, 320),
      sentByName: clean(request.auth.token?.name, 200),
      deliveryStatus: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    let status = localSandbox ? "sandboxed" : "sent";
    let errorMessage = "";
    try {
      if (!localSandbox) {
        sgMail.setApiKey(SENDGRID_API_KEY.value());
        await sgMail.send({
          to,
          from: business.sender,
          replyTo: business.email,
          subject,
          text: bodyText,
          mailSettings: { sandboxMode: { enable: sendGridSandbox } },
        });
      }
    } catch (error) {
      status = "failed";
      errorMessage = error.message || "SendGrid error";
    }
    const emailLogId = await logEmailEvent({
      type: "communication_reply",
      status,
      to,
      subject,
      orderId: communication.orderIds?.[0] || "",
      userId: communication.userId || "",
      providerMode: localSandbox
        ? "local-sandbox"
        : sendGridSandbox ? "sendgrid-sandbox" : "live",
      errorMessage,
      sentByUid: request.auth.uid,
      sentByEmail: request.auth.token?.email,
      metadata: { communicationId, communicationMessageId: messageRef.id },
    });
    await Promise.all([
      messageRef.update({ deliveryStatus: status, emailLogId, errorMessage }),
      communicationRef.update({
        status: status === "failed" ? "open" : "waiting",
        unreadByAdmin: false,
        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }),
    ]);
    if (status === "failed") throw new HttpsError("internal", "The reply was saved but the email failed to send.");
    return { success: true, sandboxed: localSandbox || sendGridSandbox };
  },
);
