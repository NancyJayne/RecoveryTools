import { auth, storage, functions } from "../utils/firebase-config.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { showToast } from "../utils/utils.js";
import { detectUserTimezone, populateTimezoneDropdown } from "../utils/date-utils.js";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function field(id) {
  return document.getElementById(id);
}

function setApplicationState(status, notes = "") {
  const panel = field("affiliateApplicationStatus");
  const form = field("affiliateRegisterForm");
  const submit = field("affiliateApplicationSubmit");
  if (!panel || !form || !submit) return;

  const messages = {
    pending: {
      className: "border-purple-500 bg-purple-950/20 text-purple-100",
      message: "Application submitted and awaiting approval.",
    },
    active: {
      className: "border-green-600 bg-green-950/20 text-green-100",
      message: "Your affiliate application is approved. Open your Affiliate Dashboard.",
    },
    rejected: {
      className: "border-amber-600 bg-amber-950/20 text-amber-100",
      message: `Your application was not approved.${notes ? ` Reason: ${notes}` : ""} ` +
        "You may update it and submit again.",
    },
  };
  const state = messages[status];
  panel.className = state
    ? `mb-5 rounded border p-4 text-sm ${state.className}`
    : "hidden";
  panel.textContent = state?.message || "";

  const locked = ["pending", "active"].includes(status);
  [...form.elements].forEach((control) => {
    if (control !== submit) control.disabled = locked;
  });
  submit.disabled = locked;
  submit.classList.toggle("hidden", locked);
}

function validateLogo(file) {
  if (!file) return;
  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    throw new Error("Logo must be a JPG, PNG, or WebP image.");
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error("Logo must be 2 MB or smaller.");
  }
}

async function getApplicationStatus(register) {
  const result = await register({ action: "status" });
  return result.data || { status: "not_submitted" };
}

export async function initAffiliateRegisterForm() {
  const user = auth?.currentUser;
  if (!user) {
    showToast("Please log in before applying to become an affiliate.", "error");
    window.location.href = "/signup?next=/affiliateSignup?register=1";
    return;
  }

  const form = field("affiliateRegisterForm");
  if (!form || form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  field("affiliateName").value ||= user.displayName || "";
  field("affiliateEmail").value ||= user.email || "";

  const timezone = field("affiliateApplicationTimezone");
  populateTimezoneDropdown(timezone, detectUserTimezone());

  const register = httpsCallable(functions, "registerAffiliate");
  try {
    const current = await getApplicationStatus(register);
    setApplicationState(current.status, current.decisionNotes);
  } catch (error) {
    console.warn("Could not load affiliate application status:", error);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = field("affiliateApplicationSubmit");
    const logoFile = field("affiliateLogo")?.files[0];
    try {
      validateLogo(logoFile);
      submit.disabled = true;
      submit.textContent = "Submitting application...";

      let logoUrl = "";
      if (logoFile) {
        const extension = logoFile.type.split("/")[1].replace("jpeg", "jpg");
        const logoRef = storageRef(storage, `affiliate-applications/${user.uid}/logo.${extension}`);
        await uploadBytes(logoRef, logoFile, { contentType: logoFile.type });
        logoUrl = await getDownloadURL(logoRef);
      }

      const result = await register({
        name: field("affiliateName").value.trim(),
        businessName: field("affiliateBusinessName").value.trim(),
        abn: field("affiliateABN").value.trim(),
        phone: field("affiliatePhone").value.trim(),
        address: field("affiliateAddress").value.trim(),
        description: field("affiliateDescription").value.trim(),
        website: field("affiliateWebsite").value.trim(),
        timezone: timezone.value,
        logoUrl,
        acceptedTerms: field("affiliateAcceptTerms").checked,
        acceptedPrivacy: field("affiliateAcceptPrivacy").checked,
        acceptedAffiliateAgreement: field("affiliateAcceptAgreement").checked,
      });
      const status = result.data?.status || "pending";
      setApplicationState(status, result.data?.decisionNotes);
      showToast("Application submitted and awaiting approval.", "success");
    } catch (error) {
      console.error("Affiliate application error:", error);
      showToast(error.message || "Application could not be submitted.", "error");
      submit.disabled = false;
    } finally {
      submit.textContent = "Submit affiliate application";
    }
  });
}

export const setupAffiliateRegistrationForm = initAffiliateRegisterForm;
