
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 🛠️ Admin: Update an existing product
 */
export const updateProduct = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }

    const { id, updates } = data;

    if (!id || typeof updates !== "object") {
      throw new HttpsError("invalid-argument", "Missing product ID or updates object.");
    }

    try {
      await admin.firestore().collection("products").doc(id).update({
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true };
    } catch (err) {
      console.error("Update product error:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
