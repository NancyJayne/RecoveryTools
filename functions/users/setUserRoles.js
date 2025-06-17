
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
  async (data, context) => {
    if (!context.auth || !context.auth.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can assign roles.");
    }

    const { uid, roles } = data;

    if (!uid || typeof roles !== "object") {
      throw new HttpsError("invalid-argument", "Missing uid or roles object.");
    }

    try {
      await admin.auth().setCustomUserClaims(uid, roles);
      return {
        success: true,
        uid,
        roles,
        message: `Roles updated for UID: ${uid}`,
      };
    } catch (error) {
      console.error("Error setting roles:", error);
      throw new HttpsError("internal", error.message);
    }
  },
);
