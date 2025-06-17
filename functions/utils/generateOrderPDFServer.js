import admin from "firebase-admin";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { getStorage } from "firebase-admin/storage";

if (!admin.apps.length) {
  admin.initializeApp();
}

const bucket = getStorage().bucket();

/**
 * 🔒 Server-side utility: Generate & upload invoice PDF for a given order
 */
export async function generateOrderPDF(invoiceId, orderData) {
  const fileName = `invoices/${invoiceId}.pdf`;
  const pdfStream = new PassThrough();

  const pdfDoc = new PDFDocument();
  pdfDoc.pipe(pdfStream);

  pdfDoc.fontSize(20).text("Recovery Tools - Tax Invoice", { align: "center" });
  pdfDoc.moveDown().fontSize(12);
  pdfDoc.text(`Invoice #: ${invoiceId}`);
  pdfDoc.text(`Customer Email: ${orderData.userEmail}`);
  pdfDoc.text(`Total: $${orderData.total.toFixed(2)}`);
  pdfDoc.moveDown().text("Items:");

  orderData.products.forEach((p) => {
    pdfDoc.text(`- ${p.name} x${p.quantity} — $${(p.price * p.quantity).toFixed(2)}`);
  });

  pdfDoc.text(`GST: $${orderData.gst.toFixed(2)}`);
  pdfDoc.text(`Date: ${orderData.purchasedAt?.toDate().toLocaleString() || "N/A"}`);
  pdfDoc.end();

  const file = bucket.file(fileName);
  const uploadStream = file.createWriteStream({ contentType: "application/pdf" });
  pdfStream.pipe(uploadStream);

  await new Promise((resolve, reject) => {
    uploadStream.on("finish", resolve);
    uploadStream.on("error", reject);
  });

  const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 3600 * 1000 });
  return url;
}
