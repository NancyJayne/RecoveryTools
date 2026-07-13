import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { generateOrderPDF as generateOrderPDFUrl } from "../utils/generateOrderPDFServer.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const generateOrderPDF = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "User must be logged in.",
      );
    }

    const { invoiceId } = request.data || {};

    if (!invoiceId) {
      throw new HttpsError(
        "invalid-argument",
        "Missing invoice ID.",
      );
    }

    try {
      const orderRef = admin.firestore().collection("orders").doc(invoiceId);
      const orderSnap = await orderRef.get();

      if (!orderSnap.exists) {
        throw new HttpsError("not-found", "Order not found.");
      }

      const order = orderSnap.data();
      const isAdmin = request.auth?.token?.admin === true;
      const orderOwnerUid = order.buyerUid || order.userId || order.uid;

      if (!isAdmin && orderOwnerUid !== uid) {
        throw new HttpsError(
          "permission-denied",
          "You can only generate invoices for your own orders.",
        );
      }

      const url = await generateOrderPDFUrl(invoiceId, order);
      return { success: true, url };
    } catch (err) {
      console.error("PDF generation error:", err);

      if (err instanceof HttpsError) {
        throw err;
      }

      throw new HttpsError("internal", err.message);
    }
  },
);
