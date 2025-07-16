// auth-modal.js – Updated to support Login, Signup, and Reset Password
import { signupWithEmail, loginWithEmail } from "./auth-logic.js";
import { requestPasswordReset } from "./reset-password.js";

export function setupAuthModal() {
  const modal = document.getElementById("authModal");
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const resetForm = document.getElementById("resetForm");
  const loginError = document.getElementById("loginErrorMsg");
  const signupError = document.getElementById("signupErrorMsg");
  const resetError = document.getElementById("resetErrorMsg");
  const modalTitle = document.getElementById("authModalTitle");

  const showAuthModal = (mode = "login") => {
    modal.classList.remove("hidden");
    loginForm.classList.add("hidden");
    signupForm.classList.add("hidden");
    resetForm.classList.add("hidden");
    loginError?.classList.add("hidden");
    signupError?.classList.add("hidden");
    resetError?.classList.add("hidden");

    switch (mode) {
    case "signup":
      signupForm.classList.remove("hidden");
      modalTitle.textContent = "Sign Up";
      break;
    case "reset":
      resetForm.classList.remove("hidden");
      modalTitle.textContent = "Reset Password";
      break;
    default:
      loginForm.classList.remove("hidden");
      modalTitle.textContent = "Login";
    }
  };

  const hideAuthModal = () => modal.classList.add("hidden");

  document.querySelectorAll("[data-auth]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-auth");
      showAuthModal(mode);
    });
  });

  document.getElementById("closeAuthModal")?.addEventListener("click", (e) => {
    e.preventDefault();
    hideAuthModal();
  });

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail")?.value;
    const password = document.getElementById("loginPassword")?.value;
    
    const btn = e.submitter || loginForm.querySelector("button[type='submit']");
    const spinner = document.createElement("span");
    spinner.className =
      "ml-2 inline-block w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin";

    if (btn) {
      btn.disabled = true;
      btn.appendChild(spinner);
    }

    try {
      await loginWithEmail(email, password);
      hideAuthModal();
    } catch (err) {
      loginError.textContent = err.message || "Login failed";
      loginError.classList.remove("hidden");
    } finally {
      if (btn) {
        btn.disabled = false;
        spinner.remove();
      }
    }
  });

  signupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("signupName")?.value;
    const email = document.getElementById("signupEmail")?.value;
    const password = document.getElementById("signupPassword")?.value;
    const confirm = document.getElementById("signupConfirmPassword")?.value;
    const agree = document.getElementById("agreeTerms")?.checked;

    const btn = e.submitter || signupForm.querySelector("button[type='submit']");
    const spinner = document.createElement("span");
    spinner.className =
      "ml-2 inline-block w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin";

    if (password !== confirm) {
      signupError.textContent = "Passwords do not match.";
      signupError.classList.remove("hidden");
      return;
    }
    if (!agree) {
      signupError.textContent = "You must agree to the terms.";
      signupError.classList.remove("hidden");
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.appendChild(spinner);
    }

    try {
      await signupWithEmail(name, email, password);
      hideAuthModal();
    } catch (err) {
      signupError.textContent = err.message || "Signup failed";
      signupError.classList.remove("hidden");
    } finally {
      if (btn) {
        btn.disabled = false;
        spinner.remove();
      }
    }
  });

  resetForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("resetEmail")?.value;
    if (!email) {
      resetError.textContent = "Please enter your email.";
      resetError.classList.remove("hidden");
      return;
    }
    try {
      await requestPasswordReset(email);
      showAuthModal("login");
    } catch (err) {
      resetError.textContent = err.message || "Reset failed.";
      resetError.classList.remove("hidden");
    }
  });

  document.getElementById("backToLogin")?.addEventListener("click", (e) => {
    e.preventDefault();
    showAuthModal("login");
  });
}

// Optional global export for inline usage
window.showAuthModal = (mode = "login") => {
  document.querySelector(`[data-auth='${mode}']`)?.click();
};

export function showAuthModal(type = "login") {
  const authModal = document.getElementById("authModal");
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const resetForm = document.getElementById("resetForm");
  const title = document.getElementById("authModalTitle");

  authModal.classList.remove("hidden");

  loginForm.classList.add("hidden");
  signupForm.classList.add("hidden");
  resetForm.classList.add("hidden");

  if (type === "signup") {
    signupForm.classList.remove("hidden");
    title.textContent = "Sign Up";
  } else if (type === "reset") {
    resetForm.classList.remove("hidden");
    title.textContent = "Reset Password";
  } else {
    loginForm.classList.remove("hidden");
    title.textContent = "Login";
  }
}
