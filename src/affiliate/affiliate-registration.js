// affiliate-registration.js
import { auth, storage, functions } from "../utils/firebase-config.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { showToast } from "../utils/utils.js";
import { detectUserTimezone, populateTimezoneDropdown } from "../utils/date-utils.js";
import { setupRoleUI } from "../auth/user-roles.js";

export async function initAffiliateRegisterForm() {
  const user = auth?.currentUser;
  if (!user) {
    showToast("Please log in before becoming an affiliate.", "error");
    window.location.href = "/signup?next=/affiliate/register";
    return;
  }

  document.getElementById("affiliateName").value = user.displayName || "";
  document.getElementById("affiliateEmail").value = user.email || "";

  // Populate timezone dropdown and default value
  const tzSelect = document.getElementById("affiliateTimezone");
  if (tzSelect) {
    populateTimezoneDropdown(tzSelect);
    tzSelect.value = detectUserTimezone();
  }

  document.getElementById("affiliateRegisterForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const abn = document.getElementById("affiliateABN").value.trim();
    const businessName = document.getElementById("affiliateBusinessName").value.trim();
    const phone = document.getElementById("affiliatePhone").value.trim();
    const address = document.getElementById("affiliateAddress").value.trim();
    const description = document.getElementById("affiliateDescription").value.trim();
    const timezone = document.getElementById("affiliateTimezone").value;
    const logoFile = document.getElementById("affiliateLogo")?.files[0];

    if (!abn || !businessName || !address) {
      showToast("Please fill out all required fields.", "error");
      return;
    }

    let logoUrl = null;
    if (logoFile) {
      try {
        const logoPath = `affiliates/${user.uid}/logo.jpg`;
        const logoStorageRef = storageRef(storage, logoPath);
        await uploadBytes(logoStorageRef, logoFile);
        logoUrl = await getDownloadURL(logoStorageRef);
      } catch (err) {
        console.error("Logo upload failed:", err);
        showToast("Logo upload failed.", "error");
      }
    }

    const data = {
      uid: user.uid,
      name: user.displayName || "",
      email: user.email,
      abn,
      businessName,
      phone,
      address,
      description,
      logoUrl,
      timezone,
      approved: true,
    };

    try {
      const register = httpsCallable(functions, "registerAffiliate");
      await register(data);
      await auth.currentUser.getIdToken(true);
      setupRoleUI(auth.currentUser);
      showToast("Affiliate registration successful!", "success");
      window.location.href = "/affiliate";
    } catch (err) {
      console.error("Affiliate registration error:", err);
      showToast("Something went wrong. Please try again.", "error");
    }
  });
}

/**
 * Setup the affiliate registration form
 */
export function setupAffiliateRegistrationForm() {
  const form = document.getElementById("affiliateRegistrationForm");
  const timezoneSelect = document.getElementById("affiliateTimezone");

  // Auto-detect and populate timezones
  if (timezoneSelect) {
    populateTimezoneDropdown(timezoneSelect);
    timezoneSelect.value = detectUserTimezone();
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    const user = auth?.currentUser;
    if (!user) {
      showToast("You must be logged in to register as an affiliate.", "error");
      return;
    }

    try {
      const register = httpsCallable(functions, "registerAffiliate");
      await register({
        ...data,
        timezone: data.timezone || detectUserTimezone(),
        status: "pending",
      });
      await auth.currentUser.getIdToken(true);
      setupRoleUI(auth.currentUser);
      showToast("Affiliate application submitted.", "success");
      window.location.href = "/affiliate";
    } catch (err) {
      console.error("Failed to save affiliate profile:", err);
      showToast("Something went wrong.", "error");
    }
  });
}
