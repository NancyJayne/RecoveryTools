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

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function orderItems(order = {}) {
  if (Array.isArray(order.orderLines) && order.orderLines.length) return order.orderLines;
  if (Array.isArray(order.products) && order.products.length) return order.products;
  return [];
}

function isWorkshop(item = {}) {
  const type = cleanString(item.productType || item.type).toLowerCase();
  const accessTargets = item.accessTargets || item.accessGrants || [];
  return type.includes("workshop") ||
    Boolean(item.relatedWorkshopId || item.eventStartAt) ||
    accessTargets.some((target) =>
      cleanString(target.accessEntityType || target.accessType).toLowerCase() === "workshop");
}

function refundedItems(items = [], refundStatus = "refunded") {
  return items.map((item) => ({ ...item, refundStatus }));
}

function customerEmail(order = {}) {
  return cleanString(order.customerEmail || order.userEmail || order.shippingEmail || order.email);
}

function customerName(order = {}) {
  return cleanString(order.customerName || order.userName || order.shippingName) || "Customer";
}

function userId(order = {}) {
  return cleanString(order.userId || order.buyerUid || order.uid);
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function useSendGridSandboxMode() {
  if (process.env.SENDGRID_SANDBOX_MODE !== undefined) {
    return process.env.SENDGRID_SANDBOX_MODE === "true";
  }
  return process.env.FUNCTIONS_EMULATOR === "true";
}

function useLocalEmailSandbox() {
  return process.env.FUNCTIONS_EMULATOR === "true" && useSendGridSandboxMode();
}

async function sendRefundEmail({ order, orderId, amount, refundId, request }) {
  const to = customerEmail(order);
  if (!to) return "Customer email is missing; refund email was not sent.";
  const business = await getBusinessProfile();
  const subject = `Refund confirmed - Order ${order.invoiceNumber || orderId}`;
  const sendGridSandbox = useSendGridSandboxMode();
  const localSandbox = useLocalEmailSandbox();
  const providerMode = localSandbox
    ? "local-sandbox"
    : sendGridSandbox ? "sendgrid-sandbox" : "live";
  if (localSandbox) {
    await logEmailEvent({
      type: "order_refund",
      status: "sandboxed",
      to,
      subject,
      orderId,
      userId: userId(order),
      providerMode,
      sentByUid: request.auth?.uid,
      sentByEmail: request.auth?.token?.email,
      metadata: { refundId, amount },
    });
    return "";
  }
  try {
    sgMail.setApiKey(SENDGRID_API_KEY.value());
    await sgMail.send({
      to,
      from: business.email,
      subject,
      html: `
        <p>Hi ${escapeHtml(customerName(order))},</p>
        <p>Your workshop booking has been cancelled and a refund of
        <strong>$${amount.toFixed(2)} AUD</strong> has been issued.</p>
        <p>Your bank may take several business days to show the funds.</p>
        <p>Order: ${escapeHtml(order.invoiceNumber || orderId)}</p>
        <p>- ${escapeHtml(business.name)} Team</p>
      `,
      mailSettings: { sandboxMode: { enable: sendGridSandbox } },
    });
    await logEmailEvent({
      type: "order_refund",
      status: "sent",
      to,
      subject,
      orderId,
      userId: userId(order),
      providerMode,
      sentByUid: request.auth?.uid,
      sentByEmail: request.auth?.token?.email,
      metadata: { refundId, amount },
    });
    return "";
  } catch (error) {
    await logEmailEvent({
      type: "order_refund",
      status: "failed",
      to,
      subject,
      orderId,
      userId: userId(order),
      providerMode,
      errorMessage: error.message,
      sentByUid: request.auth?.uid,
      sentByEmail: request.auth?.token?.email,
      metadata: { refundId, amount },
    });
    return "The refund succeeded, but its confirmation email failed.";
  }
}

export const refundWorkshopOrder = onCall(
  {
    region: "australia-southeast1",
    secrets: [STRIPE_SECRET_KEY, STRIPE_SECRET_KEY_TEST, SENDGRID_API_KEY],
  },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can refund workshop orders.");
    }
    const orderId = cleanString(request.data?.orderId);
    const reason = cleanString(request.data?.reason);
    const confirmation = cleanString(request.data?.confirmation);
    if (!orderId || !reason || confirmation !== "REFUND") {
      throw new HttpsError("invalid-argument", "Order, reason and refund confirmation are required.");
    }

    const db = admin.firestore();
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found.");
    const order = orderSnap.data() || {};
    const items = Array.isArray(order.products) && order.products.length
      ? order.products
      : orderItems(order);
    if (!items.length || items.some((item) => !isWorkshop(item)) || order.hasPhysicalItems === true) {
      throw new HttpsError(
        "failed-precondition",
        "This V1 refund action is limited to workshop-only orders. Mixed or physical orders need an item-level refund.",
      );
    }
    if (cleanString(order.refundStatus).toLowerCase() === "refunded") {
      const existingTimeline = Array.isArray(order.timeline) ? order.timeline : [];
      const repairUpdate = {
        customerFollowUpStatus: "resolved",
        customerFollowUpOpen: false,
        customerFollowUpResolution: order.customerFollowUpResolution ||
          `Full refund issued: ${cleanString(order.refundReason) || reason}`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(!existingTimeline.some((entry) => entry?.type === "refund") ? {
          timeline: admin.firestore.FieldValue.arrayUnion({
            type: "refund",
            label: `Workshop refund completed - $${Number(order.refundedAmount || order.total || 0).toFixed(2)}`,
            at: admin.firestore.Timestamp.now(),
            byUid: cleanString(request.auth.uid),
            byEmail: cleanString(request.auth.token?.email),
            metadata: {
              amount: Number(order.refundedAmount || order.total || 0),
              reason: cleanString(order.refundReason) || reason,
              stripeRefundId: cleanString(order.stripeRefundId),
              stripeStatus: cleanString(order.stripeRefundStatus) || "succeeded",
            },
          }),
        } : {}),
      };
      const repairBatch = db.batch();
      repairBatch.set(orderRef, repairUpdate, { merge: true });
      const existingUserId = userId(order);
      if (existingUserId) {
        repairBatch.set(
          db.collection("users").doc(existingUserId).collection("orders").doc(orderId),
          repairUpdate,
          { merge: true },
        );
      }
      await repairBatch.commit();
      const repairedAmount = Number(order.refundedAmount || order.total || 0);
      const emailWarning = await sendRefundEmail({
        order,
        orderId,
        amount: repairedAmount,
        refundId: order.stripeRefundId || "",
        request,
      });
      return {
        success: true,
        alreadyRefunded: true,
        refundId: order.stripeRefundId || "",
        amount: repairedAmount,
        emailWarning,
      };
    }
    const paymentIntentId = cleanString(order.stripePaymentIntentId || order.paymentIntentId);
    if (!paymentIntentId) {
      throw new HttpsError("failed-precondition", "This order has no Stripe PaymentIntent ID.");
    }

    const stripe = new stripeLib(stripeSecretValue({
      liveSecret: STRIPE_SECRET_KEY,
      testSecret: STRIPE_SECRET_KEY_TEST,
    }));
    let refund;
    try {
      refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        metadata: {
          firebaseOrderId: orderId,
          requestedByUid: cleanString(request.auth.uid),
          adminReason: reason.slice(0, 450),
        },
      }, { idempotencyKey: `workshop-order-refund-${orderId}` });
    } catch (error) {
      console.error("Stripe workshop refund failed:", error);
      throw new HttpsError("internal", error.message || "Stripe could not create the refund.");
    }

    if (refund.status === "failed" || refund.failure_reason) {
      throw new HttpsError("internal", refund.failure_reason || "Stripe reported that the refund failed.");
    }

    const amount = Number(refund.amount || 0) / 100;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const timelineAt = admin.firestore.Timestamp.now();
    const refundStatus = refund.status === "succeeded" ? "refunded" : "pending";
    const refundUpdate = {
      refundStatus,
      paymentStatus: refund.status === "succeeded" ? "refunded" : "refund_pending",
      status: refund.status === "succeeded" ? "Refunded" : "Refund pending",
      fulfilmentStatus: "cancelled",
      accessStatus: "revoked",
      customerFollowUpStatus: refund.status === "succeeded" ? "resolved" : "workshop_cancellation",
      customerFollowUpOpen: refund.status !== "succeeded",
      customerFollowUpResolution: refund.status === "succeeded"
        ? `Full refund issued: ${reason}`
        : `Refund submitted to Stripe: ${reason}`,
      refundedAmount: amount,
      refundReason: reason,
      stripeRefundId: refund.id,
      stripeRefundStatus: refund.status,
      refundRequestedAt: now,
      refundedAt: refund.status === "succeeded" ? now : null,
      refundedByUid: cleanString(request.auth.uid),
      refundedByEmail: cleanString(request.auth.token?.email),
      ...(Array.isArray(order.orderLines)
        ? { orderLines: refundedItems(order.orderLines, refundStatus) }
        : {}),
      ...(Array.isArray(order.products)
        ? { products: refundedItems(order.products, refundStatus) }
        : {}),
      updatedAt: now,
      timeline: admin.firestore.FieldValue.arrayUnion({
        type: "refund",
        label: refund.status === "succeeded"
          ? `Workshop refund completed - $${amount.toFixed(2)}`
          : `Workshop refund submitted - $${amount.toFixed(2)}`,
        at: timelineAt,
        byUid: cleanString(request.auth.uid),
        byEmail: cleanString(request.auth.token?.email),
        metadata: { amount, reason, stripeRefundId: refund.id, stripeStatus: refund.status },
      }),
    };

    const [itemSnaps, accessSnaps] = await Promise.all([
      db.collection("orderItems").where("orderId", "==", orderId).get(),
      db.collection("userAccess").where("sourceOrderId", "==", orderId).get(),
    ]);
    const batch = db.batch();
    batch.set(orderRef, refundUpdate, { merge: true });
    const uid = userId(order);
    if (uid) {
      batch.set(db.collection("users").doc(uid).collection("orders").doc(orderId), refundUpdate, { merge: true });
    }
    itemSnaps.forEach((snap) => batch.set(snap.ref, {
      refundStatus: refundUpdate.refundStatus,
      stripeRefundId: refund.id,
      refundedAt: refund.status === "succeeded" ? now : null,
      updatedAt: now,
    }, { merge: true }));
    accessSnaps.forEach((snap) => batch.set(snap.ref, {
      active: false,
      revokedAt: now,
      revokedBy: cleanString(request.auth.uid),
      revocationReason: "workshop_order_refunded",
      updatedAt: now,
    }, { merge: true }));
    batch.set(db.collection("refunds").doc(refund.id), {
      refundId: refund.id,
      orderId,
      paymentIntentId,
      amount,
      currency: cleanString(refund.currency || order.currency || "aud").toUpperCase(),
      status: refund.status,
      reason,
      stripeMode: stripeModeLabel(),
      requestedByUid: cleanString(request.auth.uid),
      requestedByEmail: cleanString(request.auth.token?.email),
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
    await batch.commit();

    const emailWarning = refund.status === "succeeded"
      ? await sendRefundEmail({ order, orderId, amount, refundId: refund.id, request })
      : "Stripe marked the refund pending; send confirmation after it succeeds.";
    return { success: true, refundId: refund.id, status: refund.status, amount, emailWarning };
  },
);
