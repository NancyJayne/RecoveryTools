
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 🛠️ Admin: Create a new product
 */
export const createProduct = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }

    const { name, price, description, stock, type, imageUrl, tags, creatorId } = data;

    if (!name || typeof price !== "number") {
      throw new HttpsError("invalid-argument", "Missing or invalid product fields.");
    }

    try {
      const productRef = await admin.firestore().collection("products").add({
        name,
        price,
        description: description || "",
        stock: stock ?? 0,
        type: type || "tool",
        imageUrl: imageUrl || "",
        tags: tags || [],
        creatorId: creatorId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, id: productRef.id };
    } catch (err) {
      console.error("Create product error:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
