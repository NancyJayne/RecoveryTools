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

function isPendingApproval(data = {}) {
  const status = String(data.status || "").toLowerCase().trim();
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
      ] = await Promise.all([
        admin.firestore().collection("users").get(),
        admin.firestore().collection("orders").get(),
        admin.firestore().collection("submittedWorkshops").get(),
        admin.firestore().collection("submittedCourses").get(),
        admin.firestore().collection("affiliates").get(),
        admin.firestore().collection("therapists").get(),
        admin.firestore().collectionGroup("reviews").get(),
        admin.firestore().collection("orderIssues").get(),
      ]);

      const orders = ordersSnap.docs.map((doc) => doc.data());
      const pendingWorkshopApprovals = workshopsSnap.docs.filter((doc) => isPendingApproval(doc.data())).length;
      const pendingCourseApprovals = coursesSnap.docs.filter((doc) => isPendingApproval(doc.data())).length;
      const pendingAffiliateApprovals = affiliatesSnap.docs.filter((doc) => isPendingApproval(doc.data())).length;
      const pendingTherapistApprovals = therapistsSnap.docs.filter((doc) => isPendingApproval(doc.data())).length;
      const pendingReviewApprovals = reviewsSnap.docs.filter((doc) => isPendingApproval(doc.data())).length;
      const pendingFeedbackApprovals = orderIssuesSnap.docs.filter((doc) => isPendingFeedback(doc.data())).length;
      const pendingApprovals =
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

      return {
        totalUsers,
        totalOrders,
        totalRevenue,
        openOrders,
        newUnassignedOrders,
        openCustomerIssues,
        pendingApprovals,
        pendingWorkshopApprovals,
        pendingCourseApprovals,
        pendingAffiliateApprovals,
        pendingTherapistApprovals,
        pendingReviewApprovals,
        pendingFeedbackApprovals,
      };
    } catch (err) {
      console.error("Dashboard stats error:", err);
      throw new HttpsError("internal", "Failed to load stats.");
    }
  },
);
