import { auth } from "../utils/firebase-config.js";
import {
  clearAdminOrderAlertBadge,
  startAdminAlertPolling,
  stopAdminAlertPolling,
} from "../admin/admin-order-alerts.js";

let roleUIRequestId = 0;

function rolesFromClaims(claims = {}) {
  return {
    admin: claims.admin === true,
    therapist: claims.therapist === true,
    affiliate: claims.affiliate === true,
  };
}

/**
 * Get the current user's roles from custom claims.
 */
export async function getUserRole({ forceRefresh = false } = {}) {
  await auth?.authStateReady?.();
  const user = auth?.currentUser;
  if (!user) return {};

  try {
    const token = await user.getIdTokenResult(forceRefresh);
    const roles = rolesFromClaims(token.claims);

    if (auth?.currentUser?.uid !== user.uid) return {};

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
    ?.classList.add("hidden");
}

export async function setupRoleUI(user, { forceRefresh = false } = {}) {
  const requestId = ++roleUIRequestId;
  if (!user) {
    applyRoleUI();
    return {};
  }

  try {
    const { claims } = await user.getIdTokenResult(forceRefresh);
    const roles = rolesFromClaims(claims);

    if (requestId !== roleUIRequestId || auth?.currentUser?.uid !== user.uid) {
      return roles;
    }

    console.log("User roles:", roles);
    applyRoleUI(roles);
    return roles;
  } catch (err) {
    console.error("Error reading role claims:", err);
    if (requestId === roleUIRequestId && auth?.currentUser?.uid === user.uid) {
      applyRoleUI();
    }
    return {};
  }
}
