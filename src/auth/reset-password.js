// reset-password.js – Secure password reset with verified reCAPTCHA
import { functions } from "../utils/firebase-config.js";
import { httpsCallable } from "firebase/functions";
import { showToast } from "../utils/utils.js";
import { showAuthModal } from "./auth-modal.js";
import { executeRecaptcha } from "../utils/verifyRecaptchaToken.js"; // ✅ Use central logic

// ✉️ Send password reset request
export async function requestPasswordReset(email, buttonEl) {
  if (!email) {
    showToast("Please enter your email address.", "error");
    document.getElementById("resetEmail")?.focus();
    return;
  }

  try {
    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.textContent = "Sending...";
    }

    const token = await executeRecaptcha("reset_password");

    const sendReset = httpsCallable(functions, "PasswordReset");
    const result = await sendReset({ email, token });

    if (result?.data?.success) {
      showToast("✅ Reset link sent to your email.", "success");
    } else {
      showToast("Failed to send reset email.", "error");
    }
  } catch (err) {
    console.error("❌ Password reset error:", err);
    showToast("Something went wrong. Please try again.", "error");
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = "Send Reset Link";
    }
  }
}


// 🧾 Show password reset modal form
export function showResetPasswordForm() {
  const authModal = document.getElementById("authModal");
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const resetForm = document.getElementById("resetForm");
  const title = document.getElementById("authModalTitle");

  if (!authModal || !loginForm || !signupForm || !resetForm || !title) return;

  // Show modal and switch views
  authModal.classList.remove("hidden");
  loginForm.classList.add("hidden");
  signupForm.classList.add("hidden");
  resetForm.classList.remove("hidden");
  title.textContent = "Reset Password";

  // Clear existing content in resetForm
  resetForm.innerHTML = "";

  // Create form elements
  const form = document.createElement("form");
  form.id = "passwordResetForm";
  form.className = "space-y-4";

  const label = document.createElement("label");
  label.htmlFor = "resetEmail";
  label.className = "block text-sm font-medium text-white";
  label.textContent = "Email";

  const input = document.createElement("input");
  input.id = "resetEmail";
  input.type = "email";
  input.placeholder = "Email";
  input.className = "w-full px-3 py-2 rounded bg-gray-800 text-white";
  input.required = true;

  const button = document.createElement("button");
  button.type = "submit";
  button.className = "w-full bg-[#407471] py-2 rounded text-white font-semibold";
  button.textContent = "Send Reset Link";

  const paragraph = document.createElement("p");
  paragraph.className = "mt-3 text-sm text-center";

  const backLink = document.createElement("a");
  backLink.href = "#";
  backLink.id = "backToLogin";
  backLink.className = "text-[#407471] hover:underline";
  backLink.textContent = "Back to Login";

  // Assemble form
  paragraph.appendChild(backLink);
  form.append(label, input, button, paragraph);
  resetForm.appendChild(form);

  // Add event listeners
  setTimeout(() => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = input.value.trim().toLowerCase();
      const buttonEl = e.submitter;

      if (!email) {
        showToast("Please enter your email", "error");
        input.focus();
        return;
      }

      await requestPasswordReset(email, buttonEl);
    });

    backLink.addEventListener("click", (e) => {
      e.preventDefault();
      showAuthModal("login");
    });
  }, 50);
}
