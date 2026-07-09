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

    const limit = Math.min(Number(request.data?.limit || 50), 100);
    const snapshot = await admin
      .firestore()
      .collection("emailLogs")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return {
      logs: snapshot.docs.map((doc) => {
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
