import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import stripeLib from "stripe";
import { defineSecret } from "firebase-functions/params";
import { sendOrderEmailWithPDF } from "../emails/sendOrderEmailWithPDF.js";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");

if (!admin.apps.length) {
  admin.initializeApp();
}

const confirmStripePurchaseHandler = async (data, context) => {
  const { sessionId } = data;
  const uid = context.auth?.uid;

  if (!uid || !sessionId) {
    throw new HttpsError("unauthenticated", "User must be logged in with a valid session.");
  }

  const stripe = stripeLib(STRIPE_SECRET_KEY.value());

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items", "line_items.data.price"],
  });

  const lineItems = session.line_items;

  const settingsSnap = await admin.firestore().collection("settings").doc("affiliateCommissions").get();
  const commissionRates = settingsSnap.exists ? settingsSnap.data() : {};

  const enrichedProducts = await Promise.all(
    lineItems.data.map(async (item) => {
      const productId = item.price.product;
      const productDoc = await admin.firestore().collection("products").doc(productId).get();
      const product = productDoc.data() || {};
      const type = product.type || "tool";

      return {
        productId,
        name: product.name || item.description,
        quantity: item.quantity,
        price: item.amount_total / 100,
        type,
        creatorId: product.creatorId || null,
        affiliatePercent: commissionRates[type] ?? 0.1,
      };
    }),
  );

  const subtotal = enrichedProducts.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const gst = Math.round(subtotal / 11);
  const total = subtotal;

  const invoiceNumber = session.id;
  const orderData = {
    products: enrichedProducts,
    subtotal,
    gst,
    total,
    stripeTransactionId: session.payment_intent,
    invoiceNumber,
    purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
    referredBy: session.metadata?.referrer_uid || null,
    referralEvent: session.metadata?.ref_event || null,
    userId: uid,
    userEmail: session.customer_email,
    status: "Pending",
  };

  await Promise.all([
    admin.firestore().collection("users").doc(uid).collection("orders").doc(invoiceNumber).set(orderData),
    admin.firestore().collection("orders").doc(invoiceNumber).set(orderData),
  ]);

  await sendOrderEmailWithPDF({
    to: session.customer_email,
    invoiceId: invoiceNumber,
    userName: session.customer_details?.name || "Customer",
  });

  return { success: true };
};

export const confirmStripePurchase = onCall(
  {
    region: "australia-southeast1",
    secrets: [STRIPE_SECRET_KEY],
  },
  confirmStripePurchaseHandler,
);
