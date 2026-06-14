
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
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    try {
      const uid = request.auth.uid;

      const doc = await admin.firestore().collection("users").doc(uid).get();

      if (!doc.exists) {
        throw new HttpsError("not-found", "User profile not found");
      }

      const userData = doc.data() || {};

      const {
        roles = {},
        permissions = {},
      } = userData;

      return { uid, roles, permissions };
    } catch (err) {
      console.error("Error fetching Firestore user roles/permissions:", err);

      if (err instanceof HttpsError) {
        throw err;
      }

      throw new HttpsError("internal", err.message);
    }
  },
);