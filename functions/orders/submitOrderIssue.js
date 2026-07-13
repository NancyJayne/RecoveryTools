import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const ISSUE_TYPES = new Set([
  "return_requested",
  "exchange_requested",
  "damaged_item",
  "complaint_open",
  "feedback",
]);

const OPEN_ISSUE_STATUS_BY_TYPE = {
  return_requested: "return_requested",
  exchange_requested: "exchange_requested",
  damaged_item: "complaint_open",
  complaint_open: "complaint_open",
};

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== ""),
  );
}

function userIdForOrder(order) {
  return cleanString(order.userId || order.buyerUid || order.uid);
}

function customerDisplayName(request) {
  return (
    cleanString(request.auth?.token?.name) ||
    cleanString(request.auth?.token?.email) ||
    cleanString(request.auth?.uid) ||
    "Customer"
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

function issueLabel(issueType) {
  if (issueType === "return_requested") return "Return requested";
  if (issueType === "exchange_requested") return "Replacement or swap requested";
  if (issueType === "damaged_item") return "Damaged item reported";
  if (issueType === "complaint_open") return "Complaint opened";
  return "Feedback received";
}

export const submitOrderIssue = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    const uid = cleanString(request.auth?.uid);
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in before submitting an order issue.");
    }

    const {
      orderId,
      issueType,
      affectedItems,
      preferredOutcome,
      details,
      rating,
    } = request.data || {};

    const cleanOrderId = cleanString(orderId);
    const cleanIssueType = cleanString(issueType).toLowerCase();
    const cleanDetails = cleanString(details);
    const cleanAffectedItems = cleanString(affectedItems);
    const cleanPreferredOutcome = cleanString(preferredOutcome);
    const cleanRating = Number(rating || 0);

    if (!cleanOrderId) {
      throw new HttpsError("invalid-argument", "Missing order ID.");
    }

    if (!ISSUE_TYPES.has(cleanIssueType)) {
      throw new HttpsError("invalid-argument", "Select a valid request type.");
    }

    if (!cleanDetails && cleanIssueType !== "feedback") {
      throw new HttpsError("invalid-argument", "Tell us what happened so we can help.");
    }

    const db = admin.firestore();
    const orderRef = db.collection("orders").doc(cleanOrderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new HttpsError("not-found", "Order not found.");
    }

    const order = orderSnap.data();
    const ownerUid = userIdForOrder(order);
    if (ownerUid !== uid) {
      throw new HttpsError("permission-denied", "You can only submit issues for your own orders.");
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const timelineAt = admin.firestore.Timestamp.now();
    const customerEmail = cleanString(request.auth?.token?.email);
    const customerName = customerDisplayName(request);
    const issueRef = orderRef.collection("customerIssues").doc();
    const rootIssueRef = db.collection("orderIssues").doc(issueRef.id);
    const issueStatus =
      OPEN_ISSUE_STATUS_BY_TYPE[cleanIssueType] ||
      cleanString(order.customerFollowUpStatus) ||
      "none";
    const isOpenIssue = !!OPEN_ISSUE_STATUS_BY_TYPE[cleanIssueType];

    const issueData = compactObject({
      issueId: issueRef.id,
      orderId: cleanOrderId,
      userId: uid,
      issueType: cleanIssueType,
      status: isOpenIssue ? "open" : "feedback",
      customerFollowUpStatus: issueStatus,
      affectedItems: cleanAffectedItems,
      preferredOutcome: cleanPreferredOutcome,
      details: cleanDetails,
      rating: cleanRating >= 1 && cleanRating <= 5 ? cleanRating : undefined,
      customerEmail,
      customerName,
      createdAt: now,
      updatedAt: now,
    });

    const timeline = timelineEntry({
      type: isOpenIssue ? "customer_issue_submitted" : "customer_feedback_submitted",
      label: issueLabel(cleanIssueType),
      at: timelineAt,
      byUid: uid,
      byEmail: customerEmail,
      byName: customerName,
      metadata: {
        issueId: issueRef.id,
        issueType: cleanIssueType,
        preferredOutcome: cleanPreferredOutcome,
        rating: issueData.rating,
      },
    });

    const orderUpdate = compactObject({
      updatedAt: now,
      customerFollowUpUpdatedAt: now,
      latestCustomerIssueId: issueRef.id,
      latestCustomerIssueType: cleanIssueType,
      latestCustomerIssueAt: now,
      customerFollowUpNotes: cleanDetails || cleanString(order.customerFollowUpNotes),
      customerFollowUpResolution: cleanString(order.customerFollowUpResolution),
      timeline: admin.firestore.FieldValue.arrayUnion(timeline),
      ...(isOpenIssue && {
        customerFollowUpStatus: issueStatus,
        customerFollowUpOpen: true,
        autoCompleteAfter: null,
        autoCompleteReason: `blocked_${issueStatus}`,
        autoCompleteBlockedAt: now,
        archived: false,
        unarchivedAt: now,
        archiveReason: "",
      }),
      ...(!isOpenIssue && issueData.rating && {
        latestCustomerRating: issueData.rating,
      }),
    });

    const batch = db.batch();
    batch.set(issueRef, issueData, { merge: true });
    batch.set(rootIssueRef, issueData, { merge: true });
    batch.set(orderRef, orderUpdate, { merge: true });
    batch.set(
      db.collection("users").doc(uid).collection("orders").doc(cleanOrderId),
      orderUpdate,
      { merge: true },
    );
    batch.set(
      db.collection("shipments").doc(`${cleanOrderId}_primary`),
      {
        orderId: cleanOrderId,
        userId: uid,
        ...orderUpdate,
      },
      { merge: true },
    );

    await batch.commit();

    return {
      success: true,
      orderId: cleanOrderId,
      issueId: issueRef.id,
      customerFollowUpOpen: isOpenIssue,
      customerFollowUpStatus: issueStatus,
    };
  },
);
