import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function fulfilmentStatus(order = {}) {
  const status = cleanString(order.fulfilmentStatus || order.orderStatus || order.status).toLowerCase();
  if (!status || status === "paid" || status === "pending" || status === "approved") return "new";
  if (status === "complete") return "completed";
  return status;
}

function orderLines(order = {}) {
  if (Array.isArray(order.orderLines) && order.orderLines.length) return order.orderLines;
  return Array.isArray(order.products) ? order.products : [];
}

function hasWorkshopBooking(order = {}) {
  return orderLines(order).some((line) => {
    const productType = cleanString(line.productType || line.type).toLowerCase();
    const bundleItems = line.bundleInventory || line.bundleInventoryItems || [];
    return productType.includes("workshop") ||
      (Array.isArray(bundleItems) && bundleItems.some((item) => item?.isWorkshop === true));
  });
}

function isPaid(order = {}) {
  const status = cleanString(order.paymentStatus || order.status).toLowerCase();
  return ["paid", "complete", "completed", "succeeded"].includes(status) ||
    Number(order.amountPaid || order.totalPaid || 0) > 0;
}

function needsAssignment(order = {}) {
  if (order.archived === true || cleanString(order.assignedAdminUid)) return false;
  const physicalOrderNeedsWork = order.hasPhysicalItems !== false && fulfilmentStatus(order) === "new";
  const workshopBookingNeedsWork = hasWorkshopBooking(order) && isPaid(order) &&
    !["refunded", "cancelled", "canceled"].includes(
      cleanString(order.refundStatus || order.paymentStatus || order.status).toLowerCase(),
    );
  return physicalOrderNeedsWork || workshopBookingNeedsWork;
}

export const getAdminOrderAlerts = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.uid || request.auth?.token?.admin !== true) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }

    const snapshot = await admin.firestore().collection("orders").limit(200).get();
    const unassignedOrders = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter(needsAssignment);

    return {
      unassignedCount: unassignedOrders.length,
      unassignedOrderIds: unassignedOrders.slice(0, 20).map((order) => order.id),
    };
  },
);
