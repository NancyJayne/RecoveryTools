import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

function cleanStatus(order) {
  const status = String(
    order.fulfilmentStatus ||
    order.orderStatus ||
    order.status ||
    "new",
  ).toLowerCase().trim();

  if (status === "paid" || status === "pending" || status === "approved") return "new";
  if (status === "complete") return "completed";
  return status;
}

function cleanCustomerFollowUpStatus(order) {
  return String(order.customerFollowUpStatus || "none").toLowerCase().trim();
}

function hasOpenCustomerIssue(order) {
  const status = cleanCustomerFollowUpStatus(order);
  if (["return_requested", "exchange_requested", "complaint_open"].includes(status)) return true;
  if (["none", "resolved"].includes(status)) return false;
  return order.customerFollowUpOpen === true;
}

function isOpenOrder(order) {
  const status = cleanStatus(order);
  if (order.archived === true) return false;
  if (hasOpenCustomerIssue(order)) return true;
  return !["completed", "cancelled", "archived"].includes(status);
}

function isNewUnassignedOrder(order) {
  return (
    order.archived !== true &&
    cleanStatus(order) === "new" &&
    !order.assignedAdminUid
  );
}

function isOpenCustomerIssue(order) {
  return order.archived !== true && hasOpenCustomerIssue(order);
}

function dateValue(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isDueSoon(order, now = new Date()) {
  if (!isOpenOrder(order)) return false;
  const dueDate = dateValue(order.dueDate);
  if (!dueDate) return false;
  const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
  return dueDate <= threeDaysFromNow;
}

function isDraftContent(data = {}) {
  return String(data.status || data.approvalStatus || "draft").toLowerCase().trim() === "draft";
}

function isPendingApproval(data = {}) {
  const approvalStatus = String(data.approvalStatus || "").toLowerCase().trim();
  const status = String(data.status || "").toLowerCase().trim();
  if (["awaiting-approval", "awaiting approval"].includes(approvalStatus)) return true;
  if (["approved", "hidden", "archived", "rejected", "inactive", "resolved"].includes(status)) {
    return false;
  }

  return (
    data.approved === false ||
    status === "pending" ||
    status === "review" ||
    status === "submitted"
  );
}

function isPendingFeedback(data = {}) {
  const status = String(data.status || data.customerFollowUpStatus || "").toLowerCase().trim();
  if (data.archived === true) return false;
  return !["resolved", "archived", "closed"].includes(status);
}

export const getUserDashboardStats = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Admin access only.");
    }

    try {
      const [
        usersSnap,
        ordersSnap,
        workshopsSnap,
        coursesSnap,
        affiliatesSnap,
        therapistsSnap,
        reviewsSnap,
        orderIssuesSnap,
        itemsSnap,
        blueprintsSnap,
        plansSnap,
      ] = await Promise.all([
        admin.firestore().collection("users").get(),
        admin.firestore().collection("orders").get(),
        admin.firestore().collection("submittedWorkshops").get(),
        admin.firestore().collection("submittedCourses").get(),
        admin.firestore().collection("affiliates").get(),
        admin.firestore().collection("therapists").get(),
        admin.firestore().collectionGroup("reviews").get(),
        admin.firestore().collection("orderIssues").get(),
        admin.firestore().collection("items").get(),
        admin.firestore().collection("blueprints").get(),
        admin.firestore().collection("plans").get(),
      ]);

      const orders = ordersSnap.docs.map((doc) => doc.data());
      const pendingWorkshopApprovals = workshopsSnap.docs.filter((doc) => isPendingApproval(doc.data())).length;
      const pendingCourseApprovals = coursesSnap.docs.filter((doc) => isPendingApproval(doc.data())).length;
      const pendingAffiliateApprovals = affiliatesSnap.docs.filter((doc) => isPendingApproval(doc.data())).length;
      const pendingTherapistApprovals = therapistsSnap.docs.filter((doc) => isPendingApproval(doc.data())).length;
      const pendingReviewApprovals = reviewsSnap.docs.filter((doc) => isPendingApproval(doc.data())).length;
      const pendingFeedbackApprovals = orderIssuesSnap.docs.filter((doc) => isPendingFeedback(doc.data())).length;
      const pendingContentApprovals = [itemsSnap, blueprintsSnap, plansSnap]
        .flatMap((snapshot) => snapshot.docs)
        .filter((doc) => isPendingApproval(doc.data())).length;
      const pendingApprovals =
        pendingContentApprovals +
        pendingWorkshopApprovals +
        pendingCourseApprovals +
        pendingAffiliateApprovals +
        pendingTherapistApprovals +
        pendingReviewApprovals +
        pendingFeedbackApprovals;
      const totalUsers = usersSnap.size;
      const totalOrders = ordersSnap.size;
      const totalRevenue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
      const openOrders = orders.filter(isOpenOrder).length;
      const newUnassignedOrders = orders.filter(isNewUnassignedOrder).length;
      const openCustomerIssues = orders.filter(isOpenCustomerIssue).length;
      const ordersDueSoon = orders.filter((order) => isDueSoon(order)).length;
      const contentDrafts = [itemsSnap, blueprintsSnap, plansSnap]
        .flatMap((snapshot) => snapshot.docs)
        .filter((doc) => isDraftContent(doc.data())).length;

      return {
        totalUsers,
        totalOrders,
        totalRevenue,
        openOrders,
        newUnassignedOrders,
        openCustomerIssues,
        ordersDueSoon,
        contentDrafts,
        pendingApprovals,
        pendingWorkshopApprovals,
        pendingCourseApprovals,
        pendingAffiliateApprovals,
        pendingTherapistApprovals,
        pendingReviewApprovals,
        pendingFeedbackApprovals,
        pendingContentApprovals,
      };
    } catch (err) {
      console.error("Dashboard stats error:", err);
      throw new HttpsError("internal", "Failed to load stats.");
    }
  },
);
