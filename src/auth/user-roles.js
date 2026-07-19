import { auth } from "../utils/firebase-config.js";
import {
  clearAdminOrderAlertBadge,
  startAdminAlertPolling,
  stopAdminAlertPolling,
} from "../admin/admin-order-alerts.js";

/**
 * Get the current user's roles from custom claims.
 */
export async function getUserRole() {
  await auth?.authStateReady?.();
  const user = auth?.currentUser;
  if (!user) return {};

  try {
    const token = await user.getIdTokenResult();

    const roles = {
      admin: token.claims?.admin === true,
      therapist: token.claims?.therapist === true,
      affiliate: token.claims?.affiliate === true,
    };

    console.log("User roles:", roles);

    return roles;
  } catch (err) {
    console.error("Failed to get user roles:", err);
    return {};
  }
}

/**
 * Toggle UI elements based on roles.
 */
export function applyRoleUI(roles = {}) {
  document
    .getElementById("adminAccessLink")
    ?.classList.toggle("hidden", !roles.admin);

  document
    .getElementById("adminAccessBtn")
    ?.classList.toggle("hidden", !roles.admin);

  if (roles.admin) {
    startAdminAlertPolling();
  } else {
    stopAdminAlertPolling();
    clearAdminOrderAlertBadge();
  }

  document
    .getElementById("therapistAccessLink")
    ?.classList.toggle("hidden", !roles.therapist);

  document
    .getElementById("therapistAccessBtn")
    ?.classList.toggle("hidden", !roles.therapist);

  document
    .getElementById("affiliateBadge")
    ?.classList.toggle("hidden", !roles.affiliate);

  document
    .getElementById("affiliateAccessLink")
    ?.classList.toggle("hidden", !roles.affiliate);

  document
    .getElementById("affiliateAccessBtn")
    ?.classList.toggle("hidden", !roles.affiliate);

  document
    .getElementById("affiliateSignup")
    ?.classList.toggle("hidden", roles.affiliate);
}

export async function setupRoleUI(user) {
  if (!user) {
    applyRoleUI();
    return {};
  }

  try {
    const { claims } = await user.getIdTokenResult();
    const roles = {
      admin: claims?.admin === true,
      therapist: claims?.therapist === true,
      affiliate: claims?.affiliate === true,
    };

    console.log("User roles:", roles);
    applyRoleUI(roles);
    return roles;
  } catch (err) {
    console.error("Error reading role claims:", err);
    clearAdminOrderAlertBadge();
    return {};
  }
}
