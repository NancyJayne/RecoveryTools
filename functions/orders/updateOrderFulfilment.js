import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import sgMail from "@sendgrid/mail";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

if (!admin.apps.length) {
  admin.initializeApp();
}

const FULFILMENT_STEPS = new Set([
  "new",
  "packing",
  "packed",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
]);

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function displayStatus(status) {
  const normalized = cleanString(status).toLowerCase();
  if (normalized === "new") return "Paid";
  return normalized
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function trackingUrl(trackingNumber, carrier) {
  const tracking = encodeURIComponent(trackingNumber);
  if (cleanString(carrier).toLowerCase().includes("australia post")) {
    return `https://auspost.com.au/mypost/track/#/details/${tracking}`;
  }
  return "";
}

function recipientEmail(order) {
  return (
    cleanString(order.customerEmail) ||
    cleanString(order.shippingEmail) ||
    cleanString(order.userEmail) ||
    cleanString(order.email)
  );
}

function recipientName(order) {
  return (
    cleanString(order.customerName) ||
    cleanString(order.shippingName) ||
    cleanString(order.userName) ||
    "Customer"
  );
}

async function sendTrackingEmail({ orderId, order, trackingNumber, shippingCarrier, shippingUrl }) {
  const to = recipientEmail(order);
  if (!to) {
    throw new HttpsError("failed-precondition", "Order has no customer email for tracking notification.");
  }

  sgMail.setApiKey(SENDGRID_API_KEY.value());

  const carrierLine = shippingCarrier ? `<p><strong>Carrier:</strong> ${shippingCarrier}</p>` : "";
  const trackingLink = shippingUrl
    ? `<p><a href="${shippingUrl}" target="_blank" rel="noopener">Track your parcel</a></p>`
    : "";

  await sgMail.send({
    to,
    from: "hello@recoverytools.au",
    subject: `Your Recovery Tools order ${orderId} has shipped`,
    html: `
      <p>Hi ${recipientName(order)},</p>
      <p>Your order has been packed and is on its way.</p>
      ${carrierLine}
      <p><strong>Tracking number:</strong> ${trackingNumber}</p>
      ${trackingLink}
      <p>If you have any questions, reply to this email or contact us at
      <a href="mailto:hello@recoverytools.au">hello@recoverytools.au</a>.</p>
      <p>- Recovery Tools Team</p>
    `,
  });
}

const updateOrderFulfilmentHandler = async (request) => {
  if (!request.auth?.token?.admin) {
    throw new HttpsError("permission-denied", "Only admins can update order fulfilment.");
  }

  const {
    orderId,
    fulfilmentStatus,
    trackingNumber,
    shippingCarrier = "Australia Post",
    adminNotes,
    dueDate,
  } = request.data || {};

  const cleanOrderId = cleanString(orderId);
  const cleanStatus = cleanString(fulfilmentStatus).toLowerCase();
  const cleanTracking = cleanString(trackingNumber);
  const cleanCarrier = cleanString(shippingCarrier) || "Australia Post";

  if (!cleanOrderId) {
    throw new HttpsError("invalid-argument", "Missing order ID.");
  }

  if (!FULFILMENT_STEPS.has(cleanStatus)) {
    throw new HttpsError("invalid-argument", "Invalid fulfilment status.");
  }

  if (cleanStatus === "shipped" && !cleanTracking) {
    throw new HttpsError("invalid-argument", "Tracking number is required before marking an order shipped.");
  }

  const db = admin.firestore();
  const orderRef = db.collection("orders").doc(cleanOrderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new HttpsError("not-found", "Order not found.");
  }

  const order = orderSnap.data();
  const previousTracking = cleanString(order.trackingNumber || order.tracking || order.trackingId);
  const cleanShippingUrl = cleanTracking ? trackingUrl(cleanTracking, cleanCarrier) : cleanString(order.shippingUrl);
  const shouldSendTrackingEmail =
    cleanStatus === "shipped" &&
    cleanTracking &&
    (
      previousTracking !== cleanTracking ||
      !order.trackingEmailSentAt
    );

  const now = admin.firestore.FieldValue.serverTimestamp();
  const updateData = {
    fulfilmentStatus: cleanStatus,
    status: displayStatus(cleanStatus),
    orderStatus: displayStatus(cleanStatus).toLowerCase(),
    trackingNumber: cleanTracking,
    tracking: cleanTracking,
    trackingId: cleanTracking,
    shippingCarrier: cleanCarrier,
    shippingUrl: cleanShippingUrl,
    adminNotes: cleanString(adminNotes),
    note: cleanString(adminNotes),
    dueDate: cleanString(dueDate) || null,
    updatedAt: now,
  };

  if (cleanStatus === "packing" && !order.packingStartedAt) updateData.packingStartedAt = now;
  if (cleanStatus === "packed" && !order.packedAt) updateData.packedAt = now;
  if (cleanStatus === "shipped" && !order.shippedAt) updateData.shippedAt = now;
  if (cleanStatus === "delivered" && !order.deliveredAt) updateData.deliveredAt = now;
  if (cleanStatus === "completed" && !order.completedAt) updateData.completedAt = now;

  if (shouldSendTrackingEmail) {
    await sendTrackingEmail({
      orderId: cleanOrderId,
      order,
      trackingNumber: cleanTracking,
      shippingCarrier: cleanCarrier,
      shippingUrl: cleanShippingUrl,
    });
    updateData.trackingEmailSentAt = now;
    updateData.trackingEmailSentFor = cleanTracking;
  }

  const shipmentId = `${cleanOrderId}_primary`;
  const batch = db.batch();
  batch.set(orderRef, updateData, { merge: true });

  const userId = cleanString(order.userId || order.buyerUid || order.uid);
  if (userId) {
    batch.set(
      db.collection("users").doc(userId).collection("orders").doc(cleanOrderId),
      updateData,
      { merge: true },
    );
  }

  batch.set(db.collection("shipments").doc(shipmentId), {
    shipmentId,
    orderId: cleanOrderId,
    userId,
    fulfilmentStatus: cleanStatus,
    trackingNumber: cleanTracking,
    trackingId: cleanTracking,
    shippingCarrier: cleanCarrier,
    shippingUrl: cleanShippingUrl,
    updatedAt: now,
    createdAt: order.shipmentCreatedAt || now,
    ...(shouldSendTrackingEmail && {
      trackingEmailSentAt: now,
      trackingEmailSentFor: cleanTracking,
    }),
  }, { merge: true });

  await batch.commit();

  return {
    success: true,
    orderId: cleanOrderId,
    fulfilmentStatus: cleanStatus,
    trackingEmailSent: shouldSendTrackingEmail,
  };
};

export const updateOrderFulfilment = onCall(
  {
    region: "australia-southeast1",
    secrets: [SENDGRID_API_KEY],
  },
  updateOrderFulfilmentHandler,
);
