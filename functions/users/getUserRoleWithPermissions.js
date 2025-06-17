
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 🔐 Hybrid Approach: Fetch roles + permissions from Firestore
 * Used for advanced role features (e.g., therapist tiers, feature access)
 */
export const getUserRoleWithPermissions = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    if (!context.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    try {
      const doc = await admin.firestore().collection("users").doc(context.auth.uid).get();
      if (!doc.exists) throw new HttpsError("not-found", "User profile not found");

      const { roles = {}, permissions = {} } = doc.data();
      return { uid: context.auth.uid, roles, permissions };
    } catch (err) {
      console.error("Error fetching Firestore user roles/permissions:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
