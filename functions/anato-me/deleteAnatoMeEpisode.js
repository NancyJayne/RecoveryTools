
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * ✅ Admin-only delete function for Anato-Me episode
 */
export const deleteAnatoMeEpisode = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    if (!context.auth || !context.auth.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can delete episodes.");
    }

    const { slug } = data;
    if (!slug) {
      throw new HttpsError("invalid-argument", "Missing slug.");
    }

    try {
      await admin.firestore().doc(`admin/${slug}`).delete();
      return { success: true };
    } catch (err) {
      console.error("Error deleting episode:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
