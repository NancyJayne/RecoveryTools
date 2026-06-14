import { auth } from "../utils/firebase-config.js";

/**
 * Get the current user's roles from custom claims.
 */
export async function getUserRole() {
  const user = auth?.currentUser;
  if (!user) return {};

  try {
    const token = await user.getIdTokenResult(true);

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
export function setupRoleUI(user) {
  if (!user) return;

  user.getIdTokenResult(true)
    .then(({ claims }) => {
      const roles = {
        admin: claims?.admin === true,
        therapist: claims?.therapist === true,
        affiliate: claims?.affiliate === true,
      };

      console.log("User roles:", roles);

      document
        .getElementById("adminAccessLink")
        ?.classList.toggle("hidden", !roles.admin);

      document
        .getElementById("therapistAccessLink")
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
    })
    .catch((err) => {
      console.error("Error reading role claims:", err);
    });
}
