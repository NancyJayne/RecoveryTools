import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { generatePackingSlipPDF as generatePackingSlipPDFUrl } from "../utils/generateOrderPDFServer.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const generatePackingSlipPDF = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can generate packing slips.");
    }

    const { invoiceId, notes = "", dueDate = "" } = request.data || {};
    if (!invoiceId) {
      throw new HttpsError("invalid-argument", "Missing invoice ID.");
    }

    try {
      const orderSnap = await admin.firestore().collection("orders").doc(invoiceId).get();
      if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found.");
      const url = await generatePackingSlipPDFUrl(invoiceId, orderSnap.data() || {}, {
        notes: String(notes || "").trim(),
        dueDate: String(dueDate || "").trim(),
      });
      return { success: true, url };
    } catch (err) {
      console.error("Packing slip PDF generation error:", err);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", "Could not generate packing slip.");
    }
  },
);
