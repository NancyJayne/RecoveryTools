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

function needsAssignment(order = {}) {
  return (
    order.hasPhysicalItems !== false &&
    !cleanString(order.assignedAdminUid) &&
    fulfilmentStatus(order) === "new"
  );
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
