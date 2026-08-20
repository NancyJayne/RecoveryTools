import admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { inventoryTargetsForItems } from "../utils/bundleInventory.js";

const ACTIVE = "active";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function status(value) {
  return clean(value).toLowerCase();
}

function paidOrder(order = {}) {
  const states = [order.paymentStatus, order.orderStatus, order.status].map(status);
  return states.includes("paid") &&
    !states.some((value) => ["cancelled", "canceled", "refunded", "failed", "void"].includes(value));
}

function orderLines(order = {}) {
  return Array.isArray(order.orderLines) && order.orderLines.length
    ? order.orderLines
    : Array.isArray(order.products) ? order.products : [];
}

function itemKey(productId, variantId = "") {
  return `${productId}:${variantId}`;
}

function addQuantity(map, key, quantity) {
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount <= 0) return;
  map.set(key, (map.get(key) || 0) + amount);
}

export async function createInventoryReservation(db, {
  uid,
  items,
  stripeExpiresAt,
  reservationExpiresAt,
}) {
  const reservationRef = db.collection("inventoryReservations").doc();
  const reservationItems = inventoryTargetsForItems(items)
    .filter((item) => item.inventoryTracked === true || item.isWorkshop === true)
    .map((item) => ({
      productId: clean(item.id || item.productId),
      variantId: clean(item.variantId),
      variantCollection: clean(item.variantSourceCollection) || "productVariants",
      name: clean(item.name),
      quantity: Math.max(Number(item.quantity || 1), 1),
      inventoryTracked: item.inventoryTracked === true,
      isWorkshop: item.isWorkshop === true,
      seatCapacity: Math.max(Number(item.seatCapacity || 0), 0),
    }));

  if (!reservationItems.length) return null;

  await db.runTransaction(async (transaction) => {
    const activeQuery = db.collection("inventoryReservations").where("status", "==", ACTIVE);
    const [activeReservations, ordersSnapshot] = await Promise.all([
      transaction.get(activeQuery),
      reservationItems.some((item) => item.isWorkshop)
        ? transaction.get(db.collection("orders"))
        : Promise.resolve(null),
    ]);
    const now = Date.now();
    const reserved = new Map();
    activeReservations.docs.forEach((doc) => {
      const data = doc.data() || {};
      if (Number(data.reservationExpiresAt || 0) <= now) return;
      (Array.isArray(data.items) ? data.items : []).forEach((item) => {
        addQuantity(reserved, itemKey(clean(item.productId), clean(item.variantId)), item.quantity);
      });
    });

    const paidWorkshopTickets = new Map();
    ordersSnapshot?.docs.forEach((doc) => {
      const order = doc.data() || {};
      if (!paidOrder(order)) return;
      orderLines(order).forEach((line) => {
        addQuantity(
          paidWorkshopTickets,
          itemKey(clean(line.productId), clean(line.productVariantId || line.variantId)),
          Math.max(Number(line.quantity || 1) - Number(line.refundedQuantity || 0), 0),
        );
        (line.bundleInventory || line.bundleInventoryItems || []).forEach((component) => {
          if (component.isWorkshop !== true) return;
          addQuantity(
            paidWorkshopTickets,
            itemKey(clean(component.productId), clean(component.productVariantId || component.variantId)),
            Math.max(
              Number(component.quantity || 1) -
                Number(component.quantityPerBundle || 1) * Number(line.refundedQuantity || 0),
              0,
            ),
          );
        });
      });
    });

    const productRefs = [...new Map(reservationItems
      .filter((item) => item.inventoryTracked && !item.variantId)
      .map((item) => [
        item.productId,
        db.collection("products").doc(item.productId),
      ])).values()];
    const variantRefs = [...new Map(reservationItems
      .filter((item) => item.inventoryTracked && item.variantId)
      .map((item) => [
        `${item.variantCollection}/${item.variantId}`,
        db.collection(item.variantCollection).doc(item.variantId),
      ])).values()];
    const [productSnaps, variantSnaps] = await Promise.all([
      Promise.all(productRefs.map((ref) => transaction.get(ref))),
      Promise.all(variantRefs.map((ref) => transaction.get(ref))),
    ]);
    const productStock = new Map(productSnaps.map((snap) => [snap.id, Number(snap.data()?.stock ?? 0)]));
    const variantStock = new Map(variantSnaps.map((snap) => [snap.ref.path, Number(
      snap.data()?.stockQuantity ?? snap.data()?.stock ?? 0,
    )]));

    const requestedProducts = new Map();
    const requestedItems = new Map();
    reservationItems.filter((item) => item.inventoryTracked && !item.variantId).forEach((item) => {
      addQuantity(requestedProducts, item.productId, item.quantity);
    });
    reservationItems.forEach((item) => {
      addQuantity(requestedItems, itemKey(item.productId, item.variantId), item.quantity);
    });

    for (const item of reservationItems) {
      const key = itemKey(item.productId, item.variantId);
      const alreadyReserved = reserved.get(key) || 0;
      const requestedQuantity = requestedItems.get(key) || 0;
      if (item.isWorkshop && item.seatCapacity > 0) {
        const sold = paidWorkshopTickets.get(key) || 0;
        if (sold + alreadyReserved + requestedQuantity > item.seatCapacity) {
          throw new HttpsError("failed-precondition", `${item.name || "This session"} no longer has enough places.`);
        }
      }
      if (!item.inventoryTracked) continue;
      if (item.variantId) {
        const path = `${item.variantCollection}/${item.variantId}`;
        if ((variantStock.get(path) ?? 0) < alreadyReserved + requestedQuantity) {
          throw new HttpsError("failed-precondition", `${item.name || "This option"} no longer has enough stock.`);
        }
      } else {
        const productReserved = reserved.get(itemKey(item.productId)) || 0;
        if ((productStock.get(item.productId) ?? 0) <
            productReserved + (requestedProducts.get(item.productId) || 0)) {
          throw new HttpsError(
            "failed-precondition",
            `${item.name || "This Product"} no longer has enough stock.`,
          );
        }
      }
    }

    transaction.create(reservationRef, {
      reservationId: reservationRef.id,
      uid,
      status: ACTIVE,
      items: reservationItems,
      stripeCheckoutSessionId: "",
      stripeExpiresAt,
      reservationExpiresAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  return reservationRef.id;
}

export async function attachStripeSessionToReservation(db, reservationId, sessionId) {
  if (!reservationId) return;
  await db.collection("inventoryReservations").doc(reservationId).set({
    stripeCheckoutSessionId: sessionId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function finishInventoryReservation(db, reservationId, statusValue, orderId = "") {
  if (!reservationId) return;
  const reservationRef = db.collection("inventoryReservations").doc(reservationId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reservationRef);
    if (!snapshot.exists || snapshot.data()?.status !== ACTIVE) return;
    transaction.set(reservationRef, {
      status: statusValue,
      orderId,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

export function consumeInventoryReservation(db, reservationId, orderId) {
  return finishInventoryReservation(db, reservationId, "consumed", orderId);
}

export function releaseInventoryReservation(db, reservationId) {
  return finishInventoryReservation(db, reservationId, "released");
}
