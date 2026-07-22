import { onRequest } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import stripeLib from "stripe";
import { defineSecret } from "firebase-functions/params";
import { stripeSecretValue, stripeWebhookSecretValue } from "../utils/stripeEnvironment.js";
import {
  accessGrantsForProduct,
  componentsForProduct,
  inventoryForProduct,
  loadProductArchitecture,
  productDisplayName,
  productDisplayType,
  variantForProduct,
} from "../utils/productArchitecture.js";
import { canonicalOrderLines, orderDueDate } from "../utils/orderLineSnapshots.js";
import { accessExpiry } from "../utils/accessGrantTiming.js";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_SECRET_KEY_TEST = defineSecret("STRIPE_SECRET_KEY_TEST");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const STRIPE_WEBHOOK_SECRET_TEST = defineSecret("STRIPE_WEBHOOK_SECRET_TEST");

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

async function componentInventoryByItem(db, items) {
  const itemIds = [...new Set(items.flatMap((item) => (item.components || [])
    .filter((component) => String(component.inventoryAction || "deduct").toLowerCase() === "deduct")
    .map((component) => component.itemId)
    .filter(Boolean)))];
  const snapshots = await Promise.all(itemIds.map((itemId) =>
    db.collection("inventory").where("itemId", "==", itemId).get()));
  return new Map(itemIds.map((itemId, index) => {
    const docs = snapshots[index].docs;
    const preferred = docs.find((doc) => !doc.data()?.variantId && !doc.data()?.productId) || docs[0];
    return [itemId, preferred || null];
  }));
}

