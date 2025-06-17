
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * ✅ Get User Orders
 */
export const getUserOrders = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be logged in to view orders.");
    }

    try {
      const ordersRef = admin.firestore().collection("users").doc(uid).collection("orders");
      const snapshot = await ordersRef.orderBy("purchasedAt", "desc").limit(20).get();

      const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      return { orders };
    } catch (err) {
      console.error("Firestore getUserOrders error:", err);
      throw new HttpsError("internal", "Failed to load orders.");
    }
  },
);
