import { onCall, HttpsError } from "firebase-functions/v2/https";
import fetch from "node-fetch";
import { defineSecret } from "firebase-functions/params";

const RECAPTCHA_SECRET_KEY = defineSecret("RECAPTCHA_SECRET_KEY");

export const verifyRecaptchaToken = onCall(
  {
    region: "australia-southeast1",
    secrets: [RECAPTCHA_SECRET_KEY],
  },
  async (data) => {
    const { token } = data;

    if (!token) {
      throw new HttpsError("invalid-argument", "reCAPTCHA token is required.");
    }

    const isEmulated = process.env.FUNCTIONS_EMULATOR === "true";
    const recaptchaSecret = isEmulated
      ? process.env.RECAPTCHA_SECRET_KEY
      : RECAPTCHA_SECRET_KEY.value(); // ✅ Correct way to access the secret

    if (!recaptchaSecret) {
      console.error("❌ reCAPTCHA secret not found.");
      throw new HttpsError("internal", "Server error. Missing reCAPTCHA secret.");
    }

    const url = `https://www.google.com/recaptcha/api/siteverify?secret=${recaptchaSecret}&response=${token}`;

    try {
      const response = await fetch(url, { method: "POST" });
      const result = await response.json();

      if (!result.success) {
        console.warn("🛑 reCAPTCHA verification failed:", result["error-codes"]);
        return { success: false, score: 0 };
      }

      if (result.score < 0.5) {
        console.warn("⚠ Low reCAPTCHA score:", result.score);
        return { success: false, score: result.score };
      }

      return { success: true, score: result.score };
    } catch (error) {
      console.error("❌ Error verifying reCAPTCHA:", error);
      throw new HttpsError("internal", "Failed to verify reCAPTCHA.");
    }
  },
);
