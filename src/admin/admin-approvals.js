import { httpsCallable } from "firebase/functions";
import { functions } from "../utils/firebase-config.js";

const COUNT_FIELDS = {
  content: "pendingContentApprovals",
  workshops: "pendingWorkshopApprovals",
  courses: "pendingCourseApprovals",
  affiliates: "pendingAffiliateApprovals",
  therapists: "pendingTherapistApprovals",
  reviews: "pendingReviewApprovals",
  feedback: "pendingFeedbackApprovals",
};

function setApprovalCount(type, count) {
  const badge = document.querySelector(`[data-approval-badge='${type}']`);
  const card = document.querySelector(`[data-approval-card='${type}']`);
  if (!badge || !card) return;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", count < 1);
  card.classList.toggle("border-purple-500", count > 0);
  card.classList.toggle("bg-purple-950/20", count > 0);
  card.classList.toggle("border-gray-700", count < 1);
}

function renderApprovalCounts(stats = {}) {
  Object.entries(COUNT_FIELDS).forEach(([type, field]) => {
    setApprovalCount(type, Number(stats[field] || 0));
  });
}

export async function setupApprovalDashboard() {
  const section = document.getElementById("adminApprovalsSection");
  if (!section) return;
  if (section.dataset.approvalCountsBound !== "true") {
    window.addEventListener("admin-approval-counts", (event) => {
      renderApprovalCounts(event.detail || {});
    });
    section.dataset.approvalCountsBound = "true";
  }
  try {
    const getStats = httpsCallable(functions, "getUserDashboardStats");
    const result = await getStats();
    const stats = result.data || {};
    renderApprovalCounts(stats);
  } catch (error) {
    console.warn("Could not load approval counters:", error);
  }
}

export default setupApprovalDashboard;
