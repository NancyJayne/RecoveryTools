import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import stripeLib from "stripe";
import { defineSecret } from "firebase-functions/params";
import sgMail from "@sendgrid/mail";
import { generateOrderPDF } from "../utils/generateOrderPDFServer.js";
import { logEmailEvent } from "../utils/emailLog.js";
import { stripeSecretValue } from "../utils/stripeEnvironment.js";
import { getBusinessProfile } from "../utils/businessProfile.js";
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
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

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

function slugify(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
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
    return [itemId, docs.find((doc) => !doc.data()?.variantId && !doc.data()?.productId) || docs[0] || null];
  }));
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

function useSendGridSandboxMode() {
  if (process.env.SENDGRID_SANDBOX_MODE) {
    return process.env.SENDGRID_SANDBOX_MODE === "true";
  }
  return process.env.FUNCTIONS_EMULATOR === "true";
}

function useLocalSendGridSandbox() {
  return process.env.FUNCTIONS_EMULATOR === "true" && useSendGridSandboxMode();
}

async function sendOrderConfirmationEmail({ orderId, orderData, to, userName, userId }) {
  const business = await getBusinessProfile();
  const subject = `Your ${business.name} receipt - Order ${orderId}`;

  if (!to) {
    throw new Error("Order has no customer email for confirmation.");
  }

  if (useLocalSendGridSandbox()) {
    console.info("SendGrid order confirmation skipped locally.", {
      orderId,
      to,
      subject,
    });
    await logEmailEvent({
      type: "order_confirmation",
      status: "sandboxed",
      to,
      subject,
      orderId,
      userId,
      providerMode: "local-sandbox",
    });
    return { sandboxed: true };
  }

  const pdfUrl = await generateOrderPDF(orderId, orderData);
  const msg = {
    to,
    from: business.email,
    subject,
    html: `
      <p>Hi ${userName || "Customer"},</p>
      <p>Thanks for your order. You can download your receipt below:</p>
      <p><a href="${pdfUrl}" target="_blank" rel="noopener">Download Invoice PDF</a></p>
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
  await logEmailEvent({
    type: "order_confirmation",
    status: "sent",
    to,
    subject,
    orderId,
    userId,
    providerMode: useSendGridSandboxMode() ? "sendgrid-sandbox" : "live",
  });
  return { sandboxed: false };
}

async function recordOrderConfirmationEmail({ orderRef, orderId, orderData, to, userName, userId }) {
  if (
    orderData.confirmationEmailSentAt ||
    orderData.confirmationEmailSandboxedAt
  ) {
    return;
  }

  try {
    const savedOrderSnap = await orderRef.get();
    const savedOrderData = savedOrderSnap.exists ? savedOrderSnap.data() : orderData;
    const emailResult = await sendOrderConfirmationEmail({
      orderId,
      orderData: savedOrderData,
      to,
      userName,
      userId,
    });
    await orderRef.set({
      confirmationEmailError: "",
      ...(emailResult.sandboxed
        ? {
          confirmationEmailSandboxedAt: admin.firestore.FieldValue.serverTimestamp(),
        }
        : {
          confirmationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        }),
    }, { merge: true });
  } catch (err) {
    const errorMessage = err.message || "Order confirmation email could not be sent.";
    const business = await getBusinessProfile();
    console.error("Order confirmation email failed; order is still confirmed.", err);
    await Promise.all([
      orderRef.set({
        confirmationEmailError: errorMessage,
        confirmationEmailFailedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }),
      logEmailEvent({
        type: "order_confirmation",
        status: "failed",
        to,
        subject: `Your ${business.name} receipt - Order ${orderId}`,
        orderId,
        userId,
        providerMode: useSendGridSandboxMode() ? "sendgrid-sandbox" : "live",
        errorMessage,
      }),
    ]);
  }
}

const confirmStripePurchaseHandler = async (request) => {
  const { sessionId } = request.data || {};
  const uid = request.auth?.uid;

  if (!uid || !sessionId) {
    throw new HttpsError("unauthenticated", "User must be logged in with a valid session.");
  }

  const stripe = stripeLib(stripeSecretValue({
    liveSecret: STRIPE_SECRET_KEY,
    testSecret: STRIPE_SECRET_KEY_TEST,
  }));

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
  const architecture = await loadProductArchitecture(admin.firestore());

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
      const metadata = item.price.product?.metadata || item.price.metadata || {};
      const productDoc = await admin.firestore().collection("products").doc(productId).get();
      const product = productDoc.data() || {};
      const type = product.type || "tool";
      const productType = productDisplayType(product, type);
      const variantId = metadata.variantId || "";
      const variant = variantForProduct(
        productId,
        product.itemId || product.legacyItemId || "",
        variantId,
        architecture,
      );
      const inventory = inventoryForProduct(
        productId,
        product.itemId || product.legacyItemId || "",
        variantId,
        architecture,
      );

      return {
        productId,
        name: productDisplayName(product, item.description),
        quantity: item.quantity,
        price: item.amount_subtotal / 100,
        unitPrice: item.amount_subtotal / 100 / Math.max(Number(item.quantity || 1), 1),
        lineTotal: item.amount_total / 100,
        type,
        productType,
        variantId,
        variantName: variant?.name ||
          [variant?.colour, variant?.size].filter(Boolean).join(" / ") ||
          metadata.variantName || "",
        variantSourceCollection: variant?.sourceCollection || "",
        sku: variant?.sku || metadata.sku || product.sku || "",
        requiresShipping: product.requiresShipping !== false,
        inventoryTracked: product.inventoryTracked === true || variant?.inventoryTracked === true || !!inventory,
        inventoryId: inventory?.inventoryId || inventory?.id || "",
        creatorId: product.creatorId || null,
        affiliatePercent: commissionRates[type] ?? 0.1,
        accessGrants: accessGrantsForProduct(productId, product, architecture),
        components: componentsForProduct(productId, variantId, architecture),
        sellerUserId: product.sellerUserId || "",
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
  const customerDetails = session.customer_details || {};
  const shippingDetails = session.shipping_details || session.shipping || {};
  const customerEmail = customerDetails.email || session.customer_email || "";
  const customerName = customerDetails.name || shippingDetails.name || "Customer";
  const customerPhone = customerDetails.phone || "";
  const shippingAddressId = `${invoiceNumber}_shipping`;
  const billingAddressId = `${invoiceNumber}_billing`;
  const orderLines = canonicalOrderLines(enrichedProducts, String(session.currency || "aud").toUpperCase());

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
    orderLines,
    orderLineSchemaVersion: 2,

    subtotal,
    shipping: {
      amount_total: shipping,
      name: shippingDetails.name || customerName,
      email: customerEmail,
      phone: customerPhone,
      address: shippingDetails.address || null,
    },
    total,
    amountPaid: total,
    totalPaid: total,
    outstandingAmount: 0,
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
    dueDate: orderDueDate(session.created),
    purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),

    referredBy: session.metadata?.referrer_uid || null,
    referralEvent: session.metadata?.ref_event || null,
  };

  const db = admin.firestore();
  const componentInventory = await componentInventoryByItem(db, enrichedProducts);
  const transactionResult = await db.runTransaction(async (transaction) => {
    const existingOrderSnap = await transaction.get(orderRef);
    if (existingOrderSnap.exists) {
      return { created: false, orderData: existingOrderSnap.data() };
    }

    const trackedItems = enrichedProducts.filter((item) => item.inventoryTracked);
    const productRefs = trackedItems.map((item) => db.collection("products").doc(item.productId));
    const variantRefs = trackedItems
      .filter((item) => item.variantId)
      .map((item) => db.collection(item.variantSourceCollection || "itemVariants").doc(item.variantId));
    const componentRefs = [...new Map([...componentInventory.values()].filter(Boolean)
      .map((doc) => [doc.ref.path, doc.ref])).values()];
    const [productSnaps, variantSnaps, componentSnaps] = await Promise.all([
      Promise.all(productRefs.map((ref) => transaction.get(ref))),
      Promise.all(variantRefs.map((ref) => transaction.get(ref))),
      Promise.all(componentRefs.map((ref) => transaction.get(ref))),
    ]);
    const productStock = new Map(productSnaps.map((snap) => [snap.id, Number(snap.data()?.stock ?? 0)]));
    const variantStock = new Map(variantSnaps.map((snap) => [
      snap.id,
      Number(snap.data()?.stockQuantity ?? snap.data()?.stock ?? 0),
    ]));
    const componentStock = new Map(componentSnaps.map((snap) => [snap.ref.path, Number(snap.data()?.stockQty ?? 0)]));
    const componentDeductions = new Map();
    enrichedProducts.forEach((item) => (item.components || []).forEach((component) => {
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

    const productRequired = new Map();
    const variantRequired = new Map();
    trackedItems.forEach((item) => {
      const quantity = Number(item.quantity || 0);
      if (!quantity) return;
      productRequired.set(item.productId, (productRequired.get(item.productId) || 0) + quantity);
      if (item.variantId) {
        variantRequired.set(item.variantId, (variantRequired.get(item.variantId) || 0) + quantity);
      }
    });
    productRequired.forEach((quantity, productId) => {
      if ((productStock.get(productId) ?? 0) < quantity) {
        throw new HttpsError("failed-precondition", `${productId} does not have enough stock left.`);
      }
    });
    variantRequired.forEach((quantity, variantId) => {
      if ((variantStock.get(variantId) ?? 0) < quantity) {
        throw new HttpsError("failed-precondition", `${variantId} does not have enough variant stock left.`);
      }
    });
    componentDeductions.forEach((deduction, path) => {
      if ((componentStock.get(path) ?? 0) < deduction.quantity) {
        throw new HttpsError(
          "failed-precondition",
          `Component ${deduction.itemId} does not have enough stock left.`,
        );
      }
    });

    transaction.set(orderRef, orderData);
    transaction.set(
      db.collection("users").doc(uid).collection("orders").doc(invoiceNumber),
      orderData,
    );
    orderLines.forEach((line) => {
      const orderItemId = `${invoiceNumber}_${line.lineNumber}`;
      transaction.set(db.collection("orderItems").doc(orderItemId), {
        orderItemId,
        orderId: invoiceNumber,
        ...line,
        refundStatus: "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    transaction.set(db.collection("customerAddresses").doc(billingAddressId), addressDoc({
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
      transaction.set(db.collection("customerAddresses").doc(shippingAddressId), addressDoc({
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

    trackedItems.forEach((item) => {
      const quantity = Number(item.quantity || 0);
      if (!quantity) return;

      transaction.update(db.collection("products").doc(item.productId), {
        stock: admin.firestore.FieldValue.increment(-quantity),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const inventoryId = item.inventoryId || (item.variantId
        ? `INV-${slugify(item.variantId)}`
        : `INV-${slugify(item.productId)}`);
      transaction.set(db.collection("inventory").doc(inventoryId), {
        inventoryId,
        productId: item.productId,
        variantId: item.variantId || "",
        stockQty: admin.firestore.FieldValue.increment(-quantity),
        lastOrderId: invoiceNumber,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      if (item.variantId) {
        const variantCollection = item.variantSourceCollection || "itemVariants";
        const stockField = variantCollection === "productVariants" ? "stockQuantity" : "stock";
        transaction.update(db.collection(variantCollection).doc(item.variantId), {
          [stockField]: admin.firestore.FieldValue.increment(-quantity),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });
    componentDeductions.forEach((deduction) => {
      transaction.set(deduction.ref, {
        stockQty: admin.firestore.FieldValue.increment(-deduction.quantity),
        lastOrderId: invoiceNumber,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    return { created: true, orderData };
  });

  const persistedOrderData = transactionResult.created ? orderData : transactionResult.orderData;
  const recoveryBatch = db.batch();
  recoveryBatch.set(orderRef, {
    orderLineSchemaVersion: 2,
    orderLines,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  recoveryBatch.set(
    db.collection("users").doc(uid).collection("orders").doc(invoiceNumber),
    persistedOrderData,
    { merge: true },
  );
  orderLines.forEach((line) => {
    const orderItemId = `${invoiceNumber}_${line.lineNumber}`;
    recoveryBatch.set(db.collection("orderItems").doc(orderItemId), {
      orderItemId,
      orderId: invoiceNumber,
      ...line,
      refundStatus: "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  await recoveryBatch.commit();

  await recordOrderConfirmationEmail({
    orderRef,
    orderId: invoiceNumber,
    orderData: persistedOrderData,
    to: persistedOrderData.customerEmail || persistedOrderData.userEmail || customerEmail,
    userName: persistedOrderData.customerName || persistedOrderData.userName || customerName,
    userId: persistedOrderData.userId || persistedOrderData.buyerUid || uid,
  });

  // 🔓 Unlock purchased content and issue tickets
  await Promise.all(
    enrichedProducts.map(async (item) => {
      if (item.accessGrants.length) {
        await Promise.all(item.accessGrants.map((grant) => {
          const accessType = grant.accessEntityType || grant.accessType;
          const accessId = grant.accessEntityId || grant.accessId;
          if (!accessType || !accessId) return Promise.resolve();
          const userAccessId = `${uid}_${accessType}_${accessId}`;
          return admin.firestore().collection("userAccess").doc(userAccessId).set({
            userAccessId,
            userId: uid,
            accessType,
            accessId,
            sourceProductId: item.productId,
            sourceOrderId: invoiceNumber,
            productAccessGrantId: grant.productAccessGrantId || grant.id || "",
            grantedAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: accessExpiry(grant),
            revocable: grant.revocable !== false,
            active: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }));
      } else if (item.type === "course" || item.productType === "Course Access") {
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
      } else if (item.type === "workshop" || item.productType === "Workshop Registration") {
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

  if (transactionResult.created && orderData.referredBy) {
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
    secrets: [STRIPE_SECRET_KEY, STRIPE_SECRET_KEY_TEST, SENDGRID_API_KEY],
  },
  confirmStripePurchaseHandler,
);
