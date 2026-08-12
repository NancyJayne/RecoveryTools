import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import stripeLib from "stripe";
import sgMail from "@sendgrid/mail";
import { stripeModeLabel, stripeSecretValue } from "../utils/stripeEnvironment.js";
import { getBusinessProfile } from "../utils/businessProfile.js";
import { logEmailEvent } from "../utils/emailLog.js";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_SECRET_KEY_TEST = defineSecret("STRIPE_SECRET_KEY_TEST");
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

if (!admin.apps.length) admin.initializeApp();

const money = (value) => Number(Number(value || 0).toFixed(2));
const clean = (value) => typeof value === "string" ? value.trim() : "";

function lines(order = {}) {
  if (Array.isArray(order.orderLines) && order.orderLines.length) return order.orderLines;
  if (Array.isArray(order.products) && order.products.length) return order.products;
  return [];
}

function lineNumber(line, index) {
  return Number(line.lineNumber || index + 1);
}

function quantity(line) {
  return Math.max(Number(line.quantity || 1), 1);
}

function unitPrice(line) {
  const qty = quantity(line);
  return money(line.unitPrice ?? Number(line.lineTotal ?? line.price ?? 0) / qty);
}

function shippingAmount(order = {}) {
  return money(order.shipping?.amount_total ?? order.shippingAmount ?? 0);
}

function customerEmail(order = {}) {
  return clean(order.customerEmail || order.userEmail || order.shippingEmail || order.email);
}

function customerName(order = {}) {
  return clean(order.customerName || order.userName || order.shippingName) || "Customer";
}

function userId(order = {}) {
  return clean(order.userId || order.buyerUid || order.uid);
}

