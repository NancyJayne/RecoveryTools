import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 🔍 Admin utility: Fetch user by email or UID
 */
export const getUserByEmailOrUID = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError(
        "permission-denied",
        "Only admins can fetch users.",
      );
    }

    const { email, uid } = request.data || {};

    if (!email && !uid) {
      throw new HttpsError(
        "invalid-argument",
        "Must provide either email or UID.",
      );
    }

    try {
      let user;

      if (uid) {
        user = await admin.auth().getUser(uid);
      } else {
        user = await admin.auth().getUserByEmail(email);
      }

      return {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || null,
        roles: user.customClaims || {},
        disabled: user.disabled || false,
      };
    } catch (err) {
      console.error("Get user failed:", err);

      throw new HttpsError(
        "not-found",
        err.message,
      );
    }
  },
);
