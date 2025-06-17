// 📧 sendOrderEmailWithPDF.js – Sends confirmation email with PDF download link
import { onCall, HttpsError } from "firebase-functions/v2/https";
import sgMail from "@sendgrid/mail";
import { defineSecret } from "firebase-functions/params";
import { generateOrderPDF } from "../utils/generateOrderPDFServer.js";
import admin from "firebase-admin";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

if (!admin.apps.length) {
  admin.initializeApp();
}

const sendOrderEmailWithPDFHandler = async (data) => {
  const { to, invoiceId, userName = "Customer" } = data;

  if (!to || !invoiceId) {
    throw new HttpsError("invalid-argument", "Missing required email or invoiceId");
  }

  try {
    sgMail.setApiKey(SENDGRID_API_KEY.value());

    const orderRef = admin.firestore().collection("orders").doc(invoiceId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) throw new Error("Order not found");

    const order = orderSnap.data();

    const pdfUrl = await generateOrderPDF(invoiceId, order);

    const msg = {
      to,
      from: "hello@recoverytools.au",
      subject: `Your Receipt – Order ${invoiceId}`,
      html: `
        <p>Hi ${userName},</p>
        <p>Thanks for your order. You can download your receipt below:</p>
        <p><a href="${pdfUrl}" target="_blank" rel="noopener">Download Invoice PDF</a></p>
        <p>If you have any questions, reply to this email or contact us at 
        <a href="mailto:hello@recoverytools.au">hello@recoverytools.au</a>.</p>
        <p>– Recovery Tools Team</p>
      `,
    };

    await sgMail.send(msg);
    return { success: true, message: "Email sent with receipt." };
  } catch (err) {
    console.error("sendOrderEmailWithPDF error:", err);
    throw new HttpsError("internal", "Failed to send order confirmation.");
  }
};

export const sendOrderEmailWithPDF = onCall(
  {
    region: "australia-southeast1",
    secrets: [SENDGRID_API_KEY],
  },
  sendOrderEmailWithPDFHandler,
);
