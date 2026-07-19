import { httpsCallable } from "firebase/functions";
import { functions } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function starText(rating) {
  const value = Number(rating || 0);
  return value >= 1 ? `${value}/5` : "No rating";
}

function requestTypeLabel(type) {
  const labels = {
    feedback: "Order feedback",
    return_requested: "Return requested",
    exchange_requested: "Replacement or swap",
    damaged_item: "Damaged item",
    complaint_open: "Complaint",
  };
  return labels[type] || String(type || "Request").replace(/_/g, " ");
}

function reviewStatusClass(review) {
  if (review.visible === true || review.status === "approved") return "bg-green-900/60 text-green-200";
  if (review.status === "hidden") return "bg-red-900/60 text-red-200";
  if (review.status === "archived") return "bg-gray-700 text-gray-200";
  return "bg-yellow-900/60 text-yellow-100";
}

function issueStatusClass(issue) {
  if (issue.issueType === "feedback") return "bg-blue-900/60 text-blue-200";
  if (issue.status === "resolved") return "bg-green-900/60 text-green-200";
  if (issue.status === "archived") return "bg-gray-700 text-gray-200";
  if (issue.status === "open") return "bg-yellow-900/60 text-yellow-100";
  return "bg-gray-700 text-gray-200";
}

function renderProductReviews(reviews) {
  const list = document.getElementById("adminProductReviewsList");
  if (!list) return;

  if (!reviews.length) {
    list.textContent = "No product reviews found.";
    return;
  }

  list.innerHTML = reviews.map((review) => `
    <article class="rounded border border-gray-700 bg-gray-800 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h4 class="font-semibold text-white">${escapeHTML(review.productName)}</h4>
          <p class="text-xs text-gray-400 break-all">${escapeHTML(review.productId)}</p>
        </div>
        <span class="rounded px-2 py-1 text-xs font-semibold ${reviewStatusClass(review)}">
          ${escapeHTML(review.status || "pending")}
        </span>
      </div>
      <div class="mt-3 text-sm text-gray-200">${escapeHTML(review.comment)}</div>
      <div class="mt-3 grid gap-1 text-xs text-gray-400 sm:grid-cols-2">
        <div><strong class="text-gray-300">Rating:</strong> ${escapeHTML(starText(review.rating))}</div>
        <div><strong class="text-gray-300">Submitted:</strong> ${escapeHTML(formatDate(review.createdAt))}</div>
        <div><strong class="text-gray-300">Customer:</strong> ${escapeHTML(review.userName || "-")}</div>
        <div><strong class="text-gray-300">Email:</strong> ${escapeHTML(review.userEmail || "-")}</div>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          class="approve-review-btn rounded bg-[#407471] px-3 py-2 text-sm text-white hover:bg-[#305a56]"
          data-product-id="${escapeHTML(review.productId)}"
          data-review-id="${escapeHTML(review.reviewId || review.id)}"
          data-action="approve"
        >
          Approve
        </button>
        <button
          class="approve-review-btn rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
          data-product-id="${escapeHTML(review.productId)}"
          data-review-id="${escapeHTML(review.reviewId || review.id)}"
          data-action="hide"
        >
          Hide
        </button>
        <button
          class="approve-review-btn rounded bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-700"
          data-product-id="${escapeHTML(review.productId)}"
          data-review-id="${escapeHTML(review.reviewId || review.id)}"
          data-action="archive"
        >
          Archive
        </button>
      </div>
    </article>
  `).join("");
}

function renderOrderIssues(issues) {
  const list = document.getElementById("adminOrderFeedbackList");
  if (!list) return;

  if (!issues.length) {
    list.textContent = "No order feedback or help requests found.";
    return;
  }

  list.innerHTML = issues.map((issue) => `
    <article class="rounded border border-gray-700 bg-gray-800 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h4 class="font-semibold text-white">${escapeHTML(requestTypeLabel(issue.issueType))}</h4>
          <button
            type="button"
            class="view-feedback-order-btn text-left text-xs text-blue-300 hover:underline break-all"
            data-order-id="${escapeHTML(issue.orderId)}"
          >
            ${escapeHTML(issue.orderId || "No order ID")}
          </button>
        </div>
        <span class="rounded px-2 py-1 text-xs font-semibold ${issueStatusClass(issue)}">
          ${escapeHTML(issue.status || issue.customerFollowUpStatus || "submitted")}
        </span>
      </div>
      <div class="mt-3 text-sm text-gray-200">${escapeHTML(issue.details || "No message supplied.")}</div>
      <div class="mt-3 grid gap-1 text-xs text-gray-400 sm:grid-cols-2">
        <div><strong class="text-gray-300">Submitted:</strong> ${escapeHTML(formatDate(issue.createdAt))}</div>
        <div><strong class="text-gray-300">Customer:</strong> ${escapeHTML(issue.customerName || "-")}</div>
        <div><strong class="text-gray-300">Email:</strong> ${escapeHTML(issue.customerEmail || "-")}</div>
        <div><strong class="text-gray-300">Affected:</strong> ${escapeHTML(issue.affectedItems || "-")}</div>
        <div><strong class="text-gray-300">Outcome:</strong> ${escapeHTML(issue.preferredOutcome || "-")}</div>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          class="update-issue-status-btn rounded bg-green-800 px-3 py-2 text-sm text-white hover:bg-green-700"
          data-issue-id="${escapeHTML(issue.issueId || issue.id)}"
          data-status="resolved"
        >
          Mark resolved
        </button>
        <button
          type="button"
          class="update-issue-status-btn rounded bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-700"
          data-issue-id="${escapeHTML(issue.issueId || issue.id)}"
          data-status="archived"
        >
          Archive
        </button>
      </div>
    </article>
  `).join("");
}

