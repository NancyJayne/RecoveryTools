import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * ✅ Admin-only set user roles function
 */
export const setUserRoles = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError(
        "permission-denied",
        "Only admins can assign roles.",
      );
    }

    const { uid, roles } = request.data || {};

    if (!uid || typeof roles !== "object") {
      throw new HttpsError(
        "invalid-argument",
        "Missing uid or roles object.",
      );
    }

    try {
      const normalizedRoles = {
        admin: !!roles.admin,
        affiliate: !!roles.affiliate,
        therapist: !!roles.therapist,
      };

      await admin.auth().setCustomUserClaims(uid, normalizedRoles);
      await admin.firestore().collection("users").doc(uid).set({
        roles: normalizedRoles,
        rolesUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        rolesUpdatedBy: request.auth.uid,
      }, { merge: true });

      return {
        success: true,
        uid,
        roles: normalizedRoles,
        message: `Roles updated for UID: ${uid}`,
      };
    } catch (error) {
      console.error("Error setting roles:", error);

      throw new HttpsError(
        "internal",
        error.message,
      );
    }
  },
);
