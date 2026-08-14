import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import fetch from "node-fetch";
import { getBusinessProfile } from "../utils/businessProfile.js";
import { logEmailEvent } from "../utils/emailLog.js";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const RECAPTCHA_SECRET_KEY = defineSecret("RECAPTCHA_SECRET_KEY");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const clean = (value, max) => String(value || "").trim().slice(0, max);
const escapeHTML = (value) => clean(value, 20000).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
}[character]));

function localSandbox() {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

async function matchingUserId(email) {
  const normalized = email.toLowerCase();
  for (const field of ["emailNormalized", "email"]) {
    const snapshot = await db.collection("users").where(field, "==", normalized).limit(2).get();
    if (snapshot.size === 1) return snapshot.docs[0].id;
  }
  return "";
}

async function saveCommunication({ name, email, message, recaptchaScore, verified, authenticatedUserId }) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const communicationRef = db.collection("communications").doc();
  const legacyRef = db.collection("contactMessages").doc(communicationRef.id);
  const messageRef = communicationRef.collection("messages").doc();
  let userId = clean(authenticatedUserId, 200);
  if (userId && !(await db.collection("users").doc(userId).get()).exists) userId = "";
  if (!userId) userId = await matchingUserId(email);
  const batch = db.batch();
  batch.set(communicationRef, {
    type: "contact",
    channel: "email",
    subject: `Website contact from ${name}`,
    contactName: name,
    contactNameSearch: name.toLowerCase(),
    contactEmail: email,
    contactEmailNormalized: email.toLowerCase(),
    userId,
    orderIds: [],
    status: "new",
    assignedToUid: "",
    assignedToName: "",
    unreadByAdmin: true,
    priority: "normal",
    source: "contact_form",
    recaptchaScore: recaptchaScore ?? null,
    verified,
    adminNotificationStatus: "pending",
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  });
  batch.set(messageRef, {
    direction: "inbound",
    source: "contact_form",
    fromName: name,
    fromEmail: email,
    subject: `Website contact from ${name}`,
    bodyText: message,
    internal: false,
    deliveryStatus: "received",
    createdAt: now,
  });
  // Retain the legacy record during the additive rollout.
  batch.set(legacyRef, {
    communicationId: communicationRef.id,
    name,
    email,
    message,
    recaptchaScore: recaptchaScore ?? null,
    verified,
    createdAt: now,
  });
  await batch.commit();
  return { communicationRef, messageRef, userId };
}

const sendContactMessageHandler = async (request) => {
  const name = clean(request.data?.name, 200);
  const email = clean(request.data?.email, 320).toLowerCase();
  const message = clean(request.data?.message, 20000);
  const token = clean(request.data?.token, 5000);
  if (!name || !email || !message || (!token && !localSandbox())) {
    throw new HttpsError("invalid-argument", "Missing required fields.");
  }

  let recaptchaScore = null;
  if (!localSandbox()) {
    const recaptchaKey = RECAPTCHA_SECRET_KEY.value();
    if (!recaptchaKey) throw new HttpsError("internal", "Server configuration error.");
    const verifyResponse = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: recaptchaKey, response: token }).toString(),
    });
    const verification = await verifyResponse.json();
    recaptchaScore = verification.score ?? null;
    if (!verification.success || Number(recaptchaScore || 0) < 0.5) {
      await db.collection("contactMessages").add({
        name, email, message, recaptchaScore, verified: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      throw new HttpsError("permission-denied", "Failed CAPTCHA verification.");
    }
  }

  // Persist the inbox record before attempting the notification email.
  const { communicationRef, messageRef, userId } = await saveCommunication({
    name,
    email,
    message,
    recaptchaScore,
    verified: !localSandbox(),
    authenticatedUserId: request.auth?.uid,
  });
  const business = await getBusinessProfile();
  const subject = `Contact message from ${name}`;
  let notificationStatus = localSandbox() ? "sandboxed" : "sent";
  let notificationError = "";
  try {
    if (!localSandbox()) {
      const sendgridKey = SENDGRID_API_KEY.value();
      if (!sendgridKey) throw new Error("Missing SendGrid API key.");
      sgMail.setApiKey(sendgridKey);
      await sgMail.send({
        to: business.adminNotificationEmail,
        from: business.sender,
        replyTo: email,
        subject,
        text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
        html: `<p><strong>Name:</strong> ${escapeHTML(name)}</p>` +
          `<p><strong>Email:</strong> ${escapeHTML(email)}</p>` +
          `<p><strong>Message:</strong></p><p>${escapeHTML(message).replace(/\n/g, "<br>")}</p>`,
      });
    }
  } catch (error) {
    notificationStatus = "failed";
    notificationError = error.message || "SendGrid error";
    console.error("Contact notification failed; communication remains in admin inbox:", error);
  }
  const emailLogId = await logEmailEvent({
    type: "contact_admin_notification",
    status: notificationStatus,
    to: business.adminNotificationEmail,
    subject,
    userId,
    providerMode: localSandbox() ? "local-sandbox" : "live",
    errorMessage: notificationError,
    metadata: { communicationId: communicationRef.id, communicationMessageId: messageRef.id },
  });
  await communicationRef.update({
    adminNotificationStatus: notificationStatus,
    adminNotificationError: notificationError,
    adminNotificationEmailLogId: emailLogId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return {
    success: true,
    communicationId: communicationRef.id,
    sandboxed: localSandbox(),
    adminNotified: notificationStatus !== "failed",
  };
};

export const sendContactMessage = onCall({
  region: "australia-southeast1",
  secrets: [SENDGRID_API_KEY, RECAPTCHA_SECRET_KEY],
}, sendContactMessageHandler);
