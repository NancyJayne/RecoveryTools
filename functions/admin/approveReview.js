import { onCall, HttpsError } from "firebase-functions/v2/https"; 
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const approveReview = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    const { productId, reviewId, approve } = data;

    if (!context.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can approve reviews.");
    }

    await admin.firestore().doc(`products/${productId}/reviews/${reviewId}`).update({
      visible: !!approve,
    });

    return { success: true, message: `Review ${approve ? "approved" : "hidden"}.` };
  },
);
