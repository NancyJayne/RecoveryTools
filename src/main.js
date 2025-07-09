// main.js – Core App Init for Recovery Tools

import "./style.css";
import { getRecaptchaSiteKey, auth } from "./utils/firebase-config.js";
import { validateTokenFromURL } from "./auth/user-auth.js";
import { setupAuthModal } from "./auth/auth-modal.js";
import { setupRoleUI, getUserRole } from "./auth/user-roles.js";
import { handleReferralFromURL } from "./affiliate/affiliate-referrals.js";
import { updateCartCount } from "./shop/shop-cart.js";
import { logClientError } from "./utils/logClientError.js";
import { setupNavMenuToggle, scrollToElement, showToast, debounce, showTabContent } from "./utils/utils.js";
import { observeAdminPanel } from "./utils/observe-admin-panels.js";
import { initAdminNavigation } from "./admin/admin-navigation.js";
import { loadRecaptchaScript } from "./utils/loadRecaptcha.js";
import { initAppEntry } from "./app-entry.js";

const siteKey = getRecaptchaSiteKey();
if (siteKey) loadRecaptchaScript(siteKey);


window.showToast = showToast;
window.scrollToElement = scrollToElement;
// Utility for resizing main content area
const adjustMainHeight = debounce(() => {
  const main = document.querySelector("main");
  if (!main) return;
  main.style.minHeight = "auto";
}, 150);

// Make main height adjustment utility globally available
window.adjustMainHeight = adjustMainHeight;

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateMetadata(tab) {
  const titles = {
    homeSection: "Recovery Tools | Home",
    shopSection: "Shop | Recovery Tools",
    programsSection: "Programs | Recovery Tools",
    anatoMeSection: "Anato-Me | Recovery Tools",
    workshopsSection: "Workshops | Recovery Tools",
    coursesSection: "Courses | Recovery Tools",
    profileSection: "Your Profile | Recovery Tools",
    aboutSection: "About Us | Recovery Tools",
    contactSection: "Contact Us | Recovery Tools",
  };

  const descriptions = {
    homeSection: "Explore expert-designed recovery tools and programs.",
    shopSection: "Browse therapeutic tools and recovery gear designed by clinicians.",
    programsSection: "Self-guided rehab and mobility programs.",
    anatoMeSection: "Funny, relatable stories about pain and recovery.",
    workshopsSection: "Live events and hands-on recovery experiences.",
    coursesSection: "Clinically-backed recovery courses and education.",
    profileSection: "View your recovery progress, orders, and referrals.",
    aboutSection: "Learn about our mission to make recovery accessible and science-based.",
    contactSection: "Have a question? we are here to help. ask away!",
  };

  const currentTitle = titles[tab] || "Recovery Tools";
  const currentDescription = descriptions[tab] || "Explore tools, courses, and programs for pain and recovery.";

  document.title = currentTitle;
  document.querySelector("meta[name='description']")?.setAttribute("content", currentDescription);
  document.querySelector("meta[property='og:title']")?.setAttribute("content", currentTitle);
  document.querySelector("meta[property='og:description']")?.setAttribute("content", currentDescription);
  document.querySelector("meta[name='twitter:title']")?.setAttribute("content", currentTitle);
  document.querySelector("meta[name='twitter:description']")?.setAttribute("content", currentDescription);
}

async function handleSectionFromURL() {
  const path = window.location.pathname;
  const pathSegment = path.split("/").filter(Boolean)[0];
  const sectionId = pathSegment ? `${pathSegment}Section` : "homeSection";

  if (path.startsWith("/admin")) {
    const role = await getUserRole();
    if (role !== "admin") {
      history.replaceState({}, "", "/profile");
      showTabContent("profileSection");
      updateMetadata("profileSection");
      showToast("Insufficient permissions to access admin panel", "error");
      return;
    }
  }

  showTabContent(sectionId);
  updateMetadata(sectionId);
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await initAppEntry();
  } catch (err) {
    console.error("App initialization failed:", err);
  }

  const role = await getUserRole();

  if (auth?.currentUser) setupRoleUI(auth.currentUser);

  await handleSectionFromURL();
  setupAuthModal();
  updateCartCount();
  validateTokenFromURL();
  handleReferralFromURL();
  adjustMainHeight();
  setupNavMenuToggle();

  window.logClientError = logClientError;

  window.addEventListener("resize", adjustMainHeight);
  window.addEventListener("popstate", async () => {
    await handleSectionFromURL();
    scrollToTop();
  });

  observeAdminPanel("productManagerPanel", "./admin/admin-products.js", "setupProductManager");
  observeAdminPanel("pendingCourseApprovals", "./admin/admin-course.js", "setupCourseApprovals");
  observeAdminPanel("adminWorkshopApprovals", "./admin/admin-workshops.js", "setupWorkshopManagement");
  observeAdminPanel("adminOrdersSection", "./admin/admin-orders.js", "setupOrderManagement");
  observeAdminPanel("userRoleManager", "./admin/admin-crm.js", "setupRoleManager");
  observeAdminPanel("anatoMeForm", "./admin/admin-anatoMe.js", "setupAnatoMeEpisodeAdminForm");

  initAdminNavigation(role);
});
