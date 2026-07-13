import { auth, functions } from "../utils/firebase-config.js";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { showToast } from "../utils/utils.js";
import { showAuthModal } from "./auth-modal.js";
import { executeRecaptcha } from "../utils/verifyRecaptchaToken.js";

function showResetModalShell(titleText) {
  const authModal = document.getElementById("authModal");
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const resetForm = document.getElementById("resetForm");
  const title = document.getElementById("authModalTitle");

  if (!authModal || !loginForm || !signupForm || !resetForm || !title) return null;

  authModal.classList.remove("hidden");
  loginForm.classList.add("hidden");
  signupForm.classList.add("hidden");
  resetForm.classList.remove("hidden");
  title.textContent = titleText;
  resetForm.innerHTML = "";

  return resetForm;
}

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
    const sendReset = httpsCallable(functions, "sendPasswordReset");
    const result = await sendReset({ email, token });

    if (result?.data?.success) {
      showToast("Reset link sent to your email.", "success");
    } else {
      showToast("Failed to send reset email.", "error");
    }
  } catch (err) {
    console.error("Password reset error:", err);
    showToast("Something went wrong. Please try again.", "error");
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = "Send Reset Link";
    }
  }
}

export function showResetPasswordForm() {
  const resetForm = showResetModalShell("Reset Password");
  if (!resetForm) return;

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

  paragraph.appendChild(backLink);
  form.append(label, input, button, paragraph);
  resetForm.appendChild(form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cleanEmail = input.value.trim().toLowerCase();

    if (!cleanEmail) {
      showToast("Please enter your email", "error");
      input.focus();
      return;
    }

    await requestPasswordReset(cleanEmail, e.submitter);
  });

  backLink.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showAuthModal("login");
  });
}

export async function showCompletePasswordResetForm(oobCode) {
  const resetForm = showResetModalShell("Choose New Password");
  if (!resetForm) return;

  if (!oobCode) {
    resetForm.textContent = "This reset link is missing a reset code.";
    return;
  }

  const form = document.createElement("form");
  form.id = "passwordResetCompleteForm";
  form.className = "space-y-4";

  const emailText = document.createElement("p");
  emailText.className = "text-sm text-gray-300";
  emailText.textContent = "Checking reset link...";

  const passwordLabel = document.createElement("label");
  passwordLabel.htmlFor = "newResetPassword";
  passwordLabel.className = "block text-sm font-medium text-white";
  passwordLabel.textContent = "New password";

  const passwordInput = document.createElement("input");
  passwordInput.id = "newResetPassword";
  passwordInput.type = "password";
  passwordInput.minLength = 8;
  passwordInput.autocomplete = "new-password";
  passwordInput.className = "w-full px-3 py-2 rounded bg-gray-800 text-white";
  passwordInput.required = true;

  const confirmLabel = document.createElement("label");
  confirmLabel.htmlFor = "confirmResetPassword";
  confirmLabel.className = "block text-sm font-medium text-white";
  confirmLabel.textContent = "Confirm password";

  const confirmInput = document.createElement("input");
  confirmInput.id = "confirmResetPassword";
  confirmInput.type = "password";
  confirmInput.minLength = 8;
  confirmInput.autocomplete = "new-password";
  confirmInput.className = "w-full px-3 py-2 rounded bg-gray-800 text-white";
  confirmInput.required = true;

  const button = document.createElement("button");
  button.type = "submit";
  button.className = "w-full bg-[#407471] py-2 rounded text-white font-semibold";
  button.textContent = "Update Password";

  form.append(emailText, passwordLabel, passwordInput, confirmLabel, confirmInput, button);
  resetForm.appendChild(form);

  try {
    const email = await verifyPasswordResetCode(auth, oobCode);
    emailText.textContent = `Resetting password for ${email}`;
  } catch (err) {
    console.error("Invalid password reset code:", err);
    emailText.textContent = "This reset link is invalid or has expired.";
    passwordInput.disabled = true;
    confirmInput.disabled = true;
    button.disabled = true;
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (passwordInput.value !== confirmInput.value) {
      showToast("Passwords do not match.", "error");
      return;
    }

    try {
      button.disabled = true;
      button.textContent = "Updating...";
      await confirmPasswordReset(auth, oobCode, passwordInput.value);
      showToast("Password updated. You can now log in.", "success");
      showAuthModal("login");
      window.history.replaceState({}, document.title, "/login");
    } catch (err) {
      console.error("Password reset completion failed:", err);
      showToast("Could not update password. The link may have expired.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Update Password";
    }
  });
}
