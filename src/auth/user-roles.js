import { auth } from "../utils/firebase-config.js";

/**
 * Get the current user's role from custom claims
 */
export async function getUserRole() {
  const user = auth?.currentUser;
  if (!user) return null;

  try {
    const token = await user.getIdTokenResult(); // optionally force refresh: getIdTokenResult(true)
    return token.claims?.role || "user";
  } catch (err) {
    console.error("Failed to get user role:", err);
    return "user";
  }
}

/**
 * Toggle UI elements based on role
 */
export function setupRoleUI(user) {
  if (!user) return;

  user.getIdTokenResult().then(({ claims }) => {
    const role = claims?.role || "user";
    console.log("User role:", role);

    document.getElementById("adminAccessLink")?.classList.toggle("hidden", role !== "admin");
    document.getElementById("therapistAccessLink")?.classList.toggle("hidden", role !== "therapist");
    document.getElementById("affiliateBadge")?.classList.toggle("hidden", role !== "affiliate");
    document.getElementById("affiliateAccessLink")?.classList.toggle("hidden", role !== "affiliate");
    document.getElementById("affiliateAccessBtn")?.classList.toggle("hidden", role !== "affiliate");
  }).catch((err) => {
    console.error("Error reading role claims:", err);
  });
}
