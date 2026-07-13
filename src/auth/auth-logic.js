// auth-logic.js – Signup & login with reCAPTCHA, App Check, and Firestore profile creation

import { auth, db, functions } from "../utils/firebase-config.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";

import {
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import { httpsCallable } from "firebase/functions";
import { showToast } from "../utils/utils.js";
import { executeRecaptcha } from "../utils/verifyRecaptchaToken.js";

const AUTH_RETURN_TO_KEY = "recovery_auth_return_to";

function safeAuthRedirectPath() {
  const fallback = "/profile";
  const storedPath = sessionStorage.getItem(AUTH_RETURN_TO_KEY);
  sessionStorage.removeItem(AUTH_RETURN_TO_KEY);

  if (!storedPath) return fallback;

  try {
    const url = new URL(storedPath, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export async function handleSignup(email, password, name) {
  try {
    if (!email || !password || !name) {
      throw new Error("Missing name, email or password.");
    }

    await executeRecaptcha("signup");

    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCred.user;

    await updateProfile(user, {
      displayName: name,
    });

    await setDoc(
      doc(db, "users", user.uid),
      {
        uid: user.uid,
        name,
        email: user.email || email,

        roles: {
          admin: false,
          affiliate: false,
          therapist: false,
        },

        role: "user",

        photoURL: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    try {
      const welcomeEmail = httpsCallable(functions, "sendWelcomeEmail");
      await welcomeEmail({
        to: email,
        firstName: name.split(" ")[0] || "there",
      });
    } catch (emailErr) {
      console.warn("Welcome email failed, but signup completed:", emailErr);
    }

    showToast("Signup successful!", "success");
    window.location.href = safeAuthRedirectPath();
    return user;
  } catch (err) {
    console.error("Signup error:", err);
    showToast(err.message || "Signup failed", "error");
    throw err;
  }
}

export async function handleLogin(email, password) {
  try {
    await executeRecaptcha("login");
    const userCred = await signInWithEmailAndPassword(auth, email, password);

    showToast("Login successful!", "success");
    window.location.href = safeAuthRedirectPath();
    return userCred.user;
  } catch (err) {
    console.error("Login error:", err);
    showToast(err.message || "Login failed", "error");
    throw err;
  }
}

// Direct wrappers for auth-modal use
export async function signupWithEmail(name, email, password) {
  return handleSignup(email, password, name);
}

export async function loginWithEmail(email, password) {
  return handleLogin(email, password);
}
