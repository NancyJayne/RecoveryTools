import { showTabContent } from "../utils/utils.js";

// Handles sidebar navigation for admin dashboard
function hasRole(roleValue, targetRole) {
  if (!roleValue) return false;

  if (typeof roleValue === "string") {
    return roleValue
      .split(",")
      .map((role) => role.trim())
      .includes(targetRole);
  }

  if (typeof roleValue === "object") {
    return roleValue[targetRole] === true;
  }

  return false;
}

export function initAdminNavigation(role) {
  if (!hasRole(role, "admin")) return;

  const container = document.getElementById("adminSection");
  if (!container) return;

  const map = {
    "/admin": "adminDashboardSection",
    "/admin/orders": "adminOrdersSection",
    "/admin/approvals": "adminApprovalsSection",
    "/admin/content-controls": "adminContentControlsSection",
    "/admin/builder": "adminContentBuilderSection",
    "/admin/products": "productManagerPanel",
    "/admin/workshops": "adminWorkshopApprovals",
    "/admin/courses": "pendingCourseApprovals",
    "/admin/affiliates": "adminAffiliateStats",
    "/admin/anato-me": "anatoMeForm",
    "/admin/emails": "adminEmailSection",
    "/admin/reviews": "adminReviewsFeedbackSection",
    "/admin/business": "adminBusinessSettingsSection",
    "/admin/content": "adminContentBuilderSection",
    "/admin/crm": "userRoleManager",
  };

  function showByPath(path) {
    if (!path.startsWith("/admin")) return;

    const clean = path.split("?")[0].replace(/\/?$/, "");
    const tabId = map[clean] || "adminDashboardSection";

    container.querySelectorAll(".admin-tab, .admin-section").forEach((el) => {
      el.classList.add("hidden");
    });
    document.getElementById(tabId)?.classList.remove("hidden");
    showTabContent("adminSection");
  }

  document.querySelectorAll(".admin-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const href = link.getAttribute("href") || "/admin";
      history.pushState({}, "", href);
      showByPath(href);
    });
  });

  window.addEventListener("popstate", () => {
    showByPath(window.location.pathname);
  });

  // activate based on current path on load if URL is within /admin
  if (window.location.pathname.startsWith("/admin")) {
    showByPath(window.location.pathname);
  }
}
