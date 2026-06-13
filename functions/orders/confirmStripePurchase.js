import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import stripeLib from "stripe";
import { defineSecret } from "firebase-functions/params";
import { sendOrderEmailWithPDF } from "../emails/sendOrderEmailWithPDF.js";
import { sendWorkshopTicketEmail } from "../emails/sendWorkshopTicketEmail.js";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");

if (!admin.apps.length) {
  admin.initializeApp();
}

const confirmStripePurchaseHandler = async (request) => {
  const { sessionId } = request.data || {};
  const uid = request.auth?.uid;

  if (!uid || !sessionId) {
    throw new HttpsError("unauthenticated", "User must be logged in with a valid session.");
  }

  const stripe = stripeLib(STRIPE_SECRET_KEY.value());

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: [
  "line_items",
  "line_items.data.price",
  "line_items.data.price.product",
  "payment_intent",
  "customer",
],
  });

  const lineItems = session.line_items;

  const settingsSnap = await admin.firestore().collection("settings").doc("affiliateCommissions").get();
  const commissionRates = settingsSnap.exists ? settingsSnap.data() : {};

  const enrichedProducts = await Promise.all(
    lineItems.data.map(async (item) => {
      const stripeProductId =
  typeof item.price.product === "string"
    ? item.price.product
    : item.price.product?.id;

  const productId =
    item.price.product?.metadata?.firebaseProductId ||
    item.price.metadata?.firebaseProductId ||
    stripeProductId;
      const productDoc = await admin.firestore().collection("products").doc(productId).get();
      const product = productDoc.data() || {};
      const type = product.type || "tool";

      return {
        productId,
        name: product.name || item.description,
        quantity: item.quantity,
        price: item.amount_subtotal / 100,
        lineTotal: item.amount_total / 100,
        type,
        creatorId: product.creatorId || null,
        affiliatePercent: commissionRates[type] ?? 0.1,
      };
    }),
  );

  const subtotal = (session.amount_subtotal || 0) / 100;
const shipping = (session.total_details?.amount_shipping || 0) / 100;
const total = (session.amount_total || 0) / 100;
const gst = total / 11;

  const invoiceNumber = session.id;
  const orderData = {
  buyerUid: uid,
  userId: uid,
  userEmail: session.customer_details?.email || session.customer_email || "",
  userName: session.customer_details?.name || "Customer",

  stripeCustomerId:
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null,

  stripeSessionId: session.id,
  paymentIntentId:
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null,

  products: enrichedProducts,

  subtotal,
  shipping: {
    amount_total: shipping,
    name: session.shipping_details?.name || session.customer_details?.name || "",
    phone: session.customer_details?.phone || "",
    address: session.shipping_details?.address || null,
  },
  total,
  gst,

  billingAddress: session.customer_details?.address || null,
  shippingAddress: session.shipping_details?.address || null,
  shippingName: session.shipping_details?.name || "",
  shippingPhone: session.customer_details?.phone || "",

  invoiceNumber,
  invoiceId: invoiceNumber,
  status: "Paid",
  purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
  createdAt: admin.firestore.FieldValue.serverTimestamp(),

  referredBy: session.metadata?.referrer_uid || null,
  referralEvent: session.metadata?.ref_event || null,
};

  await Promise.all([
    admin.firestore().collection("users").doc(uid).collection("orders").doc(invoiceNumber).set(orderData),
    admin.firestore().collection("orders").doc(invoiceNumber).set(orderData),
  ]);

  // 🔓 Unlock purchased content and issue tickets
  await Promise.all(
    enrichedProducts.map(async (item) => {
      if (item.type === "course") {
        await admin
          .firestore()
          .collection("users")
          .doc(uid)
          .collection("purchases")
          .doc(item.productId)
          .set({
            courseId: item.productId,
            accessGranted: true,
            unlockedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
      } else if (item.type === "workshop") {
        const ticketId = `${uid}_${item.productId}`;
        await admin
          .firestore()
          .collection("workshopTickets")
          .doc(ticketId)
          .set({
            ticketId,
            userId: uid,
            workshopId: item.productId,
            quantity: item.quantity,
            purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

        await sendWorkshopTicketEmail({
          to: orderData.userEmail,
          workshopName: item.name,
          ticketId,
        });
      }
    }),
  );

  if (orderData.referredBy) {
    await Promise.all(
      enrichedProducts.map((item) =>
        admin.firestore().collection("referrals").add({
          referrerUid: orderData.referredBy,
          type: item.type,
          targetId: item.productId,
          event: "conversion",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        }),
      ),
    );
  }

  await sendOrderEmailWithPDF({
    to: orderData.userEmail,
    invoiceId: invoiceNumber,
    userName: session.customer_details?.name || "Customer",
  });

  return orderData;
};

export const confirmStripePurchase = onCall(
  {
    region: "australia-southeast1",
    secrets: [STRIPE_SECRET_KEY],
  },
  confirmStripePurchaseHandler,
);
