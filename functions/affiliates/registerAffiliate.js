
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * ✅ Register a user as an affiliate
 * Assigns referralCode, creates record in affiliates/{uid}
 */
export const registerAffiliate = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    const uid = context.auth?.uid;
    const email = context.auth?.token?.email;
    if (!uid || !email) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    try {
      const affiliateRef = admin.firestore().collection("affiliates").doc(uid);
      const affiliateSnap = await affiliateRef.get();

      if (affiliateSnap.exists) {
        return { message: "Already registered as an affiliate." };
      }

      const referralCode = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

      await Promise.all([
        affiliateRef.set({
          uid,
          email,
          referralCode,
          joinedAt: admin.firestore.FieldValue.serverTimestamp(),
          earnings: 0,
        }),
        admin.firestore().collection("users").doc(uid).update({
          "roles.affiliate": true,
          referralCode,
        }),
      ]);

      // 🔐 Update custom claims for immediate access
      const { customClaims = {} } = await admin.auth().getUser(uid);
      await admin.auth().setCustomUserClaims(uid, {
        ...customClaims,
        affiliate: true,
        role: "affiliate",
      });

      return { success: true, referralCode };
    } catch (err) {
      console.error("Affiliate registration failed:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
