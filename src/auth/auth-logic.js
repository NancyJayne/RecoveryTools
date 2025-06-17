// auth-logic.js – Signup & login with reCAPTCHA and App Check support 
import { auth, functions } from "../utils/firebase-config.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "firebase/auth";
import { showToast } from "../utils/utils.js";
import { httpsCallable } from "firebase/functions";
import { executeRecaptcha } from "../utils/verifyRecaptchaToken.js";

export async function handleSignup(email, password, name) {
  try {
    await executeRecaptcha("signup");
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(userCred.user, { displayName: name });

    const welcomeEmail = httpsCallable(functions, "sendWelcomeEmail");
    await welcomeEmail({ to: email, firstName: name.split(" ")[0] || "there" });

    showToast("Signup successful!", "success");
  } catch (err) {
    console.error("Signup error:", err);
    showToast(err.message || "Signup failed", "error");
  }
}

export async function handleLogin(email, password) {
  try {
    await executeRecaptcha("login");
    await signInWithEmailAndPassword(auth, email, password);
    showToast("Login successful!", "success");
  } catch (err) {
    console.error("Login error:", err);
    showToast(err.message || "Login failed", "error");
  }
}

// Direct wrappers for auth-modal use
export async function signupWithEmail(name, email, password) {
  return handleSignup(email, password, name);
}

export async function loginWithEmail(email, password) {
  return handleLogin(email, password);
}
