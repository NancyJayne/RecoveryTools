import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const CANCELLATION_STATUSES = new Set([
  "paused", "hidden", "draft", "cancelled", "canceled", "archived",
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function variantStatus(variant = {}) {
  const candidates = [variant.status, variant.shopStatus, variant.marketplaceMode]
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean);
  const cancellationStatus = candidates.find((value) => CANCELLATION_STATUSES.has(value));
  if (cancellationStatus) return cancellationStatus;
  if (candidates.length) return candidates[0];
  if (variant.visible === false || variant.websiteVisible === false) return "hidden";
  return "draft";
}

function eventDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const raw = clean(value);
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)
    ? `${raw}+10:00`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function orderLines(order = {}) {
  if (Array.isArray(order.orderLines) && order.orderLines.length) return order.orderLines;
  if (Array.isArray(order.products) && order.products.length) return order.products;
  return [];
}

function orderContainsVariant(order, variantId) {
  return orderLines(order).some((line) =>
    clean(line.productVariantId || line.variantId) === variantId);
}

function alreadyRefunded(order = {}) {
  return clean(order.refundStatus || order.paymentStatus).toLowerCase() === "refunded";
}

function userIdForOrder(order = {}) {
  return clean(order.userId || order.buyerUid || order.uid);
}

async function hideProductWithoutActiveVariants(db, variant = {}) {
  const productId = clean(variant.productId);
  if (!productId) return;
  const productRef = db.collection("products").doc(productId);
  const variantsQuery = db.collection("productVariants").where("productId", "==", productId);
  await db.runTransaction(async (transaction) => {
    const [productSnap, variantsSnap] = await Promise.all([
      transaction.get(productRef),
      transaction.get(variantsQuery),
    ]);
    if (!productSnap.exists) return;
    const hasActiveVariant = variantsSnap.docs.some((doc) => variantStatus(doc.data()) === "active");
    if (hasActiveVariant) return;
    const product = productSnap.data() || {};
    const alreadyHidden = clean(product.marketplaceMode).toLowerCase() === "hidden" &&
      product.visible === false && product.websiteVisible === false;
    if (alreadyHidden && product.autoHiddenNoActiveVariants === true) return;
    transaction.set(productRef, {
      marketplaceMode: "hidden",
      shopStatus: "draft",
      visible: false,
      websiteVisible: false,
      autoHiddenNoActiveVariants: true,
      autoHiddenNoActiveVariantsAt: admin.firestore.FieldValue.serverTimestamp(),
      autoHiddenNoActiveVariantsReason: "No active Product variants",
      marketplaceModeBeforeNoActiveVariants: clean(product.marketplaceMode),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByName: "System",
      updatedByEmail: "system@recoverytools.au",
    }, { merge: true });
  });
}

export const flagCancelledWorkshopOrders = onDocumentUpdated(
  {
    region: "australia-southeast1",
    document: "productVariants/{variantId}",
  },
  async (event) => {
    const before = event.data?.before.data() || {};
    const after = event.data?.after.data() || {};
    const variantId = clean(event.params.variantId);
    const previousStatus = variantStatus(before);
    const nextStatus = variantStatus(after);
    const db = admin.firestore();
    await hideProductWithoutActiveVariants(db, after);
    const cancellationTransition = CANCELLATION_STATUSES.has(nextStatus) && previousStatus !== nextStatus;
    const reactivationTransition = nextStatus === "active" && CANCELLATION_STATUSES.has(previousStatus);
    if (!variantId || (!cancellationTransition && !reactivationTransition)) {
      return;
    }

    const startsAt = eventDate(after.eventStartAt || before.eventStartAt);
    if (!startsAt || startsAt.getTime() <= Date.now()) return;

    const ordersSnap = await db.collection("orders").limit(500).get();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const timelineAt = admin.firestore.Timestamp.now();
    const variantName = clean(after.variantName || after.name || before.variantName || before.name) || variantId;
    const reason = cancellationTransition
      ? `Workshop session ${variantName} was ${nextStatus} before its event date. Refund review required.`
      : `Workshop session ${variantName} was reinstated as active before its event date.`;
    const affected = ordersSnap.docs.filter((doc) => {
      const order = doc.data() || {};
      if (!orderContainsVariant(order, variantId) || alreadyRefunded(order)) return false;
      if (!reactivationTransition) return true;
      return clean(order.customerFollowUpStatus).toLowerCase() === "workshop_cancellation" &&
        clean(order.workshopCancellationVariantId) === variantId;
    });

    for (let start = 0; start < affected.length; start += 200) {
      const batch = db.batch();
      affected.slice(start, start + 200).forEach((doc) => {
        const order = doc.data() || {};
        if (cancellationTransition &&
          clean(order.customerFollowUpStatus).toLowerCase() === "workshop_cancellation" &&
          clean(order.workshopCancellationVariantId) === variantId
        ) return;
        const previousNotes = clean(order.customerFollowUpNotes);
        const update = cancellationTransition
          ? {
            customerFollowUpStatus: "workshop_cancellation",
            customerFollowUpOpen: true,
            customerFollowUpNotes: previousNotes ? `${previousNotes}\n\n${reason}` : reason,
            workshopCancellationVariantId: variantId,
            workshopCancellationVariantName: variantName,
            workshopCancellationReason: reason,
            workshopCancellationFlaggedAt: now,
            updatedAt: now,
            timeline: admin.firestore.FieldValue.arrayUnion({
              type: "workshop_cancellation_flagged",
              label: `Workshop cancellation flagged - ${variantName}`,
              at: timelineAt,
              byName: "System",
              byEmail: "system@recoverytools.au",
              metadata: {
                productVariantId: variantId,
                previousStatus,
                status: nextStatus,
                eventStartAt: startsAt.toISOString(),
                reason,
              },
            }),
          }
          : {
            customerFollowUpStatus: "none",
            customerFollowUpOpen: false,
            customerFollowUpResolution: "",
            workshopCancellationVariantId: "",
            workshopCancellationVariantName: "",
            workshopCancellationReason: "",
            workshopCancellationReinstatedAt: now,
            updatedAt: now,
            timeline: admin.firestore.FieldValue.arrayUnion({
              type: "workshop_cancellation_reinstated",
              label: `Workshop reinstated - ${variantName}`,
              at: timelineAt,
              byName: "System",
              byEmail: "system@recoverytools.au",
              metadata: {
                productVariantId: variantId,
                previousStatus,
                status: nextStatus,
                eventStartAt: startsAt.toISOString(),
                reason,
              },
            }),
          };
        batch.set(doc.ref, update, { merge: true });
        const userId = userIdForOrder(order);
        if (userId) {
          batch.set(
            db.collection("users").doc(userId).collection("orders").doc(doc.id),
            update,
            { merge: true },
          );
        }
      });
      await batch.commit();
    }

    await db.collection("workshopCancellationRuns").add({
      productVariantId: variantId,
      productVariantName: variantName,
      previousStatus,
      status: nextStatus,
      eventStartAt: admin.firestore.Timestamp.fromDate(startsAt),
      affectedOrderCount: affected.length,
      action: cancellationTransition ? "cancellation_flagged" : "workshop_reinstated",
      reason,
      createdAt: now,
    });
  },
);
