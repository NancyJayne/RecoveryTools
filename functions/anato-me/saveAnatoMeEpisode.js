
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * ✅ Admin-only save or update Anato-Me episode
 */
export const saveAnatoMeEpisode = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    if (!context.auth || !context.auth.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can save episodes.");
    }

    const {
      slug, title, videoUrl, thumbnail, tags, category, storyClean, storyRated,
      reflectionPrompts, relatedProducts, condition, clinicalTips, treatmentSuggestions,
      educationalUse, publicVisible, therapistVisible, isPublished,
    } = data;

    if (!slug || !title || !videoUrl) {
      throw new HttpsError("invalid-argument", "Missing required fields.");
    }

    const episodeRef = admin.firestore().doc(`admin/${slug}`);
    const payload = {
      title,
      videoUrl,
      thumbnail,
      tags,
      category,
      storyClean,
      storyRated,
      reflectionPrompts,
      relatedProducts,
      clinicalCompanion: {
        condition,
        clinicalTips,
        treatmentSuggestions,
        educationalUse,
      },
      publicVisible: !!publicVisible,
      therapistVisible: !!therapistVisible,
      isPublished: !!isPublished,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    try {
      await episodeRef.set(payload, { merge: true });
      return { success: true, slug };
    } catch (err) {
      console.error("Error saving episode:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
