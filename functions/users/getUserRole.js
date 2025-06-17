
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * ✅ Fetch current user's custom roles
 */
export const getUserRole = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    if (!context.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    try {
      const user = await admin.auth().getUser(context.auth.uid);
      const roles = user.customClaims || {};
      return { uid: user.uid, roles };
    } catch (err) {
      console.error("Error fetching user role:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
