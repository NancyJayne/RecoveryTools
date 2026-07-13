import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import { logEmailEvent } from "../utils/emailLog.js";
import { appBaseUrl } from "../utils/stripeEnvironment.js";
import { getBusinessProfile } from "../utils/businessProfile.js";

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

const CUSTOMER_FOLLOW_UP_STATUSES = new Set([
  "none",
  "return_requested",
  "exchange_requested",
  "complaint_open",
  "resolved",
]);

const OPEN_CUSTOMER_FOLLOW_UP_STATUSES = new Set([
  "return_requested",
  "exchange_requested",
  "complaint_open",
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

function adminDisplayName(request) {
  return (
    cleanString(request.auth?.token?.name) ||
    cleanString(request.auth?.token?.email) ||
    cleanString(request.auth?.uid) ||
    "Admin"
  );
}

function trackingUrl(trackingNumber, carrier) {
  const tracking = encodeURIComponent(trackingNumber);
  if (cleanString(carrier).toLowerCase().includes("australia post")) {
    return `https://auspost.com.au/mypost/track/#/details/${tracking}`;
  }
  return "";
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function orderItems(order) {
  if (Array.isArray(order.products) && order.products.length) return order.products;
  if (Array.isArray(order.items) && order.items.length) return order.items;
  if (order.itemsSummary) {
    return String(order.itemsSummary)
      .split(";")
      .map((summary) => summary.trim())
      .filter(Boolean)
      .map((summary) => ({ name: summary, quantity: 1 }));
  }
  return [];
}

function itemName(item) {
  return cleanString(item.name) ||
    cleanString(item.productTitle) ||
    cleanString(item.title) ||
    cleanString(item.description) ||
    cleanString(item.productId) ||
    "Item";
}

function itemQuantity(item) {
  const quantity = Number(item.quantity || 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function itemProductPath(item) {
  const productId = cleanString(item.productId) || cleanString(item.id) || cleanString(item.slug);
  return productId ? `${appBaseUrl()}/shop/${encodeURIComponent(productId)}` : `${appBaseUrl()}/shop`;
}

function orderIssueUrl(orderId, params = {}) {
  const url = new URL("/order-issue", appBaseUrl());
  url.searchParams.set("order", orderId);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function feedbackUrl({ orderId, rating }) {
  return orderIssueUrl(orderId, { type: "feedback", rating });
}

function autoCompleteAfterDeliveryDate() {
  return admin.firestore.Timestamp.fromMillis(Date.now() + 14 * 24 * 60 * 60 * 1000);
}

function archiveAfterCompleteDate() {
  return admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== ""),
  );
}

function timelineEntry({ type, label, at, byUid, byEmail, byName, metadata = {} }) {
  return compactObject({
    type,
    label,
    at,
    byUid,
    byEmail,
    byName,
    metadata: compactObject(metadata),
  });
}

function renderCompletionItemList(order) {
  const items = orderItems(order);
  if (!items.length) {
    return "<p>No line items were found on this order.</p>";
  }

  return `
    <ul>
      ${items.map((item) => `
        <li>
          <strong>${escapeHtml(itemName(item))}</strong>
          x${itemQuantity(item)}
          - <a href="${itemProductPath(item)}" target="_blank" rel="noopener">leave a product review</a>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderRatingLinks(orderId) {
  const ratingStyle = [
    "display:inline-block",
    "margin-right:6px",
    "padding:8px 10px",
    "border:1px solid #407471",
    "border-radius:4px",
    "text-decoration:none",
    "color:#407471",
  ].join(";");

  return [1, 2, 3, 4, 5].map((rating) => `
    <a href="${feedbackUrl({ orderId, rating })}" target="_blank" rel="noopener"
      style="${ratingStyle}">
      ${rating} &#9733;
    </a>
  `).join("");
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

async function sendTrackingEmail({ orderId, order, trackingNumber, shippingCarrier, shippingUrl }) {
  const business = await getBusinessProfile();
  const to = recipientEmail(order);
  if (!to) {
    throw new HttpsError("failed-precondition", "Order has no customer email for tracking notification.");
  }

  const carrierLine = shippingCarrier ? `<p><strong>Carrier:</strong> ${shippingCarrier}</p>` : "";
  const trackingLink = shippingUrl
    ? `<p><a href="${shippingUrl}" target="_blank" rel="noopener">Track your parcel</a></p>`
    : "";
  const message = {
    to,
    from: business.email,
    subject: `Your ${business.name} order ${orderId} has shipped`,
    html: `
      <p>Hi ${recipientName(order)},</p>
      <p>Your order has been packed and is on its way.</p>
      ${carrierLine}
      <p><strong>Tracking number:</strong> ${trackingNumber}</p>
      ${trackingLink}
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

  if (useLocalSendGridSandbox()) {
    console.info("SendGrid sandbox email skipped locally.", {
      orderId,
      to,
      subject: message.subject,
      trackingNumber,
    });
    return { sandboxed: true };
  }

  sgMail.setApiKey(SENDGRID_API_KEY.value());
  await sgMail.send(message);
  return { sandboxed: false };
}

async function sendReviewRequestEmail({ orderId, order }) {
  const business = await getBusinessProfile();
  const to = recipientEmail(order);
  if (!to) {
    throw new HttpsError("failed-precondition", "Order has no customer email for review request.");
  }

  const message = {
    to,
    from: business.email,
    subject: `How did your ${business.name} order ${orderId} go?`,
    html: `
      <p>Hi ${escapeHtml(recipientName(order))},</p>
      <p>Your order has now been marked as delivered. Thank you for shopping with ${business.name}.</p>
      <p><strong>Items in this order:</strong></p>
      ${renderCompletionItemList(order)}
      <p><strong>How did we do?</strong></p>
      <p>${renderRatingLinks(orderId)}</p>
      <p>If you want to send extra feedback or need help with a return, replacement, damaged item,
      or complaint, use this link so we can keep it connected to your order:</p>
      <p>
        <a href="${orderIssueUrl(orderId, { type: "feedback" })}" target="_blank" rel="noopener">
          Request help or send order feedback
        </a>
      </p>
      <p>You can also reply to this email if you prefer.</p>
      <p>- ${business.name} Team</p>
    `,
    mailSettings: {
      sandboxMode: {
        enable: useSendGridSandboxMode(),
      },
    },
  };

  if (useLocalSendGridSandbox()) {
    console.info("SendGrid sandbox review request email skipped locally.", {
      orderId,
      to,
      subject: message.subject,
    });
    return { sandboxed: true };
  }

  sgMail.setApiKey(SENDGRID_API_KEY.value());
  await sgMail.send(message);
  return { sandboxed: false };
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
    customerFollowUpStatus,
    customerFollowUpNotes,
    customerFollowUpResolution,
  } = request.data || {};

  const cleanOrderId = cleanString(orderId);
  const cleanStatus = cleanString(fulfilmentStatus).toLowerCase();
  const cleanTracking = cleanString(trackingNumber);
  const cleanCarrier = cleanString(shippingCarrier) || "Australia Post";
  const adminUid = cleanString(request.auth?.uid);
  const adminEmail = cleanString(request.auth?.token?.email);
  const adminName = adminDisplayName(request);

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
  const business = await getBusinessProfile();
  const trackingEmailSubject = `Your ${business.name} order ${cleanOrderId} has shipped`;
  const reviewRequestEmailSubject = `How did your ${business.name} order ${cleanOrderId} go?`;
  const existingFollowUpStatus = cleanString(order.customerFollowUpStatus).toLowerCase() || "none";
  const cleanFollowUpStatus = cleanString(customerFollowUpStatus).toLowerCase() || existingFollowUpStatus;
  const cleanFollowUpNotes = cleanString(customerFollowUpNotes);
  const cleanFollowUpResolution = cleanString(customerFollowUpResolution);

  if (!CUSTOMER_FOLLOW_UP_STATUSES.has(cleanFollowUpStatus)) {
    throw new HttpsError("invalid-argument", "Invalid customer follow-up status.");
  }

  if (cleanStatus === "completed" && OPEN_CUSTOMER_FOLLOW_UP_STATUSES.has(cleanFollowUpStatus)) {
    throw new HttpsError(
      "failed-precondition",
      "Resolve the return, swap, or complaint before marking the order completed.",
    );
  }

  const previousStatus = cleanString(order.fulfilmentStatus || order.status).toLowerCase();
  const previousTracking = cleanString(order.trackingNumber || order.tracking || order.trackingId);
  const cleanShippingUrl = cleanTracking ? trackingUrl(cleanTracking, cleanCarrier) : cleanString(order.shippingUrl);
  const shouldSendTrackingEmail =
    cleanStatus === "shipped" &&
    cleanTracking &&
    (
      previousTracking !== cleanTracking ||
      !order.trackingEmailSentAt
    );
  const shouldSendReviewRequestEmail =
    cleanStatus === "delivered" &&
    previousStatus !== "delivered" &&
    !order.reviewRequestEmailSentAt &&
    !order.reviewRequestEmailSandboxedAt;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const timelineAt = admin.firestore.Timestamp.now();
  const timelineEntries = [];
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
    customerFollowUpStatus: cleanFollowUpStatus,
    customerFollowUpOpen: OPEN_CUSTOMER_FOLLOW_UP_STATUSES.has(cleanFollowUpStatus),
    customerFollowUpNotes: cleanFollowUpNotes,
    customerFollowUpResolution: cleanFollowUpResolution,
    updatedAt: now,
    lastFulfilmentUpdatedAt: now,
    lastFulfilmentUpdatedByUid: adminUid,
    lastFulfilmentUpdatedByEmail: adminEmail,
    lastFulfilmentUpdatedByName: adminName,
  };

  if (!cleanString(order.assignedAdminUid)) {
    updateData.assignedAdminUid = adminUid;
    updateData.assignedAdminEmail = adminEmail;
    updateData.assignedAdminName = adminName;
    updateData.assignedAt = now;
  }

  if (previousStatus !== cleanStatus) {
    timelineEntries.push(timelineEntry({
      type: "fulfilment_status",
      label: `Status changed from ${previousStatus || "unknown"} to ${cleanStatus}`,
      at: timelineAt,
      byUid: adminUid,
      byEmail: adminEmail,
      byName: adminName,
      metadata: {
        previousStatus,
        fulfilmentStatus: cleanStatus,
      },
    }));
  }

  if (cleanStatus === "packing" && !order.packingStartedAt) updateData.packingStartedAt = now;
  if (cleanStatus === "packed" && !order.packedAt) updateData.packedAt = now;
  if (cleanStatus === "shipped" && !order.shippedAt) updateData.shippedAt = now;
  if (cleanStatus === "delivered" && !order.deliveredAt) updateData.deliveredAt = now;
  if (cleanStatus === "delivered" && !order.autoCompleteAfter) {
    updateData.autoCompleteAfter = autoCompleteAfterDeliveryDate();
    updateData.autoCompleteReason = "no_customer_follow_up_after_delivery";
  }
  if (OPEN_CUSTOMER_FOLLOW_UP_STATUSES.has(cleanFollowUpStatus)) {
    updateData.autoCompleteAfter = null;
    updateData.autoCompleteReason = `blocked_${cleanFollowUpStatus}`;
    updateData.autoCompleteBlockedAt = now;
  }
  if (cleanFollowUpStatus !== existingFollowUpStatus) {
    updateData.customerFollowUpUpdatedAt = now;
    timelineEntries.push(timelineEntry({
      type: "customer_follow_up",
      label: `Customer follow-up changed from ${existingFollowUpStatus} to ${cleanFollowUpStatus}`,
      at: timelineAt,
      byUid: adminUid,
      byEmail: adminEmail,
      byName: adminName,
      metadata: {
        previousCustomerFollowUpStatus: existingFollowUpStatus,
        customerFollowUpStatus: cleanFollowUpStatus,
      },
    }));
  }
  if (cleanFollowUpStatus === "resolved" && OPEN_CUSTOMER_FOLLOW_UP_STATUSES.has(existingFollowUpStatus)) {
    updateData.customerFollowUpResolvedAt = now;
    if (cleanStatus === "delivered" && !order.completedAt) {
      updateData.autoCompleteAfter = autoCompleteAfterDeliveryDate();
      updateData.autoCompleteReason = "customer_follow_up_resolved";
    }
  }
  if (cleanStatus === "completed" && !order.completedAt) updateData.completedAt = now;
  if (cleanStatus === "completed") {
    updateData.autoCompleteAfter = null;
  }
  if (
    cleanStatus === "completed" &&
    !order.archiveAfter &&
    !OPEN_CUSTOMER_FOLLOW_UP_STATUSES.has(cleanFollowUpStatus)
  ) {
    updateData.archiveAfter = archiveAfterCompleteDate();
  }
  if (timelineEntries.length) {
    updateData.timeline = admin.firestore.FieldValue.arrayUnion(...timelineEntries);
  }

  let trackingEmailSent = false;
  let trackingEmailSandboxed = false;
  let trackingEmailError = "";
  let reviewRequestEmailSent = false;
  let reviewRequestEmailSandboxed = false;
  let reviewRequestEmailError = "";

  if (shouldSendTrackingEmail) {
    try {
      const emailResult = await sendTrackingEmail({
        orderId: cleanOrderId,
        order,
        trackingNumber: cleanTracking,
        shippingCarrier: cleanCarrier,
        shippingUrl: cleanShippingUrl,
      });
      trackingEmailSandboxed = !!emailResult?.sandboxed;

      if (trackingEmailSandboxed) {
        updateData.trackingEmailSandboxedAt = now;
        updateData.trackingEmailSandboxedFor = cleanTracking;
        updateData.trackingEmailError = "";
        await logEmailEvent({
          type: "tracking",
          status: "sandboxed",
          to: recipientEmail(order),
          subject: trackingEmailSubject,
          orderId: cleanOrderId,
          userId: cleanString(order.userId || order.buyerUid || order.uid),
          providerMode: "local-sandbox",
          sentByUid: adminUid,
          sentByEmail: adminEmail,
          metadata: {
            trackingNumber: cleanTracking,
            shippingCarrier: cleanCarrier,
          },
        });
      } else {
        trackingEmailSent = true;
        updateData.trackingEmailSentAt = now;
        updateData.trackingEmailSentFor = cleanTracking;
        updateData.trackingEmailError = "";
        await logEmailEvent({
          type: "tracking",
          status: "sent",
          to: recipientEmail(order),
          subject: trackingEmailSubject,
          orderId: cleanOrderId,
          userId: cleanString(order.userId || order.buyerUid || order.uid),
          providerMode: useSendGridSandboxMode() ? "sendgrid-sandbox" : "live",
          sentByUid: adminUid,
          sentByEmail: adminEmail,
          metadata: {
            trackingNumber: cleanTracking,
            shippingCarrier: cleanCarrier,
          },
        });
      }
    } catch (err) {
      trackingEmailError = err.message || "Tracking email could not be sent.";
      updateData.trackingEmailError = trackingEmailError;
      updateData.trackingEmailFailedAt = now;
      updateData.trackingEmailFailedFor = cleanTracking;
      await logEmailEvent({
        type: "tracking",
        status: "failed",
        to: recipientEmail(order),
        subject: trackingEmailSubject,
        orderId: cleanOrderId,
        userId: cleanString(order.userId || order.buyerUid || order.uid),
        providerMode: useSendGridSandboxMode() ? "sendgrid-sandbox" : "live",
        errorMessage: trackingEmailError,
        sentByUid: adminUid,
        sentByEmail: adminEmail,
        metadata: {
          trackingNumber: cleanTracking,
          shippingCarrier: cleanCarrier,
        },
      });
      console.error("Tracking email failed; fulfilment update will still be saved.", err);
    }
  }

  if (shouldSendReviewRequestEmail) {
    try {
      const emailResult = await sendReviewRequestEmail({
        orderId: cleanOrderId,
        order,
      });
      reviewRequestEmailSandboxed = !!emailResult?.sandboxed;

      if (reviewRequestEmailSandboxed) {
        updateData.reviewRequestEmailSandboxedAt = now;
        updateData.reviewRequestEmailError = "";
        await logEmailEvent({
          type: "review_request",
          status: "sandboxed",
          to: recipientEmail(order),
          subject: reviewRequestEmailSubject,
          orderId: cleanOrderId,
          userId: cleanString(order.userId || order.buyerUid || order.uid),
          providerMode: "local-sandbox",
          sentByUid: adminUid,
          sentByEmail: adminEmail,
        });
      } else {
        reviewRequestEmailSent = true;
        updateData.reviewRequestEmailSentAt = now;
        updateData.reviewRequestEmailError = "";
        await logEmailEvent({
          type: "review_request",
          status: "sent",
          to: recipientEmail(order),
          subject: reviewRequestEmailSubject,
          orderId: cleanOrderId,
          userId: cleanString(order.userId || order.buyerUid || order.uid),
          providerMode: useSendGridSandboxMode() ? "sendgrid-sandbox" : "live",
          sentByUid: adminUid,
          sentByEmail: adminEmail,
        });
      }
    } catch (err) {
      reviewRequestEmailError = err.message || "Review request email could not be sent.";
      updateData.reviewRequestEmailError = reviewRequestEmailError;
      updateData.reviewRequestEmailFailedAt = now;
      await logEmailEvent({
        type: "review_request",
        status: "failed",
        to: recipientEmail(order),
        subject: reviewRequestEmailSubject,
        orderId: cleanOrderId,
        userId: cleanString(order.userId || order.buyerUid || order.uid),
        providerMode: useSendGridSandboxMode() ? "sendgrid-sandbox" : "live",
        errorMessage: reviewRequestEmailError,
        sentByUid: adminUid,
        sentByEmail: adminEmail,
      });
      console.error("Review request email failed; fulfilment update will still be saved.", err);
    }
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
    customerFollowUpStatus: cleanFollowUpStatus,
    customerFollowUpOpen: OPEN_CUSTOMER_FOLLOW_UP_STATUSES.has(cleanFollowUpStatus),
    updatedAt: now,
    lastFulfilmentUpdatedAt: now,
    lastFulfilmentUpdatedByUid: adminUid,
    lastFulfilmentUpdatedByEmail: adminEmail,
    lastFulfilmentUpdatedByName: adminName,
    createdAt: order.shipmentCreatedAt || now,
    ...(!cleanString(order.assignedAdminUid) && {
      assignedAdminUid: adminUid,
      assignedAdminEmail: adminEmail,
      assignedAdminName: adminName,
      assignedAt: now,
    }),
    ...(trackingEmailSent && {
      trackingEmailSentAt: now,
      trackingEmailSentFor: cleanTracking,
      trackingEmailError: "",
    }),
    ...(trackingEmailSandboxed && {
      trackingEmailSandboxedAt: now,
      trackingEmailSandboxedFor: cleanTracking,
      trackingEmailError: "",
    }),
    ...(trackingEmailError && {
      trackingEmailError,
      trackingEmailFailedAt: now,
      trackingEmailFailedFor: cleanTracking,
    }),
    ...(reviewRequestEmailSent && {
      reviewRequestEmailSentAt: now,
      reviewRequestEmailError: "",
    }),
    ...(reviewRequestEmailSandboxed && {
      reviewRequestEmailSandboxedAt: now,
      reviewRequestEmailError: "",
    }),
    ...(reviewRequestEmailError && {
      reviewRequestEmailError,
      reviewRequestEmailFailedAt: now,
    }),
    ...(updateData.autoCompleteAfter && {
      autoCompleteAfter: updateData.autoCompleteAfter,
      autoCompleteReason: updateData.autoCompleteReason,
    }),
    ...(updateData.autoCompleteAfter === null && {
      autoCompleteAfter: null,
      ...(updateData.autoCompleteReason && {
        autoCompleteReason: updateData.autoCompleteReason,
      }),
      ...(cleanString(updateData.autoCompleteReason).startsWith("blocked_") && {
        autoCompleteBlockedAt: now,
      }),
    }),
    ...(updateData.archiveAfter && {
      archiveAfter: updateData.archiveAfter,
    }),
    ...(updateData.customerFollowUpResolvedAt && {
      customerFollowUpResolvedAt: now,
    }),
  }, { merge: true });

  await batch.commit();

  return {
    success: true,
    orderId: cleanOrderId,
    fulfilmentStatus: cleanStatus,
    trackingEmailSent,
    trackingEmailSandboxed,
    trackingEmailError,
    reviewRequestEmailSent,
    reviewRequestEmailSandboxed,
    reviewRequestEmailError,
  };
};

export const updateOrderFulfilment = onCall(
  {
    region: "australia-southeast1",
    secrets: [SENDGRID_API_KEY],
  },
  updateOrderFulfilmentHandler,
);
