
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 📦 Get products from Firestore with optional filtering
 * Filters: type (tool, course, workshop), tag (e.g., featured)
 */
export const getFirestoreProducts = onCall(
  { region: "australia-southeast1" },
  async (data) => {
    try {
      const { type, tag } = data;
      let query = admin.firestore().collection("products");

      if (type) {
        query = query.where("type", "==", type);
      }

      if (tag) {
        query = query.where("tags", "array-contains", tag);
      }

      const snapshot = await query.orderBy("name").get();
      const products = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return { products };
    } catch (error) {
      console.error("Error fetching filtered products:", error);
      throw new HttpsError("internal", "Unable to fetch product list.");
    }
  },
);
