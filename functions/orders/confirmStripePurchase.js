import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import stripeLib from "stripe";
import { defineSecret } from "firebase-functions/params";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_SECRET_KEY_TEST = defineSecret("STRIPE_SECRET_KEY_TEST");

if (!admin.apps.length) {
  admin.initializeApp();
}

function stripeId(value) {
  return typeof value === "string" ? value : value?.id || null;
}

function normalizeAddress(address = {}) {
  return {
    line1: address.line1 || "",
    line2: address.line2 || "",
    city: address.city || "",
    state: address.state || "",
    postcode: address.postal_code || address.postcode || "",
    country: address.country || "",
  };
}

function addressDoc({ addressId, orderId, userId, type, name, email, phone, address }) {
  return {
    addressId,
    orderId,
    userId,
    addressType: type,
    name: name || "",
    email: email || "",
    phone: phone || "",
    ...normalizeAddress(address),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

const confirmStripePurchaseHandler = async (request) => {
  const { sessionId } = request.data || {};
  const uid = request.auth?.uid;

  if (!uid || !sessionId) {
    throw new HttpsError("unauthenticated", "User must be logged in with a valid session.");
  }

  const stripeSecretKey =
    process.env.FUNCTIONS_EMULATOR === "true"
      ? STRIPE_SECRET_KEY_TEST.value()
      : STRIPE_SECRET_KEY.value();

  const stripe = stripeLib(stripeSecretKey);

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: [
      "line_items",
      "line_items.data.price",
      "line_items.data.price.product",
      "payment_intent",
      "customer",
    ],
  });

  if (session.payment_status !== "paid") {
    throw new HttpsError(
      "failed-precondition",
      "Checkout session has not been paid yet.",
    );
  }

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
        requiresShipping: product.requiresShipping !== false,
        creatorId: product.creatorId || null,
        affiliatePercent: commissionRates[type] ?? 0.1,
      };
    }),
  );
  const hasPhysicalItems = enrichedProducts.some((item) => item.requiresShipping);

  const subtotal = (session.amount_subtotal || 0) / 100;
  const shipping = (session.total_details?.amount_shipping || 0) / 100;
  const total = (session.amount_total || 0) / 100;
  const gst = total / 11;

  const invoiceNumber = session.id;
  const orderRef = admin.firestore().collection("orders").doc(invoiceNumber);
  const existingOrder = await orderRef.get();

  if (existingOrder.exists) {
    return existingOrder.data();
  }
  const customerDetails = session.customer_details || {};
  const shippingDetails = session.shipping_details || session.shipping || {};
  const customerEmail = customerDetails.email || session.customer_email || "";
  const customerName = customerDetails.name || shippingDetails.name || "Customer";
  const customerPhone = customerDetails.phone || "";
  const shippingAddressId = `${invoiceNumber}_shipping`;
  const billingAddressId = `${invoiceNumber}_billing`;

  const orderData = {
    buyerUid: uid,
    userId: uid,
    userEmail: customerEmail,
    userName: customerName,
    customerEmail,
    customerName,
    customerPhone,

    stripeCustomerId: stripeId(session.customer),

    stripeSessionId: session.id,
    stripeCheckoutSessionId: session.id,
    paymentIntentId: stripeId(session.payment_intent),
    stripePaymentIntentId: stripeId(session.payment_intent),

    products: enrichedProducts,

    subtotal,
    shipping: {
      amount_total: shipping,
      name: shippingDetails.name || customerName,
      email: customerEmail,
      phone: customerPhone,
      address: shippingDetails.address || null,
    },
    total,
    gst,

    billingAddress: customerDetails.address || null,
    shippingAddress: shippingDetails.address || null,
    shippingAddressId: hasPhysicalItems ? shippingAddressId : null,
    billingAddressId,
    shippingName: shippingDetails.name || customerName,
    shippingEmail: customerEmail,
    shippingPhone: customerPhone,
    hasPhysicalItems,

    invoiceNumber,
    invoiceId: invoiceNumber,
    status: "Paid",
    purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),

    referredBy: session.metadata?.referrer_uid || null,
    referralEvent: session.metadata?.ref_event || null,
  };

  const db = admin.firestore();
  const batch = db.batch();
  batch.set(orderRef, orderData);
  batch.set(
    db.collection("users").doc(uid).collection("orders").doc(invoiceNumber),
    orderData,
  );
  batch.set(db.collection("customerAddresses").doc(billingAddressId), addressDoc({
    addressId: billingAddressId,
    orderId: invoiceNumber,
    userId: uid,
    type: "billing",
    name: customerName,
    email: customerEmail,
    phone: customerPhone,
    address: customerDetails.address,
  }), { merge: true });

  if (hasPhysicalItems) {
    batch.set(db.collection("customerAddresses").doc(shippingAddressId), addressDoc({
      addressId: shippingAddressId,
      orderId: invoiceNumber,
      userId: uid,
      type: "shipping",
      name: shippingDetails.name || customerName,
      email: customerEmail,
      phone: customerPhone,
      address: shippingDetails.address,
    }), { merge: true });
  }
  await batch.commit();

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

        console.log(`Workshop ticket created: ${ticketId}`);
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

  return orderData;
};

export const confirmStripePurchase = onCall(
  {
    region: "australia-southeast1",
    secrets: [STRIPE_SECRET_KEY, STRIPE_SECRET_KEY_TEST],
  },
  confirmStripePurchaseHandler,
);
