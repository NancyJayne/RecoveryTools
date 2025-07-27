import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const getAffiliatePerformance = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Admin access only.");
    }

    try {
      const db = admin.firestore();
      const affiliates = {};

      const affiliateSnap = await db.collection("affiliates").get();
      affiliateSnap.forEach((doc) => {
        affiliates[doc.id] = {
          uid: doc.id,
          ...doc.data(),
          clicks: 0,
          conversions: 0,
          orderCount: 0,
          totalSales: 0,
          totalPayouts: 0,
        };
      });

      const referralSnap = await db.collection("referrals").get();
      referralSnap.forEach((doc) => {
        const { referrerUid, event } = doc.data();
        if (!referrerUid) return;
        if (!affiliates[referrerUid]) {
          affiliates[referrerUid] = {
            uid: referrerUid,
            clicks: 0,
            conversions: 0,
            orderCount: 0,
            totalSales: 0,
            totalPayouts: 0,
          };
        }
        if (event === "click") affiliates[referrerUid].clicks++;
        if (event === "conversion") affiliates[referrerUid].conversions++;
      });

      const ordersSnap = await db
        .collection("orders")
        .where("referredBy", "!=", null)
        .get();
      ordersSnap.forEach((doc) => {
        const { referredBy, total } = doc.data();
        if (!referredBy) return;
        if (!affiliates[referredBy]) {
          affiliates[referredBy] = {
            uid: referredBy,
            clicks: 0,
            conversions: 0,
            orderCount: 0,
            totalSales: 0,
            totalPayouts: 0,
          };
        }
        affiliates[referredBy].orderCount++;
        affiliates[referredBy].totalSales += total || 0;
      });

      const payoutsSnap = await db.collection("affiliatePayouts").get();
      payoutsSnap.forEach((doc) => {
        const { uid, amount } = doc.data();
        if (!uid) return;
        if (!affiliates[uid]) {
          affiliates[uid] = {
            uid,
            clicks: 0,
            conversions: 0,
            orderCount: 0,
            totalSales: 0,
            totalPayouts: 0,
          };
        }
        affiliates[uid].totalPayouts += amount || 0;
      });

      const userDocs = await Promise.all(
        Object.keys(affiliates).map((uid) => db.collection("users").doc(uid).get()),
      );
      userDocs.forEach((doc) => {
        const data = doc.data() || {};
        if (!affiliates[doc.id]) return;
        affiliates[doc.id].name = data.name || data.displayName || "";
        affiliates[doc.id].email = data.email || "";
      });

      return { affiliates: Object.values(affiliates) };
    } catch (err) {
      console.error("Affiliate performance error:", err);
      throw new HttpsError("internal", "Failed to load affiliate performance.");
    }
  },
);