async function reserveInventoryAndCreateOrder(db, orderRef, orderData, items) {
  const tracked = items.filter((item) => item.inventoryTracked === true);
  const componentInventory = await componentInventoryByItem(db, items);
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(orderRef);
    if (existing.exists) return false;

    const productRefs = [...new Map(tracked.map((item) => [
      item.productId,
      db.collection("products").doc(item.productId),
    ])).values()];
    const variantRefs = [...new Map(tracked.filter((item) => item.variantId).map((item) => [
      `${item.variantSourceCollection || "itemVariants"}/${item.variantId}`,
      db.collection(item.variantSourceCollection || "itemVariants").doc(item.variantId),
    ])).values()];
    const componentRefs = [...new Map([...componentInventory.values()].filter(Boolean)
      .map((doc) => [doc.ref.path, doc.ref])).values()];
    const [productSnaps, variantSnaps, componentSnaps] = await Promise.all([
      Promise.all(productRefs.map((ref) => transaction.get(ref))),
      Promise.all(variantRefs.map((ref) => transaction.get(ref))),
      Promise.all(componentRefs.map((ref) => transaction.get(ref))),
    ]);
    const productStock = new Map(productSnaps.map((snap) => [snap.id, Number(snap.data()?.stock ?? 0)]));
    const variantStock = new Map(variantSnaps.map((snap) => [snap.ref.path, Number(
      snap.data()?.stockQuantity ?? snap.data()?.stock ?? 0,
    )]));
    const componentStock = new Map(componentSnaps.map((snap) => [snap.ref.path, Number(snap.data()?.stockQty ?? 0)]));

    const productRequired = new Map();
    const variantRequired = new Map();
    tracked.forEach((item) => {
      const quantity = Number(item.quantity || 1);
      productRequired.set(item.productId, (productRequired.get(item.productId) || 0) + quantity);
      if (item.variantId) {
        const path = `${item.variantSourceCollection || "itemVariants"}/${item.variantId}`;
        variantRequired.set(path, (variantRequired.get(path) || 0) + quantity);
      }
    });
    productRequired.forEach((quantity, productId) => {
      if ((productStock.get(productId) ?? 0) < quantity) {
        throw new Error(`${productId} does not have enough stock.`);
      }
    });
    variantRequired.forEach((quantity, path) => {
      if ((variantStock.get(path) ?? 0) < quantity) {
        throw new Error(`${path} does not have enough variant stock.`);
      }
    });
    const componentDeductions = new Map();
    items.forEach((item) => (item.components || []).forEach((component) => {
      if (String(component.inventoryAction || "deduct").toLowerCase() !== "deduct") return;
      const inventoryDoc = componentInventory.get(component.itemId);
      if (!inventoryDoc) return;
      const quantity = Number(component.quantity || 1) * Number(item.quantity || 1);
      componentDeductions.set(inventoryDoc.ref.path, {
        ref: inventoryDoc.ref,
        itemId: component.itemId,
        quantity: (componentDeductions.get(inventoryDoc.ref.path)?.quantity || 0) + quantity,
      });
    }));
    componentDeductions.forEach((deduction, path) => {
      if ((componentStock.get(path) ?? 0) < deduction.quantity) {
        throw new Error(`Component ${deduction.itemId} does not have enough stock.`);
      }
    });

    transaction.create(orderRef, orderData);
    tracked.forEach((item) => {
      const quantity = Number(item.quantity || 1);
      transaction.update(db.collection("products").doc(item.productId), {
        stock: admin.firestore.FieldValue.increment(-quantity),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (item.variantId) {
        const collection = item.variantSourceCollection || "itemVariants";
        transaction.update(db.collection(collection).doc(item.variantId), {
          [collection === "productVariants" ? "stockQuantity" : "stock"]:
            admin.firestore.FieldValue.increment(-quantity),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      const inventoryId = item.inventoryId || (item.variantId ? `INV-${item.variantId}` : `INV-${item.productId}`);
      transaction.set(db.collection("inventory").doc(inventoryId), {
        inventoryId,
        productId: item.productId,
        variantId: item.variantId || "",
        stockQty: admin.firestore.FieldValue.increment(-quantity),
        lastOrderId: orderData.orderId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    componentDeductions.forEach((deduction) => {
      transaction.set(deduction.ref, {
        stockQty: admin.firestore.FieldValue.increment(-deduction.quantity),
        lastOrderId: orderData.orderId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return true;
  });
}

async function productSnapshotFromLineItem(lineItem, commissionRates = {}, architecture) {
  const stripeProduct = lineItem.price?.product;
  const metadata = typeof stripeProduct === "string" ? {} : stripeProduct?.metadata || {};
  const productId = metadata.firebaseProductId || lineItem.price?.metadata?.firebaseProductId || "";
  const productSnap = productId
    ? await admin.firestore().collection("products").doc(productId).get()
    : null;
  const product = productSnap?.exists ? productSnap.data() : {};
  const accessGrants = accessGrantsForProduct(productId, product, architecture)
    .filter((grant) => !grant.productVariantId || grant.productVariantId === variantId);
  const displayType = productDisplayType(product, metadata.productType || "item");
  const legacyType = product.type || metadata.productType || "item";
  const quantity = Number(lineItem.quantity || 1);
  const lineTotal = centsToDollars(lineItem.amount_total);
  const unitPrice = quantity > 0 ? Number((lineTotal / quantity).toFixed(2)) : lineTotal;
  const variantId = metadata.variantId || "";
  const variant = variantForProduct(productId, product.itemId || product.legacyItemId || "", variantId, architecture);
  const inventory = inventoryForProduct(
    productId,
    product.itemId || product.legacyItemId || "",
    variantId,
    architecture,
  );

  return {
    productId: productId || stripeId(stripeProduct) || lineItem.id,
    itemId: product.itemId || metadata.itemId || "",
    variantId,
    variantSourceCollection: variant?.sourceCollection || "",
    productTitle: productDisplayName(product, lineItem.description || ""),
    variantName: variant?.name ||
      [variant?.colour, variant?.size].filter(Boolean).join(" / ") ||
      metadata.variantName || "",
    sku: product.sku || metadata.sku || "",
    quantity,
    unitPrice,
    lineTotal,
    productType: displayType,
    affiliatePercent: commissionRates[legacyType] ?? 0,
    affiliateCommission:
      Number((lineTotal * (commissionRates[legacyType] ?? 0)).toFixed(2)),
    requiresShipping:
      product.requiresShipping ??
      (metadata.requiresShipping ? metadata.requiresShipping === "true" : true),
    accessGranted: accessGrants.length > 0 || product.unlocksAccess === true || metadata.unlocksAccess === "true",
    accessType: accessGrants[0]?.accessEntityType || product.accessType || metadata.accessType || "",
    relatedPlanId: accessGrants.find((grant) => grant.accessEntityType === "Plan")?.accessEntityId ||
      product.relatedPlanId || metadata.relatedPlanId || "",
    relatedCourseId: product.relatedCourseId || metadata.relatedCourseId || "",
    relatedWorkshopId: product.relatedWorkshopId || metadata.relatedWorkshopId || "",
    notes: "",
    accessGrants,
    components: componentsForProduct(productId, variantId, architecture),
    inventoryTracked: product.inventoryTracked === true || variant?.inventoryTracked === true || !!inventory,
    inventoryId: inventory?.inventoryId || inventory?.id || "",
    sellerUserId: product.sellerUserId || "",
    product,
  };
}

export async function writeCheckoutCompleted({ stripe, session, event }) {
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
  const architecture = await loadProductArchitecture(db);
  const items = await Promise.all(
    lineItems.data.map((lineItem) => productSnapshotFromLineItem(lineItem, commissionRates, architecture)),
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
  const currency = String(session.currency || "aud").toUpperCase();
  const orderLines = canonicalOrderLines(items, currency);
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
    dueDate: orderDueDate(session.created),
    orderStatus: "paid",
    paymentStatus: session.payment_status || "paid",
    fulfilmentStatus: hasPhysicalItems ? "new" : "not_required",
    subtotal,
    shippingAmount,
    gstAmount,
    total,
    currency,
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
    orderLines,
    orderLineSchemaVersion: 2,
    status: "Paid",
    purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const orderRef = db.collection("orders").doc(orderId);
  const created = await reserveInventoryAndCreateOrder(db, orderRef, orderData, items);
  const batch = db.batch();
  if (!created) {
    batch.set(orderRef, {
      orderLineSchemaVersion: 2,
      orderLines,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

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

  orderLines.forEach((item) => {
    const orderItemId = `${orderId}_${item.lineNumber}`;
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
    const grants = item.accessGrants?.length
      ? item.accessGrants
      : [accessTarget(item, item.product)].map(({ accessType, accessId }) => ({
        accessEntityType: accessType,
        accessEntityId: accessId,
      }));
    grants.forEach((grant) => {
      const accessType = grant.accessEntityType || grant.accessType;
      const accessId = grant.accessEntityId || grant.accessId;
      const accessVariantId = grant.accessEntityVariantId || "";
      if (!userId || !accessType || !accessId) return;
      const userAccessId = `${userId}_${accessType}_${accessId}` +
        (accessVariantId ? `_${accessVariantId}` : "");
      batch.set(db.collection("userAccess").doc(userAccessId), {
        userAccessId,
        userId,
        accessType,
        accessId,
        accessVariantId,
        sourceItemId: item.itemId || item.productId,
        sourceProductId: item.productId,
        sourceOrderId: orderId,
        productAccessGrantId: grant.productAccessGrantId || grant.id || "",
        grantedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: accessExpiry(grant),
        revocable: grant.revocable !== false,
        active: true,
        revokedAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
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
    secrets: [
      STRIPE_SECRET_KEY,
      STRIPE_SECRET_KEY_TEST,
      STRIPE_WEBHOOK_SECRET,
      STRIPE_WEBHOOK_SECRET_TEST,
    ],
  },
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const stripe = stripeLib(stripeSecretValue({
      liveSecret: STRIPE_SECRET_KEY,
      testSecret: STRIPE_SECRET_KEY_TEST,
    }));
    const endpointSecret = stripeWebhookSecretValue({
      liveSecret: STRIPE_WEBHOOK_SECRET,
      testSecret: STRIPE_WEBHOOK_SECRET_TEST,
    });
    let event;

    try {
      if (!endpointSecret) {
        console.error("Stripe webhook secret is missing.", {
          stripeMode: process.env.STRIPE_MODE || "auto",
          functionsEmulator: process.env.FUNCTIONS_EMULATOR === "true",
        });
        return res.status(500).send("Webhook secret is not configured.");
      }

      if (!req.rawBody) {
        console.error("Stripe webhook rawBody is missing.");
        return res.status(400).send("Webhook Error: raw body is missing");
      }

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
