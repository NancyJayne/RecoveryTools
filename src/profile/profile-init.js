// profile-init.js – handles tab switching, role-based visibility, and profile form handlers

import { auth, functions } from "../utils/firebase-config.js";
import { httpsCallable } from "firebase/functions";
import { showToast } from "../utils/utils.js";

import {
  loadOrderReceipts,
  loadProfileCourses,
  loadProfileWorkshops,
  loadMyPrograms,
  updateUserProfile,
  changeUserPassword,
} from "../auth/user-profile.js";

import { showAuthModal } from "../auth/auth-modal.js";

export async function setupProfilePage() {
  const user = auth.currentUser;
  const profileSection = document.getElementById("profileSection");
  const fallbackURL = "https://firebasestorage.googleapis.com/v0/b/recovery-tools.firebasestorage.app/o/videos%2FImages%2FProfile.png?alt=media&token=261b1542-dc99-44ce-9089-6342e0ee6db9";

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
    }

    // Load profile photo
    let photoURL = fallbackURL;
    let hasCustomPhoto = false;

    try {
      const userData = await getUserProfile(user.uid);
      if (userData?.photoURL) {
        photoURL = userData.photoURL;
        hasCustomPhoto = true;
      }
    } catch (e) {
      console.warn("Could not load profile photo, using fallback.");
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
            const userRef = doc((await import("../utils/firebase-config.js")).db, "users", user.uid);
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

  const affiliateSignupBtn = document.getElementById("affiliateSignup");
  if (affiliateSignupBtn) {
    affiliateSignupBtn.addEventListener("click", async () => {
      history.pushState({}, "", "/affiliateSignup");
      const { initAffiliateSignup } = await import("../affiliate/affiliate-signup.js");
      initAffiliateSignup?.();
    });
  }

  // Auto-open if linked via hash
  if (window.location.hash === "#profileSection") {
    profileSection?.classList.remove("hidden");
    document.querySelector("[data-profile-tab=\"myProfile\"]")?.click();
  }
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

  if (auth.currentUser?.uid && nameInput && phoneInput && addressInput) {
    const uid = auth.currentUser.uid;
    import("../auth/user-profile.js").then(async (mod) => {
      const profile = await mod.getUserProfile(uid);
      if (profile) {
        nameInput.value = profile.name || "";
        phoneInput.value = profile.phone || "";
        addressInput.value = profile.address || "";
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

      try {
        await updateUserProfile({ name, phone, address });
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
      if (!file || !auth.currentUser) return;

      const storageRef = (await import("firebase/storage")).ref;
      const uploadBytes = (await import("firebase/storage")).uploadBytes;
      const getDownloadURL = (await import("firebase/storage")).getDownloadURL;
      const { getStorage } = await import("firebase/storage");

      const storage = getStorage();
      const avatarRef = storageRef(storage, `avatars/${auth.currentUser.uid}.jpg`);

      try {
        await uploadBytes(avatarRef, file);
        const url = await getDownloadURL(avatarRef);

        const { doc, updateDoc } = await import("firebase/firestore");
        const userRef = doc((await import("../utils/firebase-config.js")).db, "users", auth.currentUser.uid);
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
        if (!auth.currentUser) return;

        const confirmRemove = confirm("Are you sure you want to remove your profile photo?");
        if (!confirmRemove) return;

        removeBtn.disabled = true;
        removeBtn.textContent = "Removing...";

        const fallbackURL = "https://firebasestorage.googleapis.com/v0/b/recovery-tools.firebasestorage.app/o/videos%2FImages%2FProfile.png?alt=media&token=261b1542-dc99-44ce-9089-6342e0ee6db9";

        try {
          const { getStorage, ref, deleteObject } = await import("firebase/storage");
          const storage = getStorage();
          const avatarRef = ref(storage, `avatars/${auth.currentUser.uid}.jpg`);

          // Attempt to delete from storage
          await deleteObject(avatarRef).catch((err) => {
            // Ignore if file doesn't exist
            if (err.code !== "storage/object-not-found") throw err;
          });

          // Clear photoURL in Firestore
          const { doc, updateDoc } = await import("firebase/firestore");
          const userRef = doc((await import("../utils/firebase-config.js")).db, "users", auth.currentUser.uid);
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
