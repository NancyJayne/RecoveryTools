import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * ✅ Register a user as an affiliate
 * Assigns referralCode, creates record in affiliates/{uid},
 * updates custom claims, then updates users/{uid}
 */
export const registerAffiliate = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    const uid = request.auth?.uid;
    const email = request.auth?.token?.email;

    if (!uid || !email) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    try {
      const db = admin.firestore();
      const affiliateRef = db.collection("affiliates").doc(uid);
      const userRef = db.collection("users").doc(uid);

      const affiliateSnap = await affiliateRef.get();

      if (affiliateSnap.exists) {
        return { message: "Already registered as an affiliate." };
      }

      const referralCode = email
        .split("@")[0]
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase();

      const { customClaims = {} } = await admin.auth().getUser(uid);

      const normalizedClaims = {
        admin: !!customClaims.admin,
        affiliate: true,
        therapist: !!customClaims.therapist,
      };

      await affiliateRef.set({
        uid,
        email,
        referralCode,
        businessName: "",
        website: "",
        stripeAccountId: "",
        status: "pending",
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        earnings: 0,
      });

      await admin.auth().setCustomUserClaims(uid, normalizedClaims);

      await userRef.update({
        "roles.admin": normalizedClaims.admin,
        "roles.affiliate": true,
        "roles.therapist": normalizedClaims.therapist,
        referralCode,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, referralCode };
    } catch (err) {
      console.error("Affiliate registration failed:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
