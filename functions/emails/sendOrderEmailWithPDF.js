// Sends a confirmation email with a PDF download link.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import sgMail from "@sendgrid/mail";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import { generateOrderPDF } from "../utils/generateOrderPDFServer.js";
import { logEmailEvent } from "../utils/emailLog.js";
import { getBusinessProfile } from "../utils/businessProfile.js";
import { accessEmailDetails } from "../utils/orderAccessEmail.js";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

if (!admin.apps.length) {
  admin.initializeApp();
}

function useSendGridSandboxMode() {
  if (process.env.SENDGRID_SANDBOX_MODE) {
    return process.env.SENDGRID_SANDBOX_MODE === "true";
  }
  return process.env.FUNCTIONS_EMULATOR === "true";
}

function useLocalSendGridSandbox() {
  return process.env.FUNCTIONS_EMULATOR === "true" && useSendGridSandboxMode();
}

function orderHasDigitalAccess(order = {}) {
  const lines = order.orderLines || order.products || [];
  return order.accessStatus === "granted" || lines.some((item) =>
    item.accessGranted === true ||
    item.unlocksAccess === true ||
    (Array.isArray(item.accessTargets) && item.accessTargets.length > 0) ||
    (Array.isArray(item.accessGrants) && item.accessGrants.length > 0));
}

async function orderWithCurrentVariantDetails(order = {}) {
  const products = Array.isArray(order.products) ? order.products : [];
  const enriched = await Promise.all(products.map(async (product) => {
    const variantId = product.variantId || product.productVariantId || "";
    if (!variantId || product.eventStartAt && product.eventLocation) return product;
    const snapshot = await admin.firestore().collection("productVariants").doc(variantId).get();
    if (!snapshot.exists) return product;
    const variant = snapshot.data() || {};
    return {
      ...product,
      variantName: product.variantName || variant.variantName || variant.name || "",
      eventStartAt: product.eventStartAt || variant.eventStartAt || "",
      eventEndAt: product.eventEndAt || variant.eventEndAt || "",
      eventLocation: product.eventLocation || variant.eventLocation || "",
      instructor: product.instructor || variant.instructor || "",
    };
  }));
  return { ...order, products: enriched };
}

const sendOrderEmailWithPDFHandler = async (request) => {
  const {
    to,
    invoiceId,
    userName = "Customer",
  } = request.data || {};

  if (!to || !invoiceId) {
    throw new HttpsError("invalid-argument", "Missing required email or invoiceId");
  }

  const business = await getBusinessProfile();
  const orderRef = admin.firestore().collection("orders").doc(invoiceId);
  let subject = `Your ${business.name} receipt - Order ${invoiceId}`;

  try {
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) throw new Error("Order not found");

    const order = await orderWithCurrentVariantDetails(orderSnap.data());
    const userId = order.userId || order.buyerUid || order.uid;
    const hasDigitalAccess = orderHasDigitalAccess(order);
    const accessDetails = hasDigitalAccess ? accessEmailDetails(order) : null;
    subject = hasDigitalAccess
      ? `Your ${business.name} ${accessDetails.subjectPrefix} - Order ${invoiceId}`
      : subject;

    if (useLocalSendGridSandbox()) {
      await Promise.all([
        logEmailEvent({
          type: "order_confirmation",
          status: "sandboxed",
          to,
          subject,
          orderId: invoiceId,
          userId,
          providerMode: "local-sandbox",
          sentByUid: request.auth?.uid,
          sentByEmail: request.auth?.token?.email,
        }),
        orderRef.set({
          confirmationEmailSandboxedAt: admin.firestore.FieldValue.serverTimestamp(),
          confirmationEmailError: "",
        }, { merge: true }),
      ]);
      return { success: true, sandboxed: true, message: "Email sandboxed locally." };
    }

    const pdfUrl = await generateOrderPDF(invoiceId, order);
    const msg = {
      to,
      from: business.email,
      subject,
      html: `
        <p>Hi ${userName},</p>
        <p>Thanks for your order. You can download your receipt below:</p>
        <p><a href="${pdfUrl}" target="_blank" rel="noopener">Download Invoice PDF</a></p>
        ${hasDigitalAccess ? accessDetails.html : ""}
        <p>If you have any questions, reply to this email or contact us at
        <a href="mailto:${business.email}">${business.email}</a>.</p>
        <p>- ${business.name} Team</p>
      `,
      mailSettings: {
        sandboxMode: {
          enable: useSendGridSandboxMode(),
        },
      },
    };

    sgMail.setApiKey(SENDGRID_API_KEY.value());
    await sgMail.send(msg);
    await Promise.all([
      logEmailEvent({
        type: "order_confirmation",
        status: "sent",
        to,
        subject,
        orderId: invoiceId,
        userId,
        providerMode: useSendGridSandboxMode() ? "sendgrid-sandbox" : "live",
        sentByUid: request.auth?.uid,
        sentByEmail: request.auth?.token?.email,
      }),
      orderRef.set({
        confirmationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        confirmationEmailError: "",
      }, { merge: true }),
    ]);
    return { success: true, message: "Email sent with receipt." };
  } catch (err) {
    const errorMessage = err.message || "Failed to send order confirmation.";
    console.error("sendOrderEmailWithPDF error:", err);
    await Promise.all([
      logEmailEvent({
        type: "order_confirmation",
        status: "failed",
        to,
        subject,
        orderId: invoiceId,
        providerMode: useSendGridSandboxMode() ? "sendgrid-sandbox" : "live",
        errorMessage,
        sentByUid: request.auth?.uid,
        sentByEmail: request.auth?.token?.email,
      }),
      orderRef.set({
        confirmationEmailError: errorMessage,
        confirmationEmailFailedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }),
    ]);
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
