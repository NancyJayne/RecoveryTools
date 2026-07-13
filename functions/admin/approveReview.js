import { onCall, HttpsError } from "firebase-functions/v2/https"; 
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const approveReview = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    const { productId, reviewId, approve, action = "" } = request.data || {};

    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can approve reviews.");
    }

    if (!productId || !reviewId) {
      throw new HttpsError("invalid-argument", "Product ID and review ID are required.");
    }

    const cleanAction = String(action || "").toLowerCase().trim();
    const update = {
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedByUid: request.auth.uid,
      reviewedByEmail: request.auth.token.email || "",
    };

    if (cleanAction === "archive") {
      update.visible = false;
      update.status = "archived";
      update.archivedAt = admin.firestore.FieldValue.serverTimestamp();
      update.archivedByUid = request.auth.uid;
      update.archivedByEmail = request.auth.token.email || "";
    } else {
      update.visible = !!approve;
      update.status = approve ? "approved" : "hidden";
    }

    await admin.firestore().doc(`products/${productId}/reviews/${reviewId}`).update(update);

    return { success: true, message: `Review ${update.status}.` };
  },
);
