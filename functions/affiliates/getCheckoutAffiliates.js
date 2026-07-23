import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const lower = (value) => String(value ?? "").trim().toLowerCase();

export const getCheckoutAffiliates = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in to select an affiliate.");
    const db = admin.firestore();
    const snapshot = await db.collection("affiliates").get();
    const active = snapshot.docs.filter((doc) => {
      const data = doc.data() || {};
      return ["active", "approved"].includes(lower(data.status)) || data.approved === true;
    });
    const users = await Promise.all(active.map((doc) => {
      const userId = String(doc.data()?.userId || doc.id).trim();
      return userId ? db.collection("users").doc(userId).get() : null;
    }));
    return {
      affiliates: active.map((doc, index) => {
        const data = doc.data() || {};
        const user = users[index]?.exists ? users[index].data() || {} : {};
        return {
          affiliateId: doc.id,
          businessName: data.businessName || user.business?.name || user.businessName ||
            user.name || data.name || data.affiliateCode || doc.id,
        };
      }).sort((left, right) => left.businessName.localeCompare(right.businessName)),
    };
  },
);
