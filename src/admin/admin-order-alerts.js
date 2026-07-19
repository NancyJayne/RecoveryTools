import { functions } from "../utils/firebase-config.js";
import { httpsCallable } from "firebase/functions";

let alertPollId = null;

function setBadge({ orderCount = 0, approvalCount = 0 }) {
  const badge = document.getElementById("adminOrderAlertBadge");
  if (!badge) return;
  const count = orderCount + approvalCount;
  const approvalsBadge = document.getElementById("adminApprovalsMenuBadge");
  const ordersBadge = document.getElementById("adminOrdersMenuBadge");

  if (!count) {
    badge.classList.add("hidden");
    badge.textContent = "0";
  } else {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.remove("hidden");
  }
  badge.href = approvalCount > 0 ? "/admin/approvals" : "/admin/orders";
  const approvalLabel = `${approvalCount} pending approval${approvalCount === 1 ? "" : "s"}`;
  const orderLabel = `${orderCount} unassigned order${orderCount === 1 ? "" : "s"}`;
  badge.title = approvalCount > 0 && orderCount > 0
    ? `${approvalLabel}; ${orderLabel}`
    : approvalCount > 0 ? approvalLabel : orderLabel;
  badge.setAttribute("aria-label", badge.title);
  if (approvalsBadge) {
    approvalsBadge.textContent = approvalCount > 99 ? "99+" : String(approvalCount);
    approvalsBadge.classList.toggle("hidden", approvalCount < 1);
  }
  if (ordersBadge) {
    ordersBadge.textContent = orderCount > 99 ? "99+" : String(orderCount);
    ordersBadge.classList.toggle("hidden", orderCount < 1);
  }
}

export async function refreshAdminOrderAlertBadge() {
  const badge = document.getElementById("adminOrderAlertBadge");
  if (!badge) return;

  try {
    const getAlerts = httpsCallable(functions, "getAdminOrderAlerts");
    const getStats = httpsCallable(functions, "getUserDashboardStats");
    const [alertsResult, statsResult] = await Promise.all([getAlerts(), getStats()]);
    setBadge({
      orderCount: Number(alertsResult.data?.unassignedCount || 0),
      approvalCount: Number(statsResult.data?.pendingApprovals || 0),
    });
    window.dispatchEvent(new CustomEvent("admin-approval-counts", {
      detail: statsResult.data || {},
    }));
  } catch (err) {
    console.warn("Failed to refresh admin order alerts:", err);
    setBadge({});
  }
}

export function clearAdminOrderAlertBadge() {
  setBadge({});
}

export function startAdminAlertPolling() {
  if (alertPollId) return;
  refreshAdminOrderAlertBadge();
  alertPollId = window.setInterval(refreshAdminOrderAlertBadge, 60000);
}

export function stopAdminAlertPolling() {
  if (!alertPollId) return;
  window.clearInterval(alertPollId);
  alertPollId = null;
}
