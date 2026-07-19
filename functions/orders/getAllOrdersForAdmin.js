import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function matchesName(order, name) {
  if (!name) return true;
  const normalizedName = String(name).trim().toLowerCase();
  return String(order.userName || order.customerName || "")
    .toLowerCase()
    .includes(normalizedName);
}

function matchesDateRange(order, startDate, endDate) {
  if (!startDate || !endDate) return true;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const purchasedAt = timestampMillis(order.purchasedAt || order.orderDate || order.createdAt);
  return purchasedAt >= start && purchasedAt <= end;
}

function customerFollowUpStatus(order) {
  return String(order.customerFollowUpStatus || "none").toLowerCase().trim();
}

function hasOpenCustomerIssue(order) {
  const status = customerFollowUpStatus(order);
  if (["return_requested", "exchange_requested", "complaint_open"].includes(status)) return true;
  if (["none", "resolved"].includes(status)) return false;
  return order.customerFollowUpOpen === true;
}

async function attachLatestCustomerIssues(db, orders) {
  const issueIds = [...new Set(orders.map((order) => order.latestCustomerIssueId).filter(Boolean))];
  if (!issueIds.length) return orders;
  const snapshots = await Promise.all(issueIds.map((issueId) => db.collection("orderIssues").doc(issueId).get()));
  const issuesById = new Map(snapshots.filter((snap) => snap.exists).map((snap) => [snap.id, {
    id: snap.id,
    ...snap.data(),
  }]));
  return orders.map((order) => ({
    ...order,
    latestCustomerIssue: issuesById.get(order.latestCustomerIssueId) || null,
  }));
}

export const getAllOrdersForAdmin = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    const uid = request.auth?.uid;
    const token = request.auth?.token;

    if (!uid || !token?.admin) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }

    const {
      invoiceNumber,
      name,
      startDate,
      endDate,
      referredBy,
      includeArchived = false,
      issueOnly = false,
    } = request.data || {};
    const db = admin.firestore();
    let ordersRef = db.collection("orders");

    if (invoiceNumber) {
      const doc = await ordersRef.doc(invoiceNumber).get();
      if (!doc.exists) return { orders: [] };
      const order = { id: doc.id, ...doc.data() };
      if (includeArchived ? order.archived !== true : order.archived === true) {
        return { orders: [] };
      }
      if (issueOnly && !hasOpenCustomerIssue(order)) {
        return { orders: [] };
      }
      return { orders: await attachLatestCustomerIssues(db, [order]) };
    }

    if (referredBy) {
      ordersRef = ordersRef.where("referredBy", "==", referredBy);
    }

    const snapshot = await ordersRef.limit(200).get();
    const orders = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((order) => includeArchived ? order.archived === true : order.archived !== true)
      .filter((order) => issueOnly ? hasOpenCustomerIssue(order) : true)
      .filter((order) => matchesName(order, name))
      .filter((order) => matchesDateRange(order, startDate, endDate))
      .sort((a, b) =>
        timestampMillis(b.purchasedAt || b.orderDate || b.createdAt) -
        timestampMillis(a.purchasedAt || a.orderDate || a.createdAt),
      )
      .slice(0, 50);

    return { orders: await attachLatestCustomerIssues(db, orders) };
  },
);
