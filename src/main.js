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
import { applyBusinessProfile } from "./utils/business-profile.js";

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
  const business = window.recoveryBusinessProfile || {};
  const siteName = business.seoTitle || business.name || "Recovery Tools";
  const defaultDescription =
    business.seoDescription || "Explore tools, courses, and programs for pain and recovery.";
  const titles = {
    homeSection: `${siteName} | Home`,
    shopSection: `Shop | ${siteName}`,
    programsSection: `Programs | ${siteName}`,
    anatoMeSection: `Anato-Me | ${siteName}`,
    workshopsSection: `Workshops | ${siteName}`,
    coursesSection: `Courses | ${siteName}`,
    profileSection: `Your Profile | ${siteName}`,
    "order-issueSection": `Order Help | ${siteName}`,
    aboutSection: `About Us | ${siteName}`,
    contactSection: `Contact Us | ${siteName}`,
  };

  const descriptions = {
    homeSection: "Explore expert-designed recovery tools and programs.",
    shopSection: "Browse therapeutic tools and recovery gear designed by clinicians.",
    programsSection: "Self-guided rehab and mobility programs.",
    anatoMeSection: "Funny, relatable stories about pain and recovery.",
    workshopsSection: "Live events and hands-on recovery experiences.",
    coursesSection: "Clinically-backed recovery courses and education.",
    profileSection: "View your recovery progress, orders, and referrals.",
    "order-issueSection": "Request help with a Recovery Tools order.",
    aboutSection: business.aboutDescription ||
      "Learn about our mission to make recovery accessible and science-based.",
    contactSection: "Have a question? we are here to help. ask away!",
  };

  const currentTitle = titles[tab] || siteName;
  const currentDescription = descriptions[tab] || defaultDescription;

  document.title = currentTitle;
  document.querySelector("meta[name='description']")?.setAttribute("content", currentDescription);
  document.querySelector("meta[property='og:title']")?.setAttribute("content", currentTitle);
  document.querySelector("meta[property='og:description']")?.setAttribute("content", currentDescription);
  document.querySelector("meta[name='twitter:title']")?.setAttribute("content", currentTitle);
  document.querySelector("meta[name='twitter:description']")?.setAttribute("content", currentDescription);
}

async function handleSectionFromURL() {
  const path = window.location.pathname;
  if (path === "/login" || path === "/signup" || path === "/reset") return;

  const pathSegment = path.split("/").filter(Boolean)[0];
  const sectionId = pathSegment ? `${pathSegment}Section` : "homeSection";

  if (path.startsWith("/admin")) {
    const roles = await getUserRole();

    if (!roles?.admin) {
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
  applyBusinessProfile();

  window.logClientError = logClientError;

  window.addEventListener("resize", adjustMainHeight);
  window.addEventListener("popstate", async () => {
    await handleSectionFromURL();
    scrollToTop();
  });

  observeAdminPanel("productManagerPanel", "./admin/admin-products.js", "setupProductManager");
  observeAdminPanel("adminContentControlsSection", "./admin/admin-content-controls.js", "setupContentControls");
  observeAdminPanel("pendingCourseApprovals", "./admin/admin-course.js", "setupCourseApprovals");
  observeAdminPanel("adminWorkshopApprovals", "./admin/admin-workshops.js", "setupWorkshopManagement");
  observeAdminPanel("adminOrdersSection", "./admin/admin-orders.js", "setupOrderManagement");
  observeAdminPanel("adminAffiliateStats", "./admin/admin-affiliates.js", "setupAffiliateStats");
  observeAdminPanel("adminEmailSection", "./admin/admin-emails.js", "setupAdminEmails");
  observeAdminPanel("adminReviewsFeedbackSection", "./admin/admin-reviews-feedback.js", "setupReviewsFeedback");
  observeAdminPanel("adminBusinessSettingsSection", "./admin/admin-business-settings.js", "setupBusinessSettings");
  observeAdminPanel("adminContentBuilderSection", "./admin/admin-content-builder.js", "setupContentBuilder");
  observeAdminPanel("userRoleManager", "./admin/admin-crm.js", "setupRoleManager");
  observeAdminPanel("anatoMeForm", "./admin/admin-anatoMe.js", "setupAnatoMeEpisodeAdminForm");

  initAdminNavigation(role);
});
