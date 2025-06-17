
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { Storage } from "@google-cloud/storage";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";

if (!admin.apps.length) {
  admin.initializeApp();
}

// Set up Google Cloud Storage
const storage = new Storage();
const bucket = storage.bucket("recovery-tools.appspot.com"); // Adjust if your bucket name differs

export const generateOrderPDF = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { invoiceId } = data;
    if (!invoiceId) {
      throw new HttpsError("invalid-argument", "Missing invoice ID.");
    }

    try {
      const orderRef = admin.firestore().collection("orders").doc(invoiceId);
      const orderSnap = await orderRef.get();

      if (!orderSnap.exists) {
        throw new HttpsError("not-found", "Order not found.");
      }

      const order = orderSnap.data();
      const fileName = `invoices/${invoiceId}.pdf`;
      const pdfStream = new PassThrough();

      // Build PDF
      const pdfDoc = new PDFDocument();
      pdfDoc.pipe(pdfStream);
      pdfDoc.fontSize(20).text("Recovery Tools - Tax Invoice", { align: "center" });
      pdfDoc.moveDown().fontSize(12);
      pdfDoc.text(`Invoice #: ${invoiceId}`);
      pdfDoc.text(`Customer Email: ${order.userEmail}`);
      pdfDoc.text(`Total: $${order.total.toFixed(2)}`);
      pdfDoc.moveDown().text("Items:");
      order.products.forEach((p) => {
        pdfDoc.text(`- ${p.name} x${p.quantity} — $${(p.price * p.quantity).toFixed(2)}`);
      });
      pdfDoc.text(`GST: $${order.gst.toFixed(2)}`);
      pdfDoc.text(`Date: ${order.purchasedAt?.toDate().toLocaleString() || "N/A"}`);
      pdfDoc.end();

      const file = bucket.file(fileName);
      const uploadStream = file.createWriteStream({ contentType: "application/pdf" });
      pdfStream.pipe(uploadStream);

      await new Promise((resolve, reject) => {
        uploadStream.on("finish", resolve);
        uploadStream.on("error", reject);
      });

      const [url] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 3600 * 1000, // 1 hour
      });

      return { success: true, url };
    } catch (err) {
      console.error("PDF generation error:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
