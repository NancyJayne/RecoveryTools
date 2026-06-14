
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 🔐 Admin-only: Reset a user's password manually
 */
export const adminResetUserPassword = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError(
        "permission-denied",
        "Only admins can reset passwords.",
      );
    }

    const { uid, newPassword } = request.data || {};

    if (!uid || !newPassword) {
      throw new HttpsError("invalid-argument", "Both UID and new password are required.");
    }

    try {
      await admin.auth().updateUser(uid, { password: newPassword });

      console.log(
        `✅ Admin ${request.auth.uid} reset password for UID: ${uid}`,
      );

      return {
        success: true,
        message: `Password successfully updated for user.`,
      };
    } catch (err) {
      console.error("❌ Admin password reset failed:", err);
      throw new HttpsError("internal", err.message || "Failed to reset password.");
    }
  },
);
