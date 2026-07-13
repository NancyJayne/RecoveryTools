import { onSchedule } from "firebase-functions/v2/scheduler";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const OPEN_CUSTOMER_FOLLOW_UP_STATUSES = new Set([
  "return_requested",
  "exchange_requested",
  "complaint_open",
]);

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function userIdForOrder(order) {
  return cleanString(order.userId || order.buyerUid || order.uid);
}

function isOpenCustomerFollowUp(order) {
  const status = cleanString(order.customerFollowUpStatus).toLowerCase();
  return order.customerFollowUpOpen === true || OPEN_CUSTOMER_FOLLOW_UP_STATUSES.has(status);
}

function archiveAfterCompleteDate() {
  return admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

function timelineEntry({ type, label, at, metadata = {} }) {
  return {
    type,
    label,
    at,
    byName: "System",
    byEmail: "system@recoverytools.au",
    metadata,
  };
}

function mirrorOrderLifecycleUpdate({ db, batch, orderId, order, updateData }) {
  const userId = userIdForOrder(order);
  if (userId) {
    batch.set(
      db.collection("users").doc(userId).collection("orders").doc(orderId),
      updateData,
      { merge: true },
    );
  }

  batch.set(
    db.collection("shipments").doc(`${orderId}_primary`),
    {
      orderId,
      userId,
      ...updateData,
    },
    { merge: true },
  );
}

async function completeEligibleDeliveredOrders({ db, now }) {
  const snapshot = await db
    .collection("orders")
    .where("autoCompleteAfter", "<=", now)
    .limit(150)
    .get();

  const batch = db.batch();
  let completed = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const order = doc.data();
    const status = cleanString(order.fulfilmentStatus || order.status).toLowerCase();

    if (status !== "delivered" || order.completedAt || isOpenCustomerFollowUp(order)) {
      skipped += 1;
      continue;
    }

    const updateData = {
      fulfilmentStatus: "completed",
      status: "Completed",
      orderStatus: "completed",
      completedAt: now,
      autoCompleted: true,
      autoCompletedAt: now,
      autoCompleteAfter: null,
      autoCompleteReason: "no_customer_follow_up_after_delivery",
      archiveAfter: archiveAfterCompleteDate(),
      updatedAt: now,
      lastFulfilmentUpdatedAt: now,
      lastFulfilmentUpdatedByName: "System",
      lastFulfilmentUpdatedByEmail: "system@recoverytools.au",
      timeline: admin.firestore.FieldValue.arrayUnion(timelineEntry({
        type: "auto_complete",
        label: "Order auto-completed after delivery follow-up window",
        at: now,
        metadata: { reason: "no_customer_follow_up_after_delivery" },
      })),
    };

    batch.set(doc.ref, updateData, { merge: true });
    mirrorOrderLifecycleUpdate({
      db,
      batch,
      orderId: doc.id,
      order,
      updateData,
    });
    completed += 1;
  }

  if (completed > 0) {
    await batch.commit();
  }

  return { completed, skipped };
}

async function archiveEligibleCompletedOrders({ db, now }) {
  const snapshot = await db
    .collection("orders")
    .where("archiveAfter", "<=", now)
    .limit(150)
    .get();

  const batch = db.batch();
  let archived = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const order = doc.data();
    const status = cleanString(order.fulfilmentStatus || order.status).toLowerCase();

    if (status !== "completed" || order.archivedAt || order.archived === true || isOpenCustomerFollowUp(order)) {
      skipped += 1;
      continue;
    }

    const updateData = {
      archived: true,
      archivedAt: now,
      archiveReason: "completed_order_older_than_30_days",
      updatedAt: now,
      timeline: admin.firestore.FieldValue.arrayUnion(timelineEntry({
        type: "auto_archive",
        label: "Order archived automatically after completion window",
        at: now,
        metadata: { reason: "completed_order_older_than_30_days" },
      })),
    };

    batch.set(doc.ref, updateData, { merge: true });
    mirrorOrderLifecycleUpdate({
      db,
      batch,
      orderId: doc.id,
      order,
      updateData,
    });
    archived += 1;
  }

  if (archived > 0) {
    await batch.commit();
  }

  return { archived, skipped };
}

export const maintainOrderLifecycle = onSchedule(
  {
    region: "australia-southeast1",
    schedule: "every day 02:00",
    timeZone: "Australia/Brisbane",
  },
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    const completeResult = await completeEligibleDeliveredOrders({ db, now });
    const archiveResult = await archiveEligibleCompletedOrders({ db, now });

    console.info("Order lifecycle maintenance complete.", {
      ...completeResult,
      ...archiveResult,
    });
  },
);
