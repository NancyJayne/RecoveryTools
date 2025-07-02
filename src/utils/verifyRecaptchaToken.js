import { functions, getRecaptchaSiteKey } from "./firebase-config.js";
import { httpsCallable } from "firebase/functions";
import { loadRecaptchaScript } from "./loadRecaptcha.js";
import { showToast } from "./utils.js";

const RECAPTCHA_ERROR_MSG = "reCAPTCHA verification failed or site key is missing.";

/**
 * Runs reCAPTCHA v3, verifies token with Cloud Function, and returns the token if valid.
 */
export async function executeRecaptcha(action = "submit_review") {
  try {
    const siteKey = getRecaptchaSiteKey();
    if (!siteKey) throw new Error(RECAPTCHA_ERROR_MSG);

    // Dynamically load the reCAPTCHA script if not already loaded
    if (!window.grecaptcha) {
      await loadRecaptchaScript(siteKey);
    }

    await new Promise((resolve) => window.grecaptcha.ready(resolve));

    const token = await window.grecaptcha.execute(siteKey, { action });
    // Use console.log so the token is visible even when dev tools filters
    console.log("✅ reCAPTCHA token received:", token);

    // Guard against undefined or empty token
    if (!token) {
      console.error("❌ reCAPTCHA token missing.");
      showToast("Something went wrong with reCAPTCHA.", "error");
      throw new Error(RECAPTCHA_ERROR_MSG);
    }

    // Call Firebase Cloud Function to verify via standard v3
    const verifyRecaptchaToken = httpsCallable(functions, "verifyRecaptchaToken");
    const result = await verifyRecaptchaToken({ token });

    if (result?.data?.success && result.data.score >= 0.5) {
      return token;
    } else {
      console.warn("⚠️ reCAPTCHA score too low or verification failed:", result?.data);
      showToast("reCAPTCHA verification failed. Try again.", "error");
      throw new Error(RECAPTCHA_ERROR_MSG);
    }
  } catch (err) {
    console.error("❌ reCAPTCHA error:", err);
    showToast("Something went wrong with reCAPTCHA.", "error");
    throw new Error(RECAPTCHA_ERROR_MSG);
  }
}
