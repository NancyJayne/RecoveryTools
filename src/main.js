// main.js – Core App Init for Recovery Tools

import "./style.css";
import { initFirebase, getRecaptchaSiteKey, auth } from "./utils/firebase-config.js";
import { setupAuthState, validateTokenFromURL } from "./auth/user-auth.js";
import { setupAuthModal } from "./auth/auth-modal.js";
import { getUserRole, setupRoleUI } from "./auth/user-roles.js";
import { handleReferralFromURL } from "./affiliate/affiliate-referrals.js";
import { updateCartCount } from "./shop/shop-cart.js";
import { logClientError } from "./utils/logClientError.js";
import { setupNavMenuToggle, scrollToElement, showToast, debounce, showTabContent } from "./utils/utils.js";
import { observeAdminPanel } from "./utils/observe-admin-panels.js";
import { loadRecaptchaScript } from "./utils/loadRecaptcha.js";

const siteKey = getRecaptchaSiteKey();
if (siteKey) loadRecaptchaScript(siteKey);


window.showToast = showToast;
window.scrollToElement = scrollToElement;

const adjustMainHeight = debounce(() => {
  const header = document.querySelector("header");
  const footer = document.querySelector("footer");
  const main = document.querySelector("main");
  if (!header || !footer || !main) return;
  const headerHeight = header.offsetHeight;
  const footerHeight = footer.offsetHeight;
  main.style.minHeight = `calc(100vh - ${headerHeight + footerHeight}px)`;
}, 150);

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

function handleSectionFromURL() {
  const pathSegment = window.location.pathname.split("/").filter(Boolean)[0];
  const sectionId = pathSegment ? `${pathSegment}Section` : "homeSection";
  showTabContent(sectionId);
  updateMetadata(sectionId);
}

document.addEventListener("DOMContentLoaded", async () => {
  await initFirebase();
  await setupAuthState();
  const role = await getUserRole();

 if (auth?.currentUser) setupRoleUI(auth.currentUser);

  handleSectionFromURL();
  setupAuthModal();
  updateCartCount();
  validateTokenFromURL();
  handleReferralFromURL();
  adjustMainHeight();
  setupNavMenuToggle();

  const cleanPath = window.location.pathname.split("?")[0].split("#")[0];
  import("./app-entry.js").then((m) => {
    m.loadModuleByPath(cleanPath, role);
  });

  window.logClientError = logClientError;

  window.addEventListener("resize", adjustMainHeight);
  window.addEventListener("popstate", () => {
    handleSectionFromURL();
    scrollToTop();
  });

  observeAdminPanel("productManagerPanel", "./admin/admin-products.js", "setupProductManager");
  observeAdminPanel("pendingCourseApprovals", "./admin/admin-course.js", "setupCourseApprovals");
  observeAdminPanel("adminWorkshopApprovals", "./admin/admin-workshops.js", "setupWorkshopManagement");
});
