import { onCall, HttpsError } from "firebase-functions/v2/https";
import fetch from "node-fetch";
import { defineSecret } from "firebase-functions/params";

const RECAPTCHA_SECRET_KEY = defineSecret("RECAPTCHA_SECRET_KEY");

export const verifyRecaptchaToken = onCall(
  {
    region: "australia-southeast1",
    secrets: [RECAPTCHA_SECRET_KEY],
  },
  async (request) => {
    const { token, action } = request.data || {};

    const isEmulated = process.env.FUNCTIONS_EMULATOR === "true";

    // ✅ Local emulator/dev bypass only
    if (isEmulated) {
      console.warn(
        `⚠️ Emulator mode: skipping reCAPTCHA verification for action: ${
          action || "unknown"
        }`,
      );

      return {
        success: true,
        score: 1,
        skipped: true,
      };
    }

    if (!token) {
      throw new HttpsError("invalid-argument", "reCAPTCHA token is required.");
    }

    const recaptchaSecret = RECAPTCHA_SECRET_KEY.value();

    if (!recaptchaSecret) {
      console.error("❌ reCAPTCHA secret not found.");
      throw new HttpsError(
        "internal",
        "Server error. Missing reCAPTCHA secret.",
      );
    }

    const url =
      "https://www.google.com/recaptcha/api/siteverify" +
      `?secret=${recaptchaSecret}` +
      `&response=${token}`;

    try {
      const response = await fetch(url, { method: "POST" });
      const result = await response.json();

      if (!result.success) {
        console.warn("🛑 reCAPTCHA verification failed:", result["error-codes"]);

        return {
          success: false,
          score: 0,
          errors: result["error-codes"] || [],
        };
      }

      if (typeof result.score === "number" && result.score < 0.5) {
        console.warn("⚠️ Low reCAPTCHA score:", result.score);

        return {
          success: false,
          score: result.score,
        };
      }

      return {
        success: true,
        score: result.score ?? null,
      };
    } catch (error) {
      console.error("❌ Error verifying reCAPTCHA:", error);
      throw new HttpsError("internal", "Failed to verify reCAPTCHA.");
    }
  },
);
