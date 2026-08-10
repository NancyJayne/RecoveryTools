import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

function serializeTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

export const getEmailLogs = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can view email logs.");
    }

    const limit = Math.min(Number(request.data?.limit || 50), 200);
    const userId = String(request.data?.userId || "").trim();
    const email = String(request.data?.email || "").trim().toLowerCase();
    const snapshot = await admin
      .firestore()
      .collection("emailLogs")
      .orderBy("createdAt", "desc")
      .limit(userId || email ? 200 : limit)
      .get();

    const docs = snapshot.docs.filter((doc) => {
      if (!userId && !email) return true;
      const data = doc.data();
      const recipients = Array.isArray(data.to) ? data.to : [data.to];
      return (userId && data.userId === userId) ||
        (email && recipients.some((recipient) => String(recipient || "").toLowerCase() === email));
    }).slice(0, limit);

    return {
      logs: docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: serializeTimestamp(data.createdAt),
          updatedAt: serializeTimestamp(data.updatedAt),
        };
      }),
    };
  },
);
