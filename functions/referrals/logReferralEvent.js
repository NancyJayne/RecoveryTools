import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
if (!admin.apps.length) admin.initializeApp();

export const logReferralEvent = onCall(
  { region: "australia-southeast1" },
  async (data) => {
    const { referrerUid, type, targetId, event } = data;
    if (!referrerUid || !type || !targetId || !["click", "conversion"].includes(event)) {
      throw new HttpsError("invalid-argument", "Missing or invalid referral data.");
    }
    try {
      await admin.firestore().collection("referrals").add({
        referrerUid,
        type,
        targetId,
        event,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true };
    } catch (err) {
      console.error("Referral log error:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);