function escapeHtml(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function sandboxMode() {
  if (process.env.SENDGRID_SANDBOX_MODE !== undefined) {
    return process.env.SENDGRID_SANDBOX_MODE === "true";
  }
  return process.env.FUNCTIONS_EMULATOR === "true";
}

function lineName(line = {}) {
  return clean(line.productName || line.name || line.title || line.productId) || "Order item";
}

function lineHasAccess(line = {}) {
  const type = clean(line.productType || line.type).toLowerCase();
  return (line.accessTargets || line.accessGrants || []).length > 0 ||
    ["digital", "course", "workshop"].some((value) => type.includes(value));
}

async function sendEmail({ order, orderId, amount, refundId, selections, shipping, request }) {
  const to = customerEmail(order);
  if (!to) return "Customer email is missing; refund email was not sent.";
  const business = await getBusinessProfile();
  const subject = `Refund confirmed - Order ${order.invoiceNumber || orderId}`;
  const isSandbox = sandboxMode();
  const localSandbox = process.env.FUNCTIONS_EMULATOR === "true" && isSandbox;
  const providerMode = localSandbox ? "local-sandbox" : isSandbox ? "sendgrid-sandbox" : "live";
  const metadata = { refundId, amount, selections, shipping };
  if (localSandbox) {
    await logEmailEvent({ type: "order_refund", status: "sandboxed", to, subject, orderId,
      userId: userId(order), providerMode, sentByUid: request.auth?.uid,
      sentByEmail: request.auth?.token?.email, metadata });
    return "";
  }
  try {
    sgMail.setApiKey(SENDGRID_API_KEY.value());
    const rows = selections.map((entry) => `<li>${escapeHtml(entry.name)} x${entry.quantity} - <strong>$${entry.amount.toFixed(2)}</strong></li>`).join("");
    await sgMail.send({
      to, from: business.sender, subject,
      html: `<p>Hi ${escapeHtml(customerName(order))},</p><p>A refund of <strong>$${amount.toFixed(2)} AUD</strong> has been issued for:</p><ul>${rows}${shipping ? `<li>Shipping - <strong>$${shipping.toFixed(2)}</strong></li>` : ""}</ul><p>Your bank may take several business days to show the funds.</p><p>Order: ${escapeHtml(order.invoiceNumber || orderId)}</p><p>- ${escapeHtml(business.name)} Team</p>`,
      mailSettings: { sandboxMode: { enable: isSandbox } },
    });
    await logEmailEvent({ type: "order_refund", status: "sent", to, subject, orderId,
      userId: userId(order), providerMode, sentByUid: request.auth?.uid,
      sentByEmail: request.auth?.token?.email, metadata });
    return "";
  } catch (error) {
    await logEmailEvent({ type: "order_refund", status: "failed", to, subject, orderId,
      userId: userId(order), providerMode, errorMessage: error.message,
      sentByUid: request.auth?.uid, sentByEmail: request.auth?.token?.email, metadata });
    return "The refund succeeded, but its confirmation email failed.";
  }
}

export const refundOrderItems = onCall({
  region: "australia-southeast1",
  secrets: [STRIPE_SECRET_KEY, STRIPE_SECRET_KEY_TEST, SENDGRID_API_KEY],
}, async (request) => {
  if (!request.auth?.token?.admin) throw new HttpsError("permission-denied", "Admin access only.");
  const orderId = clean(request.data?.orderId);
  const reason = clean(request.data?.reason);
  const requestedLines = Array.isArray(request.data?.lines) ? request.data.lines : [];
  const refundShipping = request.data?.refundShipping === true;
  if (!orderId || !reason || request.data?.confirmation !== "REFUND") {
    throw new HttpsError("invalid-argument", "Order, reason and confirmation are required.");
  }
  if (!requestedLines.length && !refundShipping) {
    throw new HttpsError("invalid-argument", "Select at least one item or shipping.");
  }

  const db = admin.firestore();
  const orderRef = db.collection("orders").doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = orderSnap.data() || {};
  const orderLines = lines(order);
  const requested = new Map(requestedLines.map((entry) => [Number(entry.lineNumber), Number(entry.quantity)]));
  const selections = [];
  const updatedLines = orderLines.map((line, index) => {
    const number = lineNumber(line, index);
    const requestedQuantity = requested.get(number) || 0;
    const alreadyRefunded = Math.max(Number(line.refundedQuantity || 0), 0);
    const available = Math.max(quantity(line) - alreadyRefunded, 0);
    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 0 || requestedQuantity > available) {
      throw new HttpsError("failed-precondition", `${lineName(line)} has only ${available} refundable item(s).`);
    }
    if (!requestedQuantity) return line;
    const linePaid = money(line.lineTotal ?? line.price ?? unitPrice(line) * quantity(line));
    const linePreviouslyRefunded = money(line.refundedAmount || 0);
    const amount = requestedQuantity === available
      ? money(linePaid - linePreviouslyRefunded)
      : money((linePaid / quantity(line)) * requestedQuantity);
    const newRefundedQuantity = alreadyRefunded + requestedQuantity;
    selections.push({ lineNumber: number, quantity: requestedQuantity, amount, name: lineName(line),
      productId: clean(line.productId), variantId: clean(line.productVariantId || line.variantId),
      fullyRefunded: newRefundedQuantity >= quantity(line), hasAccess: lineHasAccess(line) });
    return { ...line, refundedQuantity: newRefundedQuantity,
      refundedAmount: money(linePreviouslyRefunded + amount),
      refundStatus: newRefundedQuantity >= quantity(line) ? "refunded" : "partially_refunded",
      refundReason: reason };
  });
  if (requested.size !== selections.length) {
    throw new HttpsError("invalid-argument", "One or more selected order lines are invalid.");
  }

  const shipping = shippingAmount(order);
  const priorShippingRefund = money(order.refundedShippingAmount || 0);
  if (refundShipping && (shipping <= 0 || priorShippingRefund >= shipping)) {
    throw new HttpsError("failed-precondition", "Shipping has already been refunded or was not charged.");
  }
  const shippingRefund = refundShipping ? money(shipping - priorShippingRefund) : 0;
  const requestedAmount = money(selections.reduce((sum, entry) => sum + entry.amount, 0) + shippingRefund);
  const total = money(order.total || order.totalPaid || order.amountPaid);
  const priorRefunded = money(order.refundedAmount || 0);
  const remaining = money(total - priorRefunded);
  if (requestedAmount <= 0 || requestedAmount > remaining) {
    throw new HttpsError("failed-precondition", `The maximum remaining refund is $${remaining.toFixed(2)}.`);
  }
  const paymentIntentId = clean(order.stripePaymentIntentId || order.paymentIntentId);
  if (!paymentIntentId) throw new HttpsError("failed-precondition", "This order has no Stripe PaymentIntent ID.");

  const keyParts = selections.map((entry) => `${entry.lineNumber}x${entry.quantity}`).join("-") || "shipping";
  const stripe = new stripeLib(stripeSecretValue({ liveSecret: STRIPE_SECRET_KEY, testSecret: STRIPE_SECRET_KEY_TEST }));
  let refund;
  try {
    refund = await stripe.refunds.create({ payment_intent: paymentIntentId,
      amount: Math.round(requestedAmount * 100),
      metadata: { firebaseOrderId: orderId, requestedByUid: clean(request.auth.uid),
        refundLines: keyParts.slice(0, 450), adminReason: reason.slice(0, 450) } },
    { idempotencyKey: `item-refund-${orderId}-${priorRefunded.toFixed(2)}-${keyParts}-${refundShipping}` });
  } catch (error) {
    console.error("Stripe item refund failed:", error);
    throw new HttpsError("internal", error.message || "Stripe could not create the refund.");
  }
  if (refund.status === "failed" || refund.failure_reason) {
    throw new HttpsError("internal", refund.failure_reason || "Stripe reported that the refund failed.");
  }

  const amount = money(Number(refund.amount || 0) / 100);
  const cumulative = money(priorRefunded + amount);
  const fullyRefunded = cumulative >= total;
  const succeeded = refund.status === "succeeded";
  const revokedAnyAccess = succeeded && selections.some((entry) => entry.fullyRefunded && entry.hasAccess);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const timelineAt = admin.firestore.Timestamp.now();
  const historyEntry = { refundId: refund.id, amount, reason, status: refund.status,
    lines: selections, shippingAmount: shippingRefund, at: timelineAt,
    byUid: clean(request.auth.uid), byEmail: clean(request.auth.token?.email) };
  const update = {
    orderLines: updatedLines,
    ...(Array.isArray(order.products) ? { products: order.products.map((line, index) => {
      const canonical = updatedLines[index];
      return canonical ? { ...line, refundedQuantity: canonical.refundedQuantity || 0,
        refundedAmount: canonical.refundedAmount || 0, refundStatus: canonical.refundStatus || "",
        refundReason: canonical.refundReason || "" } : line;
    }) } : {}),
    refundStatus: fullyRefunded ? "refunded" : "partially_refunded",
    paymentStatus: fullyRefunded ? "refunded" : "partially_refunded",
    status: fullyRefunded ? "Refunded" : "Partially refunded",
    ...(revokedAnyAccess ? { accessStatus: fullyRefunded ? "revoked" : "partially_revoked" } : {}),
    ...(fullyRefunded ? { fulfilmentStatus: "cancelled" } : {}),
    ...(fullyRefunded && clean(order.customerFollowUpStatus) === "workshop_cancellation" ? {
      customerFollowUpStatus: "resolved",
      customerFollowUpOpen: false,
      customerFollowUpResolution: `Full refund issued: ${reason}`,
    } : {}),
    refundedAmount: cumulative,
    refundedShippingAmount: money(priorShippingRefund + shippingRefund),
    refundReason: reason,
    lastStripeRefundId: refund.id,
    stripeRefundStatus: refund.status,
    refundRequestedAt: now,
    refundedAt: succeeded ? now : null,
    refundedByUid: clean(request.auth.uid),
    refundedByEmail: clean(request.auth.token?.email),
    refundHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
    updatedAt: now,
    timeline: admin.firestore.FieldValue.arrayUnion({ type: "refund",
      label: `${fullyRefunded ? "Full" : "Partial"} refund completed - $${amount.toFixed(2)}`,
      at: timelineAt, byUid: clean(request.auth.uid), byEmail: clean(request.auth.token?.email),
      metadata: { amount, reason, stripeRefundId: refund.id, stripeStatus: refund.status,
        lines: selections, shippingAmount: shippingRefund } }),
  };

  const [itemSnaps, accessSnaps] = await Promise.all([
    db.collection("orderItems").where("orderId", "==", orderId).get(),
    db.collection("userAccess").where("sourceOrderId", "==", orderId).get(),
  ]);
  const selectedByNumber = new Map(selections.map((entry) => [entry.lineNumber, entry]));
  const fullyRefundedSelections = succeeded
    ? selections.filter((entry) => entry.fullyRefunded && entry.hasAccess)
    : [];
  const batch = db.batch();
  batch.set(orderRef, update, { merge: true });
  const uid = userId(order);
  if (uid) batch.set(db.collection("users").doc(uid).collection("orders").doc(orderId), update, { merge: true });
  itemSnaps.forEach((snap) => {
    const item = snap.data() || {};
    const selection = selectedByNumber.get(Number(item.lineNumber));
    if (!selection) return;
    const storedLine = updatedLines.find((line, index) => lineNumber(line, index) === selection.lineNumber);
    batch.set(snap.ref, { refundedQuantity: storedLine?.refundedQuantity || selection.quantity,
      refundedAmount: storedLine?.refundedAmount || selection.amount,
      refundStatus: storedLine?.refundStatus || "partially_refunded", refundReason: reason,
      lastStripeRefundId: refund.id, refundedAt: succeeded ? now : null, updatedAt: now }, { merge: true });
  });
  accessSnaps.forEach((snap) => {
    const access = snap.data() || {};
    const matched = fullyRefundedSelections.some((entry) => entry.productId === clean(access.sourceProductId) &&
      (!entry.variantId || !access.sourceProductVariantId || entry.variantId === clean(access.sourceProductVariantId)));
    if (matched) batch.set(snap.ref, { active: false, revokedAt: now,
      revokedBy: clean(request.auth.uid), revocationReason: "order_item_refunded", updatedAt: now }, { merge: true });
  });
  if (uid) {
    fullyRefundedSelections.forEach((entry) => {
      if (!entry.productId) return;
      batch.set(db.collection("users").doc(uid).collection("purchases").doc(entry.productId), {
        active: false, accessStatus: "revoked", revokedAt: now,
        revokedBy: clean(request.auth.uid), revocationReason: "order_item_refunded", updatedAt: now,
      }, { merge: true });
    });
  }
  batch.set(db.collection("refunds").doc(refund.id), { refundId: refund.id, orderId, paymentIntentId,
    amount, cumulativeRefundedAmount: cumulative, currency: clean(refund.currency || order.currency || "aud").toUpperCase(),
    status: refund.status, reason, lines: selections, shippingAmount: shippingRefund,
    stripeMode: stripeModeLabel(), requestedByUid: clean(request.auth.uid),
    requestedByEmail: clean(request.auth.token?.email), createdAt: now, updatedAt: now }, { merge: true });
  await batch.commit();

  const emailWarning = succeeded
    ? await sendEmail({ order, orderId, amount, refundId: refund.id, selections, shipping: shippingRefund, request })
    : "Stripe marked the refund pending; send confirmation after it succeeds.";
  return { success: true, refundId: refund.id, status: refund.status, amount,
    refundedAmount: cumulative, fullyRefunded, emailWarning };
});
