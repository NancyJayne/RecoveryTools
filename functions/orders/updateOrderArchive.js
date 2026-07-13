import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function adminDisplayName(request) {
  return (
    cleanString(request.auth?.token?.name) ||
    cleanString(request.auth?.token?.email) ||
    cleanString(request.auth?.uid) ||
    "Admin"
  );
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== ""),
  );
}

function userIdForOrder(order) {
  return cleanString(order.userId || order.buyerUid || order.uid);
}

function timelineEntry({ type, label, at, byUid, byEmail, byName, metadata = {} }) {
  return compactObject({
    type,
    label,
    at,
    byUid,
    byEmail,
    byName,
    metadata: compactObject(metadata),
  });
}

export const updateOrderArchive = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can archive orders.");
    }

    const { orderId, archived, reason } = request.data || {};
    const cleanOrderId = cleanString(orderId);
    if (!cleanOrderId) {
      throw new HttpsError("invalid-argument", "Missing order ID.");
    }

    const shouldArchive = archived === true;
    const db = admin.firestore();
    const orderRef = db.collection("orders").doc(cleanOrderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new HttpsError("not-found", "Order not found.");
    }

    const order = orderSnap.data();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const timelineAt = admin.firestore.Timestamp.now();
    const adminUid = cleanString(request.auth?.uid);
    const adminEmail = cleanString(request.auth?.token?.email);
    const adminName = adminDisplayName(request);
    const updateData = shouldArchive
      ? {
        archived: true,
        archivedAt: now,
        archiveReason: cleanString(reason) || "manual_admin_archive",
        updatedAt: now,
        timeline: admin.firestore.FieldValue.arrayUnion(timelineEntry({
          type: "archive",
          label: "Order archived manually",
          at: timelineAt,
          byUid: adminUid,
          byEmail: adminEmail,
          byName: adminName,
          metadata: { reason: cleanString(reason) || "manual_admin_archive" },
        })),
      }
      : {
        archived: false,
        unarchivedAt: now,
        archiveReason: "",
        updatedAt: now,
        timeline: admin.firestore.FieldValue.arrayUnion(timelineEntry({
          type: "unarchive",
          label: "Order unarchived manually",
          at: timelineAt,
          byUid: adminUid,
          byEmail: adminEmail,
          byName: adminName,
          metadata: { reason: cleanString(reason) || "manual_admin_unarchive" },
        })),
      };

    const batch = db.batch();
    batch.set(orderRef, updateData, { merge: true });

    const userId = userIdForOrder(order);
    if (userId) {
      batch.set(
        db.collection("users").doc(userId).collection("orders").doc(cleanOrderId),
        updateData,
        { merge: true },
      );
    }

    batch.set(
      db.collection("shipments").doc(`${cleanOrderId}_primary`),
      {
        orderId: cleanOrderId,
        userId,
        ...updateData,
      },
      { merge: true },
    );

    await batch.commit();

    return {
      success: true,
      orderId: cleanOrderId,
      archived: shouldArchive,
    };
  },
);