function bindOrderIssueActions() {
  document.getElementById("adminOrderFeedbackList")?.addEventListener("click", async (event) => {
    const viewBtn = event.target.closest(".view-feedback-order-btn");
    if (viewBtn?.dataset.orderId) {
      window.location.href = `/admin/orders?filter=${encodeURIComponent(viewBtn.dataset.orderId)}`;
      return;
    }

    const statusBtn = event.target.closest(".update-issue-status-btn");
    if (!statusBtn) return;

    try {
      statusBtn.disabled = true;
      statusBtn.textContent = statusBtn.dataset.status === "archived" ? "Archiving..." : "Updating...";
      const updateIssue = httpsCallable(functions, "updateOrderIssueStatus");
      await updateIssue({
        issueId: statusBtn.dataset.issueId,
        status: statusBtn.dataset.status,
      });
      showToast(statusBtn.dataset.status === "archived" ? "Feedback archived" : "Feedback updated", "success");
      await loadOrderIssues();
    } catch (err) {
      console.error("Failed to update order feedback:", err);
      showToast(err.message || "Failed to update order feedback", "error");
    }
  });
}

async function loadProductReviews() {
  const list = document.getElementById("adminProductReviewsList");
  if (list) list.textContent = "Loading product reviews...";
  const getReviews = httpsCallable(functions, "getAdminProductReviews");
  const result = await getReviews({ limit: 100 });
  renderProductReviews(Array.isArray(result.data?.reviews) ? result.data.reviews : []);
}

async function loadOrderIssues() {
  const list = document.getElementById("adminOrderFeedbackList");
  if (list) list.textContent = "Loading order feedback...";
  const getIssues = httpsCallable(functions, "getOrderIssuesForAdmin");
  const result = await getIssues({ limit: 100 });
  renderOrderIssues(Array.isArray(result.data?.issues) ? result.data.issues : []);
}

function bindReviewActions() {
  document.getElementById("adminProductReviewsList")?.addEventListener("click", async (event) => {
    const btn = event.target.closest(".approve-review-btn");
    if (!btn) return;

    try {
      btn.disabled = true;
      const action = btn.dataset.action || "hide";
      btn.textContent = action === "approve" ? "Approving..." : action === "archive" ? "Archiving..." : "Hiding...";
      const approveReview = httpsCallable(functions, "approveReview");
      await approveReview({
        productId: btn.dataset.productId,
        reviewId: btn.dataset.reviewId,
        approve: action === "approve",
        action,
      });
      showToast(
        action === "approve" ? "Review approved" : action === "archive" ? "Review archived" : "Review hidden",
        "success",
      );
      await loadProductReviews();
    } catch (err) {
      console.error("Failed to update review:", err);
      showToast(err.message || "Failed to update review", "error");
    }
  });
}

export async function setupReviewsFeedback() {
  const section = document.getElementById("adminReviewsFeedbackSection");
  if (!section || section.dataset.bound === "true") return;
  section.dataset.bound = "true";

  bindReviewActions();
  bindOrderIssueActions();
  document.getElementById("refreshReviewsFeedbackBtn")?.addEventListener("click", async () => {
    await Promise.all([loadProductReviews(), loadOrderIssues()]);
  });

  try {
    await Promise.all([loadProductReviews(), loadOrderIssues()]);
  } catch (err) {
    console.error("Failed to load reviews and feedback:", err);
    showToast(err.message || "Failed to load reviews and feedback", "error");
  }
}

export default setupReviewsFeedback;
