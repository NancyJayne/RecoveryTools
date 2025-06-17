import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import fetch from "node-fetch";

if (!admin.apps.length) {
  admin.initializeApp();
}

// Define the secret properly
const RECAPTCHA_SECRET_KEY = defineSecret("RECAPTCHA_SECRET_KEY");

/**
 * ✅ Admin: Create a new user account manually
 */
export const adminCreateUser = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can create users.");
    }

    const { email, password, displayName, roles } = data;

    if (!email || !password) {
      throw new HttpsError("invalid-argument", "Email and password are required.");
    }

    try {
      const user = await admin.auth().createUser({ email, password, displayName });

      if (roles && typeof roles === "object") {
        await admin.auth().setCustomUserClaims(user.uid, roles);
      }

      return { success: true, uid: user.uid };
    } catch (err) {
      console.error("Admin create user error:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);

/**
 * ✅ Send password reset email with reCAPTCHA verification
 */
export const sendPasswordReset = onCall(
  {
    region: "australia-southeast1",
    secrets: [RECAPTCHA_SECRET_KEY],
  },
  async (data, context) => {
    const { email, token } = data;

    if (!email || !token) {
      throw new HttpsError("invalid-argument", "Email and reCAPTCHA token are required.");
    }

    try {
      const recaptchaSecret = process.env.FUNCTIONS_EMULATOR === "true"
        ? process.env.RECAPTCHA_SECRET_KEY
        : context.secrets.RECAPTCHA_SECRET_KEY;

      const verifyUrl = "https://www.google.com/recaptcha/api/siteverify";
      const params = new URLSearchParams();
      params.append("secret", recaptchaSecret);
      params.append("response", token);

      const res = await fetch(verifyUrl, { method: "POST", body: params });
      const result = await res.json();

      if (!result.success || result.score < 0.5) {
        console.warn("⚠️ reCAPTCHA failed during reset:", result);
        throw new HttpsError("permission-denied", "reCAPTCHA verification failed.");
      }

      const link = await admin.auth().generatePasswordResetLink(email);
      return { success: true, link };
    } catch (err) {
      console.error("❌ Password reset error:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
