import { onRequest } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import stripeLib from "stripe";
import { defineSecret } from "firebase-functions/params";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

if (!admin.apps.length) {
  admin.initializeApp();
}

function centsToDollars(value) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function stripeTimestamp(value) {
  return value ? admin.firestore.Timestamp.fromMillis(value * 1000) : null;
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

function accessTarget(item, product = {}) {
  const accessType = product.accessType || item.accessType || item.productType;
  const accessId =
    product.relatedCourseId ||
    product.relatedPlanId ||
    product.relatedWorkshopId ||
    item.relatedCourseId ||
    item.relatedPlanId ||
    item.relatedWorkshopId ||
    item.productId;

  return { accessType, accessId };
}

function orderItemSnapshot(item) {
  const snapshot = { ...item };
  delete snapshot.product;
  return snapshot;
}

async function productSnapshotFromLineItem(lineItem, commissionRates = {}) {
  const stripeProduct = lineItem.price?.product;
  const metadata = typeof stripeProduct === "string" ? {} : stripeProduct?.metadata || {};
  const productId = metadata.firebaseProductId || lineItem.price?.metadata?.firebaseProductId || "";
  const productSnap = productId
    ? await admin.firestore().collection("products").doc(productId).get()
    : null;
  const product = productSnap?.exists ? productSnap.data() : {};
  const quantity = Number(lineItem.quantity || 1);
  const lineTotal = centsToDollars(lineItem.amount_total);
  const unitPrice = quantity > 0 ? Number((lineTotal / quantity).toFixed(2)) : lineTotal;

  return {
    productId: productId || stripeId(stripeProduct) || lineItem.id,
    itemId: product.itemId || metadata.itemId || "",
    variantId: metadata.variantId || "",
    productTitle: product.name || lineItem.description || "",
    variantName: metadata.variantName || "",
    sku: product.sku || metadata.sku || "",
    quantity,
    unitPrice,
    lineTotal,
    productType: product.type || metadata.productType || "item",
    affiliatePercent: commissionRates[product.type || metadata.productType || "item"] ?? 0,
    affiliateCommission:
      Number((lineTotal * (commissionRates[product.type || metadata.productType || "item"] ?? 0)).toFixed(2)),
    requiresShipping:
      product.requiresShipping ??
      (metadata.requiresShipping ? metadata.requiresShipping === "true" : true),
    accessGranted: product.unlocksAccess === true || metadata.unlocksAccess === "true",
    accessType: product.accessType || metadata.accessType || "",
    relatedPlanId: product.relatedPlanId || metadata.relatedPlanId || "",
    relatedCourseId: product.relatedCourseId || metadata.relatedCourseId || "",
    relatedWorkshopId: product.relatedWorkshopId || metadata.relatedWorkshopId || "",
    notes: "",
    product,
  };
}

async function writeCheckoutCompleted({ stripe, session, event }) {
  const db = admin.firestore();
  const orderId = session.id;
  const userId = session.metadata?.firebaseUID || "";
  const stripeCustomerId = stripeId(session.customer);
  const paymentIntentId = stripeId(session.payment_intent);
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
    expand: ["data.price", "data.price.product"],
    limit: 100,
  });
  const settingsSnap = await db.collection("settings").doc("affiliateCommissions").get();
  const commissionRates = settingsSnap.exists ? settingsSnap.data() : {};
  const items = await Promise.all(
    lineItems.data.map((lineItem) => productSnapshotFromLineItem(lineItem, commissionRates)),
  );
  const hasPhysicalItems = items.some((item) => item.requiresShipping);
  const accessItems = items.filter((item) => item.accessGranted);
  const customerDetails = session.customer_details || {};
  const shippingDetails = session.shipping_details || session.shipping || {};
  const shippingAddressId = `${orderId}_shipping`;
  const billingAddressId = `${orderId}_billing`;
  const shippingAmount = centsToDollars(session.total_details?.amount_shipping);
  const total = centsToDollars(session.amount_total);
  const subtotal = centsToDollars(session.amount_subtotal);
  const gstAmount = Number((total / 11).toFixed(2));
  const orderData = {
    orderId,
    userId,
    buyerUid: userId,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: paymentIntentId,
    stripeCustomerId,
    invoiceId: session.id,
    invoiceNumber: session.id,
    orderDate: stripeTimestamp(session.created) || admin.firestore.FieldValue.serverTimestamp(),
    orderStatus: "paid",
    paymentStatus: session.payment_status || "paid",
    fulfilmentStatus: hasPhysicalItems ? "new" : "not_required",
    subtotal,
    shippingAmount,
    gstAmount,
    total,
    currency: String(session.currency || "aud").toUpperCase(),
    customerName: customerDetails.name || shippingDetails.name || "",
    customerEmail: customerDetails.email || session.customer_email || "",
    customerPhone: customerDetails.phone || "",
    userName: customerDetails.name || shippingDetails.name || "",
    userEmail: customerDetails.email || session.customer_email || "",
    shippingName: shippingDetails.name || customerDetails.name || "",
    shippingEmail: customerDetails.email || session.customer_email || "",
    shippingPhone: customerDetails.phone || "",
    shippingAddress: shippingDetails.address || null,
    billingAddress: customerDetails.address || null,
    shippingAddressId: hasPhysicalItems ? shippingAddressId : null,
    billingAddressId,
    trackingId: "",
    shippingCarrier: "",
    shippingUrl: "",
    adminNotes: "",
    itemsSummary: items.map((item) => `${item.productTitle} x${item.quantity}`).join("; "),
    hasPhysicalItems,
    accessStatus: accessItems.length ? "granted" : "none",
    referredBy: session.metadata?.referrer_uid || null,
    referralEvent: session.metadata?.ref_event || null,
    metadata: session.metadata || {},
    products: items.map(orderItemSnapshot),
    status: "Paid",
    purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  const orderRef = db.collection("orders").doc(orderId);
  batch.set(orderRef, orderData, { merge: true });

  if (userId) {
    batch.set(
      db.collection("users").doc(userId).collection("orders").doc(orderId),
      orderData,
      { merge: true },
    );
    if (stripeCustomerId) {
      batch.set(db.collection("users").doc(userId), { stripeCustomerId }, { merge: true });
    }
  }

  items.map(orderItemSnapshot).forEach((item, index) => {
    const orderItemId = `${orderId}_${index + 1}`;
    batch.set(db.collection("orderItems").doc(orderItemId), {
      orderItemId,
      orderId,
      ...item,
      refundStatus: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  batch.set(db.collection("customerAddresses").doc(billingAddressId), addressDoc({
    addressId: billingAddressId,
    orderId,
    userId,
    type: "billing",
    name: customerDetails.name,
    email: customerDetails.email || session.customer_email,
    phone: customerDetails.phone,
    address: customerDetails.address,
  }), { merge: true });

  if (hasPhysicalItems) {
    batch.set(db.collection("customerAddresses").doc(shippingAddressId), addressDoc({
      addressId: shippingAddressId,
      orderId,
      userId,
      type: "shipping",
      name: shippingDetails.name || customerDetails.name,
      email: customerDetails.email || session.customer_email,
      phone: customerDetails.phone,
      address: shippingDetails.address,
    }), { merge: true });
  }

  accessItems.forEach((item) => {
    const { accessType, accessId } = accessTarget(item, item.product);
    if (!userId || !accessType || !accessId) return;
    const userAccessId = `${userId}_${accessType}_${accessId}`;
    batch.set(db.collection("userAccess").doc(userAccessId), {
      userAccessId,
      userId,
      accessType,
      accessId,
      sourceItemId: item.itemId || item.productId,
      sourceProductId: item.productId,
      sourceOrderId: orderId,
      grantedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: null,
      active: true,
      revokedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  if (orderData.referredBy) {
    items.forEach((item) => {
      const referralRef = db.collection("referrals").doc(`${orderId}_${item.productId}`);
      batch.set(referralRef, {
        referrerUid: orderData.referredBy,
        buyerUid: userId,
        orderId,
        type: item.productType,
        targetId: item.productId,
        event: "conversion",
        amount: item.lineTotal,
        affiliatePercent: item.affiliatePercent,
        affiliateCommission: item.affiliateCommission,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  }

  batch.set(db.collection("stripeEvents").doc(event.id), {
    stripeEventId: event.id,
    eventType: event.type,
    stripeCreatedAt: stripeTimestamp(event.created),
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    processingStatus: "processed",
    orderId,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: paymentIntentId,
    stripeCustomerId,
    rawEventStored: false,
    errorMessage: "",
    notes: "",
  }, { merge: true });

  await batch.commit();
}

async function markStripeEvent({ event, status, errorMessage = "", extra = {} }) {
  await admin.firestore().collection("stripeEvents").doc(event.id).set({
    stripeEventId: event.id,
    eventType: event.type,
    stripeCreatedAt: stripeTimestamp(event.created),
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    processingStatus: status,
    rawEventStored: false,
    errorMessage,
    ...extra,
  }, { merge: true });
}

export const handleStripeWebhook = onRequest(
  {
    region: "australia-southeast1",
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
  },
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const stripe = stripeLib(STRIPE_SECRET_KEY.value());
    const endpointSecret = STRIPE_WEBHOOK_SECRET.value();
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err) {
      console.error("Webhook signature verification failed.", err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const existingEvent = await admin.firestore().collection("stripeEvents").doc(event.id).get();
    if (existingEvent.data()?.processingStatus === "processed") {
      return res.status(200).send("Already processed");
    }

    try {
      if (event.type === "checkout.session.completed") {
        await writeCheckoutCompleted({ stripe, session: event.data.object, event });
      } else if (event.type === "payout.paid") {
        const payout = event.data.object;
        await admin.firestore().collection("affiliatePayouts").doc(payout.id).set({
          uid: payout?.metadata?.uid || null,
          stripePayoutId: payout.id,
          amount: centsToDollars(payout.amount),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await markStripeEvent({ event, status: "processed" });
      } else {
        await markStripeEvent({ event, status: "ignored" });
      }

      return res.status(200).send("Received");
    } catch (err) {
      console.error("Failed to process Stripe webhook:", err);
      await markStripeEvent({
        event,
        status: "failed",
        errorMessage: err.message || "Unknown webhook error",
      });
      return res.status(500).send("Failed to process Stripe event.");
    }
  },
);
