import { showTabContent } from "../utils/utils.js";

// Handles sidebar navigation for admin dashboard
export function initAdminNavigation(role) {
  if (role !== "admin") return;

  const container = document.getElementById("adminSection");
  if (!container) return;

  const map = {
    "/admin": "adminDashboardSection",
    "/admin/orders": "adminOrdersSection",
    "/admin/workshops": "adminWorkshopApprovals",
    "/admin/courses": "pendingCourseApprovals",
    "/admin/anato-me": "anatoMeForm",
    "/admin/crm": "userRoleManager",
  };

  function showByPath(path) {
    if (!path.startsWith("/admin")) return;

    const clean = path.replace(/\/?$/, "");
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