import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
if (!admin.apps.length) admin.initializeApp();

export const getReferralStats = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Login required.");

    const snapshot = await admin.firestore().collection("referrals")
      .where("referrerUid", "==", uid).get();

    const stats = {
      tool: { click: 0, conversion: 0 },
      course: { click: 0, conversion: 0 },
      workshop: { click: 0, conversion: 0 },
    };

    snapshot.forEach((doc) => {
      const { type, event } = doc.data();
      if (stats[type] && stats[type][event] !== undefined) {
        stats[type][event]++;
      }
    });

    return { stats };
  },
);