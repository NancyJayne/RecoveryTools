
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 📄 Admin: Fetch a specific order by invoice number
 */
export const getOrderByInvoiceID = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can access order details.");
    }

    const { invoiceId } = data;
    if (!invoiceId) {
      throw new HttpsError("invalid-argument", "Missing invoice ID.");
    }

    try {
      const doc = await admin.firestore().collection("orders").doc(invoiceId).get();
      if (!doc.exists) {
        throw new HttpsError("not-found", "Order not found.");
      }

      return { order: doc.data(), invoiceId };
    } catch (error) {
      console.error("Order fetch error:", error);
      throw new HttpsError("internal", "Failed to fetch order.");
    }
  },
);
