
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 🛠️ Admin: Delete a product
 */
export const deleteProduct = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError(
        "permission-denied",
        "Admin access required.",
      );
    }

    const { id } = request.data || {};

    if (!id) {
      throw new HttpsError(
        "invalid-argument",
        "Missing product ID.",
      );
    }

    try {
      await admin.firestore().collection("products").doc(id).delete();
      return { success: true };
    } catch (err) {
      console.error("Delete product error:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
