// ✅ app-entry.js – Updated to handle /signup and /reset as modal flows with safeImport logic

// Exported helpers for main initialization
import { initFirebase, auth } from "./utils/firebase-config.js";
import { setupAuthState } from "./auth/user-auth.js";
import { getUserRole } from "./auth/user-roles.js";
import { showAuthModal } from "./auth/auth-modal.js";
import { showCompletePasswordResetForm, showResetPasswordForm } from "./auth/reset-password.js";

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
// Preload homepage enhancements
import("./content/homepage.js");

let userRole = null;

export function setupRouterLinks() {
  document.body.addEventListener("click", async (e) => {
    const link = e.target.closest("a.router-link");
    if (link) {
      const href = link.getAttribute("href");
      if (href && href.startsWith("/")) {
        e.preventDefault();

        // Handle /signup and /reset with modal, not path loading
        if (href === "/signup") return showAuthModal("signup");
        if (href === "/login") return showAuthModal("login");
        if (href === "/reset") return showResetPasswordForm();

        console.log("Clicked router link:", href);
        history.pushState({}, "", href);
        userRole = await getUserRole();
        console.log("Router role before loading:", userRole);
        await loadModuleByPath(href, userRole);
        window.dispatchEvent(new PopStateEvent("popstate"));

        // Close mobile menu after click
        const mobileNav = document.getElementById("mobileNav");
        if (mobileNav && mobileNav.classList.contains("mobile-nav-open")) {
          mobileNav.classList.remove("mobile-nav-open");
        }
      }
    }
  });
}

export function setupStickyNavbarScrollHandler() {
  const header = document.querySelector("header");
  if (!header) return;

  window.addEventListener("scroll", () => {
    if (window.scrollY > 10) {
      header.classList.add("scrolled");
    } else {
      header.classList.remove("scrolled");
    }
  });
}

export function setupMobileMenuToggle() {
  const toggleBtn = document.getElementById("mobileMenuToggle");
  const mobileNav = document.getElementById("mobileNav");

  if (toggleBtn && mobileNav) {
    toggleBtn.addEventListener("click", () => {
      mobileNav.classList.toggle("mobile-nav-open");
    });
  }
}

export async function initAppEntry() {
  await initFirebase();
  await auth?.authStateReady?.();
  await setupAuthState();
  userRole = await getUserRole();

  import("./shop/shop-cart.js").then((m) => m.initCartUI?.());

  setupRouterLinks();
  setupStickyNavbarScrollHandler();
  setupMobileMenuToggle();

  const cleanPath = window.location.pathname.split("?", 1)[0].split("#", 1)[0] || "/";

  // Handle direct links to auth modal paths
  if (cleanPath === "/signup") return showAuthModal("signup");
  if (cleanPath === "/login") return showAuthModal("login");
  if (cleanPath === "/reset") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "resetPassword") {
      return showCompletePasswordResetForm(params.get("oobCode"));
    }
    return showResetPasswordForm();
  }

  await loadModuleByPath(cleanPath, userRole);
}

export async function loadModuleByPath(path, role) {
  const safeImport = async (importFn, label) => {
    try {
      const mod = await importFn();
      await mod?.default?.();
    } catch (err) {
      console.error(`❌ Failed to load [${label}]`, err);
    }
  };

  switch (true) {
  case path === "/cart":
    await safeImport(
      () => import("./shop/shop-cart.js"),
      "Cart",
    );
    break;
  case path === "/checkout":
    await safeImport(
      () => import("./shop/shop-checkout.js"),
      "Checkout",
    );
    break;
  case path === "/checkout-success":
    await safeImport(
      () => import("./shop/shop-orders.js"),
      "Checkout Success",
    );
    break;
  case path.startsWith("/order-issue"):
    await safeImport(
      () => import("./orders/order-issue.js"),
      "Order Issue",
    );
    break;
  case path.startsWith("/shop"):
    await safeImport(
      () => import("./shop/shop-page.js"),
      "Shop Page",
    );
    break;
  case path.startsWith("/profile"):
    await safeImport(
      async () => {
        const mod = await import("./profile/profile-init.js");
        await mod.setupProfilePage();
      },
      "Profile",
    );
    break;
  case path.startsWith("/admin"):
    if (hasRole(role, "admin")) {
      await safeImport(
        () => import("./admin/admin-dashboard.js"),
        "Admin Dashboard",
      );
    } else if (!auth?.currentUser) {
      showAuthModal("login");
    } else {
      console.warn("Admin route blocked. Current role:", role);
    }
    break;
  case path.startsWith("/affiliate"):
    if (hasRole(role, "affiliate")) {
      await safeImport(
        () => import("./affiliate/affiliate-dashboard.js"),
        "Affiliate Dashboard",
      );
    } else if (!auth?.currentUser) {
      showAuthModal("login");
    } else {
      console.warn("Affiliate route blocked. Current role:", role);
    }
    break;
  case path.startsWith("/therapist"):
    if (hasRole(role, "therapist")) {
      await safeImport(
        () => import("./therapist/therapist-dashboard.js"),
        "Therapist Dashboard",
      );
    } else if (!auth?.currentUser) {
      showAuthModal("login");
    } else {
      console.warn("Therapist route blocked. Current role:", role);
    }
    break;
  case path.startsWith("/courses"):
    await safeImport(
      () => import("./content/course.js"),
      "Courses Page",
    );
    break;
  case path.startsWith("/workshops"):
    await safeImport(
      () => import("./content/workshops.js"),
      "Workshops Page",
    );
    break;
  case path.startsWith("/programs"):
    await safeImport(
      () => import("./content/programs.js"),
      "Programs Page",
    );
    break;
  case path === "/" || path.startsWith("/home"):
    await safeImport(
      () => import("./content/homepage.js"),
      "Homepage",
    );
    break;
  case path.startsWith("/contact"):
    await safeImport(
      () => import("./content/contact.js"),
      "Contact Page",
    );
    break;
  case path.startsWith("/about"):
    await safeImport(
      () => import("./content/about.js"),
      "About Page",
    );
    break;
  case path.startsWith("/terms"):
    await safeImport(
      () => import("./content/terms.js"),
      "Terms Page",
    );
    break;
  case path.startsWith("/privacy"):
    await safeImport(
      () => import("./content/privacy.js"),
      "Privacy Page",
    );
    break;
  case path.startsWith("/commerce"):
    await safeImport(
      () => import("./content/commerce.js"),
      "Commerce Page",
    );
    break;
  case path.startsWith("/support"):
    await safeImport(
      () => import("./content/support.js"),
      "Support Page",
    );
    break;
  case path.startsWith("/affiliateSignup"):
    await safeImport(
      () => import("./affiliate/affiliate-signup.js"),
      "Affiliate Signup Page",
    );
    break;
  case path.startsWith("/anato-me"):
    await safeImport(
      () => import("./content/anato-me.js"),
      "Anato-Me Page",
    );
    break;
  default:
    console.warn(`⚠️ No module found for path: ${path}`);
  }
}
