import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
if (!admin.apps.length) admin.initializeApp();

export const getAffiliatePayouts = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Login required.");

    const snapshot = await admin.firestore()
      .collection("affiliatePayouts")
      .where("uid", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(25).get();

    return {
      payouts: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    };
  },
);