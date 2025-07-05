// ✅ app-entry.js – Updated to handle /signup and /reset as modal flows with safeImport logic

// Exported helpers for main initialization
import { initFirebase } from "./utils/firebase-config.js";
import { setupAuthState } from "./auth/user-auth.js";
import { getUserRole } from "./auth/user-roles.js";
import { showAuthModal } from "./auth/auth-modal.js";
import { showResetPasswordForm } from "./auth/reset-password.js";

// Preload homepage enhancements
import(new URL("./content/homepage.js", import.meta.url));

let userRole = null;

export function setupRouterLinks() {
  document.body.addEventListener("click", (e) => {
    const link = e.target.closest("a.router-link");
    if (link) {
      const href = link.getAttribute("href");
      if (href && href.startsWith("/")) {
        e.preventDefault();

        // Handle /signup and /reset with modal, not path loading
        if (href === "/signup") return showAuthModal("signup");
        if (href === "/login") return showAuthModal("login");
        if (href === "/reset") return showResetPasswordForm();

        history.pushState({}, "", href);
        loadModuleByPath(href, userRole);

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
  await setupAuthState();
  userRole = await getUserRole();

  if (document.querySelector(".open-cart-btn")) {
    import(new URL("./shop/shop-cart.js", import.meta.url)).then((m) => m.initCartUI?.());
  }

  setupRouterLinks();
  setupStickyNavbarScrollHandler();
  setupMobileMenuToggle();

  const cleanPath = window.location.pathname.split("?", 1)[0].split("#", 1)[0] || "/";

  // Handle direct links to auth modal paths
  if (cleanPath === "/signup") return showAuthModal("signup");
  if (cleanPath === "/login") return showAuthModal("login");
  if (cleanPath === "/reset") return showResetPasswordForm();

  loadModuleByPath(cleanPath, userRole);
}

export async function loadModuleByPath(path, role) {
  const safeImport = async (importFn, label) => {
    try {
      const mod = await importFn();
      mod?.default?.();
    } catch (err) {
      console.error(`❌ Failed to load [${label}]`, err);
    }
  };

  switch (true) {
  case path === "/cart":
    await safeImport(
      () => import(new URL("./shop/shop-cart.js", import.meta.url)),
      "Cart",
    );
    break;
  case path === "/checkout":
    await safeImport(
      () => import(new URL("./shop/shop-checkout.js", import.meta.url)),
      "Checkout",
    );
    break;
  case path === "/checkout-success":
    await safeImport(
      () => import(new URL("./shop/shop-orders.js", import.meta.url)),
      "Checkout Success",
    );
    break;
  case path.startsWith("/shop"):
    await safeImport(
      () => import(new URL("./shop/shop-page.js", import.meta.url)),
      "Shop Page",
    );
    break;
  case path.startsWith("/profile"):
    await safeImport(
      () => import(new URL("./profile/profile-init.js", import.meta.url)),
      "Profile",
    );
    break;
  case path.startsWith("/admin") && role === "admin":
    await safeImport(
      () => import(new URL("./admin/admin-dashboard.js", import.meta.url)),
      "Admin Dashboard",
    );
    break;
  case path.startsWith("/affiliate") && role === "affiliate":
    await safeImport(
      () => import(new URL("./affiliate/affiliate-dashboard.js", import.meta.url)),
      "Affiliate Dashboard",
    );
    break;
  case path.startsWith("/therapist") && role === "therapist":
    await safeImport(
      () => import(new URL("./therapist/therapist-dashboard.js", import.meta.url)),
      "Therapist Dashboard",
    );
    break;
  case path.startsWith("/courses"):
    await safeImport(
      () => import(new URL("./content/course.js", import.meta.url)),
      "Courses Page",
    );
    break;
  case path.startsWith("/workshops"):
    await safeImport(
      () => import(new URL("./content/workshops.js", import.meta.url)),
      "Workshops Page",
    );
    break;
  case path.startsWith("/programs"):
    await safeImport(
      () => import(new URL("./content/programs.js", import.meta.url)),
      "Programs Page",
    );
    break;
  case path === "/" || path.startsWith("/home"):
    await safeImport(
      () => import(new URL("./content/homepage.js", import.meta.url)),
      "Homepage",
    );
    break;
  case path.startsWith("/contact"):
    await safeImport(
      () => import(new URL("./content/contact.js", import.meta.url)),
      "Contact Page",
    );
    break;
  case path.startsWith("/about"):
    await safeImport(
      () => import(new URL("./content/about.js", import.meta.url)),
      "About Page",
    );
    break;
  case path.startsWith("/terms"):
    await safeImport(
      () => import(new URL("./content/terms.js", import.meta.url)),
      "Terms Page",
    );
    break;
  case path.startsWith("/privacy"):
    await safeImport(
      () => import(new URL("./content/privacy.js", import.meta.url)),
      "Privacy Page",
    );
    break;
  case path.startsWith("/commerce"):
    await safeImport(
      () => import(new URL("./content/commerce.js", import.meta.url)),
      "Commerce Page",
    );
    break;
  case path.startsWith("/support"):
    await safeImport(
      () => import(new URL("./content/support.js", import.meta.url)),
      "Support Page",
    );
    break;
  case path.startsWith("/affiliateSignup"):
    await safeImport(
      () => import(new URL("./affiliate/affiliate-signup.js", import.meta.url)),
      "Affiliate Signup Page",
    );
    break;
  case path.startsWith("/anato-me"):
    await safeImport(
      () => import(new URL("./content/anato-me.js", import.meta.url)),
      "Anato-Me Page",
    );
    break;
  default:
    console.warn(`⚠️ No module found for path: ${path}`);
  }
}
