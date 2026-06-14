// profile-init.js – handles tab switching, role-based visibility, and profile form handlers

import { auth, functions } from "../utils/firebase-config.js";
import { httpsCallable } from "firebase/functions";
import { onAuthStateChanged } from "firebase/auth";
import { showToast } from "../utils/utils.js";
import { handleSignOut } from "../auth/user-auth.js";

import {
  loadOrderReceipts,
  loadProfileCourses,
  loadProfileWorkshops,
  loadMyPrograms,
  getUserProfile,
  updateUserProfile,
  changeUserPassword,
} from "../auth/user-profile.js";

import { showAuthModal } from "../auth/auth-modal.js";

async function waitForAuth() {
  if (auth?.currentUser) return auth.currentUser;
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      unsub();
      resolve(u);
    });
  });
}

function formatAddress(address) {
  if (!address) return "";

  if (typeof address === "string") return address;

  return [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postal_code,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");
}

export async function setupProfilePage() {
  const profileSection = document.getElementById("profileSection");
  profileSection?.classList.remove("hidden");
  const fallbackURL = "https://firebasestorage.googleapis.com/v0/b/recovery-tools.firebasestorage.app/o/videos%2FImages%2FProfile.png?alt=media&token=261b1542-dc99-44ce-9089-6342e0ee6db9";
  const user = await waitForAuth();

  if (!user) {
    profileSection?.classList.remove("hidden");
    profileSection.innerHTML = `
      <div class="max-w-2xl mx-auto text-center mt-12">
        <h2 class="text-xl font-semibold text-white mb-4">Please log in to view your profile.</h2>
        <button id="loginPromptBtn" class="bg-[#407471] text-white px-4 py-2 rounded">Login</button>
      </div>
    `;
    document.getElementById("loginPromptBtn")?.addEventListener("click", () => {
      showAuthModal("login");
    });
    return;
  }

  try {
    // Load user roles
    const getUserRoleWithPermissions = httpsCallable(functions, "getUserRoleWithPermissions");
    const result = await getUserRoleWithPermissions();
    const { roles = {} } = result.data || {};

    if (roles.admin) document.getElementById("adminAccessLink")?.classList.remove("hidden");
    if (roles.therapist) document.getElementById("therapistAccessLink")?.classList.remove("hidden");
    if (roles.affiliate) {
      document.getElementById("affiliateAccessLink")?.classList.remove("hidden");
      document.getElementById("affiliateAccessBtn")?.classList.remove("hidden");
      document.getElementById("affiliateBadge")?.classList.remove("hidden");
      document.getElementById("affiliateSignup")?.classList.add("hidden");
    }

    // Load profile photo
    let photoURL = fallbackURL;
    let hasCustomPhoto = false;

    try {
      const userData = await getUserProfile(user.uid);

      const profileNameEl = document.querySelector("[data-profile-name]");
      if (profileNameEl) {
        profileNameEl.textContent =
      userData?.name || user.displayName || user.email || "My Profile";
      }

      document.querySelectorAll("[data-profile-email]").forEach((el) => {
        el.textContent = user.email || "Not set";
      });

      const inlineNameEl = document.querySelector("[data-profile-name-inline]");
      if (inlineNameEl) {
        inlineNameEl.textContent =
      userData?.name || user.displayName || user.email || "Not set";
      }

      const profilePhoneEl = document.querySelector("[data-profile-phone]");
      if (profilePhoneEl) {
        profilePhoneEl.textContent = userData?.phone || "Not added yet";
      }

      const profileRoleEl = document.querySelector("[data-profile-role]");
      if (profileRoleEl) {
        const roleNames = Object.entries(roles || {})
          .filter(([, enabled]) => enabled)
          .map(([role]) => role);

        profileRoleEl.textContent = roleNames.length ? roleNames.join(", ") : "user";
      }

      const profileShippingEl = document.querySelector("[data-profile-shipping]");
      if (profileShippingEl) {
        profileShippingEl.textContent =
  formatAddress(userData?.defaultShippingAddress) ||
  formatAddress(userData?.shippingAddress) ||
  formatAddress(userData?.address) ||
  "Not added yet";
      }

      const profileBillingEl = document.querySelector("[data-profile-billing]");
      if (profileBillingEl) {
        profileBillingEl.textContent =
  formatAddress(userData?.defaultBillingAddress) ||
  formatAddress(userData?.billingAddress) ||
  "Same as shipping / not added yet";
      }

      const profileEmailPrefsEl = document.querySelector("[data-profile-email-preferences]");
      if (profileEmailPrefsEl) {
        profileEmailPrefsEl.textContent =
      userData?.emailPreferences || "Transactional emails only";
      }

      if (userData?.photoURL) {
        photoURL = userData.photoURL;
        hasCustomPhoto = true;
      }
    } catch (e) {
      console.warn("Could not load profile photo, using fallback.", e);
    }

    document.getElementById("profileAvatar").src = photoURL;
    document.getElementById("headerAvatar").src = photoURL;

    // Toggle and bind remove button
    const removeBtn = document.getElementById("removeAvatarBtn");
    if (removeBtn) {
      if (!hasCustomPhoto) {
        removeBtn.classList.add("hidden");
      } else {
        removeBtn.classList.remove("hidden");

        removeBtn.onclick = async () => {
          if (!confirm("Are you sure you want to remove your profile photo?")) return;

          removeBtn.disabled = true;
          removeBtn.textContent = "Removing...";

          try {
            const { deleteObject, ref, getStorage } = await import("firebase/storage");
            const storage = getStorage();
            const avatarRef = ref(storage, `avatars/${user.uid}.jpg`);
            await deleteObject(avatarRef).catch(() => {}); // ignore if doesn't exist

            const { doc, updateDoc } = await import("firebase/firestore");
            const userRef = doc(
              (
                await import(
                  new URL("../utils/firebase-config.js", import.meta.url)
                )
              ).db,
              "users",
              user.uid,
            );
            await updateDoc(userRef, { photoURL: "" });

            document.getElementById("profileAvatar").src = fallbackURL;
            document.getElementById("headerAvatar").src = fallbackURL;
            removeBtn.classList.add("hidden");

            showToast("✅ Profile photo removed.", "success");
          } catch (err) {
            console.error("Remove photo error:", err);
            showToast("Failed to remove photo.", "error");
          } finally {
            removeBtn.disabled = false;
            removeBtn.textContent = "Remove Photo";
          }
        };
      }
    }
  } catch (err) {
    console.error("Error fetching user roles or profile:", err);
    showToast("Could not load profile.", "error");
  }

  // Tab switching logic
  document.querySelectorAll(".profile-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.profileTab;
      document.querySelectorAll(".profile-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".profile-tab-content").forEach((tab) => tab.classList.add("hidden"));
      const target = document.getElementById(targetId);
      if (target) {
        target.classList.remove("hidden");
        loadTabContent(targetId);
      }
    });
  });

  setupProfileFormHandlers();

  const signOutBtn = document.getElementById("signOutBtn");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", handleSignOut);
  }

  const affiliateSignupBtn = document.getElementById("affiliateSignup");
  if (affiliateSignupBtn) {
    affiliateSignupBtn.addEventListener("click", async () => {
      history.pushState({}, "", "/affiliateSignup");
      const { initAffiliateSignup } = await import(
        new URL("../affiliate/affiliate-signup.js", import.meta.url)
      );
      initAffiliateSignup?.();
    });
  }

  // Auto-open if linked via hash
  if (window.location.hash === "#profileSection") {
    profileSection?.classList.remove("hidden");
  }
  // Ensure "My Profile" tab loads by default
  document.querySelector("[data-profile-tab=\"myProfile\"]")?.click();
}

