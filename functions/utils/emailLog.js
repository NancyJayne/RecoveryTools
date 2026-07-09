import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

export async function logEmailEvent({
  type,
  status,
  to,
  subject,
  orderId,
  userId,
  provider = "sendgrid",
  providerMode = "live",
  errorMessage,
  sentByUid,
  sentByEmail,
  metadata = {},
}) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const logData = cleanObject({
    type: cleanString(type) || "transactional",
    status: cleanString(status) || "unknown",
    to: Array.isArray(to) ? to.filter(Boolean) : cleanString(to),
    subject: cleanString(subject),
    orderId: cleanString(orderId),
    userId: cleanString(userId),
    provider,
    providerMode,
    errorMessage: cleanString(errorMessage),
    sentByUid: cleanString(sentByUid),
    sentByEmail: cleanString(sentByEmail),
    metadata,
    createdAt: now,
    updatedAt: now,
  });

  const logRef = await db.collection("emailLogs").add(logData);
  return logRef.id;
}