function loadTabContent(tabId) {
  switch (tabId) {
  case "myCourses":
    loadProfileCourses();
    break;
  case "myWorkshops":
    loadProfileWorkshops();
    break;
  case "orderHistory":
    loadOrderReceipts();
    break;
  case "myPrograms":
    loadMyPrograms();
    break;
  }
}

function setupProfileFormHandlers() {
  const nameInput = document.getElementById("updateName");
  const phoneInput = document.getElementById("updatePhone");
  const addressInput = document.getElementById("updateAddress");
  const billingInput = document.getElementById("updateBillingAddress");
  const emailPrefsInput = document.getElementById("updateEmailPreferences");

  if (auth?.currentUser?.uid && nameInput && phoneInput && addressInput) {
    const uid = auth.currentUser.uid;

    import(new URL("../auth/user-profile.js", import.meta.url)).then(async (mod) => {
      const profile = await mod.getUserProfile(uid);

      if (profile) {
        nameInput.value = profile.name || "";
        phoneInput.value = profile.phone || "";
        addressInput.value =
  formatAddress(profile.defaultShippingAddress) ||
  formatAddress(profile.shippingAddress) ||
  formatAddress(profile.address) ||
  "";

        if (billingInput) {
          billingInput.value =
    formatAddress(profile.defaultBillingAddress) ||
    formatAddress(profile.billingAddress) ||
    "";
        }
        if (emailPrefsInput) {
          emailPrefsInput.value = profile.emailPreferences || "Transactional emails only";
        }
      }
    });
  }

  const updateForm = document.getElementById("updateProfileForm");
  if (updateForm) {
    updateForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const name = document.getElementById("updateName").value.trim();
      const phone = document.getElementById("updatePhone").value.trim();
      const address = document.getElementById("updateAddress").value.trim();
      const billingAddress =
        document.getElementById("updateBillingAddress")?.value.trim() || "";
      const emailPreferences =
        document.getElementById("updateEmailPreferences")?.value ||
        "Transactional emails only";

      try {
        await updateUserProfile({
          name,
          phone,
          address,
          billingAddress,
          emailPreferences,
        });

        const freshProfile = await getUserProfile(auth.currentUser.uid);

        document.querySelector("[data-profile-name]").textContent =
          freshProfile?.name || auth.currentUser.email || "My Profile";

        document.querySelector("[data-profile-name-inline]").textContent =
          freshProfile?.name || auth.currentUser.email || "Not set";

        document.querySelectorAll("[data-profile-email]").forEach((el) => {
          el.textContent = auth.currentUser?.email || "Not set";
        });

        document.querySelector("[data-profile-phone]").textContent =
          freshProfile?.phone || "Not added yet";

        document.querySelector("[data-profile-shipping]").textContent =
  formatAddress(freshProfile?.defaultShippingAddress) ||
  formatAddress(freshProfile?.shippingAddress) ||
  formatAddress(freshProfile?.address) ||
  "Not added yet";

        document.querySelector("[data-profile-billing]").textContent =
  formatAddress(freshProfile?.defaultBillingAddress) ||
  formatAddress(freshProfile?.billingAddress) ||
  "Same as shipping / not added yet";

        document.querySelector("[data-profile-email-preferences]").textContent =
          freshProfile?.emailPreferences || "Transactional emails only";

        showToast("✅ Profile updated.", "success");
      } catch (err) {
        console.error("Update profile error:", err);
        showToast("Failed to update profile.", "error");
      }
    });
  }

  const passwordForm = document.getElementById("changePasswordForm");
  if (passwordForm) {
    passwordForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const newPassword = document.getElementById("newPassword").value.trim();

      if (newPassword.length < 6) {
        showToast("Password must be at least 6 characters.", "error");
        return;
      }

      try {
        await changeUserPassword(newPassword);
        showToast("✅ Password updated.", "success");
        passwordForm.reset();
      } catch (err) {
        console.error("Password change error:", err);
        showToast("Failed to change password.", "error");
      }
    });
  }

  const avatarInput = document.getElementById("avatarUpload");
  if (avatarInput) {
    avatarInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file || !auth?.currentUser) return;

      const storageRef = (await import("firebase/storage")).ref;
      const uploadBytes = (await import("firebase/storage")).uploadBytes;
      const getDownloadURL = (await import("firebase/storage")).getDownloadURL;
      const { getStorage } = await import("firebase/storage");

      const storage = getStorage();
      const avatarRef = storageRef(storage, `avatars/${auth?.currentUser?.uid}.jpg`);

      try {
        await uploadBytes(avatarRef, file);
        const url = await getDownloadURL(avatarRef);

        const { doc, updateDoc } = await import("firebase/firestore");
        const userRef = doc(
          (
            await import(new URL("../utils/firebase-config.js", import.meta.url))
          ).db,
          "users",
          auth?.currentUser?.uid,
        );
        await updateDoc(userRef, { photoURL: url });

        document.getElementById("profileAvatar").src = url;
        document.getElementById("headerAvatar").src = url;

        showToast("✅ Profile photo updated.", "success");
      } catch (err) {
        console.error("Avatar upload error:", err);
        showToast("Failed to upload photo.", "error");
      }
    });
    const removeBtn = document.getElementById("removeAvatarBtn");
    if (removeBtn) {
      removeBtn.addEventListener("click", async () => {
        if (!auth?.currentUser) return;

        const confirmRemove = confirm("Are you sure you want to remove your profile photo?");
        if (!confirmRemove) return;

        removeBtn.disabled = true;
        removeBtn.textContent = "Removing...";

        const fallbackURL = "https://firebasestorage.googleapis.com/v0/b/recovery-tools.firebasestorage.app/o/videos%2FImages%2FProfile.png?alt=media&token=261b1542-dc99-44ce-9089-6342e0ee6db9";

        try {
          const { getStorage, ref, deleteObject } = await import("firebase/storage");
          const storage = getStorage();
          const avatarRef = ref(storage, `avatars/${auth?.currentUser?.uid}.jpg`);

          // Attempt to delete from storage
          await deleteObject(avatarRef).catch((err) => {
            // Ignore if file doesn't exist
            if (err.code !== "storage/object-not-found") throw err;
          });

          // Clear photoURL in Firestore
          const { doc, updateDoc } = await import("firebase/firestore");
          const userRef = doc(
            (
              await import(
                new URL("../utils/firebase-config.js", import.meta.url)
              )
            ).db,
            "users",
            auth?.currentUser?.uid,
          );
          await updateDoc(userRef, { photoURL: "" });

          // Update UI with fallback image
          document.getElementById("profileAvatar").src = fallbackURL;
          document.getElementById("headerAvatar").src = fallbackURL;

          showToast("🧼 Photo removed and reset to default.", "success");
        } catch (err) {
          console.error("Error removing photo:", err);
          showToast("Failed to remove photo.", "error");
        } finally {
          removeBtn.disabled = false;
          removeBtn.textContent = "Remove Photo";
        }
      });
    }
  }
}

export default setupProfilePage;
