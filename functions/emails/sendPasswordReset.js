// Sends customer password reset emails.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import fetch from "node-fetch";
import { defineSecret } from "firebase-functions/params";
import { logEmailEvent } from "../utils/emailLog.js";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const RECAPTCHA_SECRET_KEY = defineSecret("RECAPTCHA_SECRET_KEY");
const PASSWORD_RESET_TEMPLATE_ID = "d-96f4ed75c9ed4114a4ff41cb0516e22b";

if (!admin.apps.length) {
  admin.initializeApp();
}

function cleanEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isAdmin(request) {
  return request.auth?.token?.admin === true;
}

function useSendGridSandboxMode() {
  if (process.env.SENDGRID_SANDBOX_MODE) {
    return process.env.SENDGRID_SANDBOX_MODE === "true";
  }
  return process.env.FUNCTIONS_EMULATOR === "true";
}

function useLocalSendGridSandbox() {
  return process.env.FUNCTIONS_EMULATOR === "true" && useSendGridSandboxMode();
}

async function verifyRecaptcha(token) {
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    return { success: true, skipped: true };
  }

  if (!token) {
    throw new HttpsError("invalid-argument", "reCAPTCHA token is required.");
  }

  const params = new URLSearchParams();
  params.append("secret", RECAPTCHA_SECRET_KEY.value());
  params.append("response", token);

  const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    body: params,
  });
  const result = await response.json();

  if (!result.success || (typeof result.score === "number" && result.score < 0.5)) {
    console.warn("Password reset reCAPTCHA failed:", result);
    throw new HttpsError("permission-denied", "reCAPTCHA verification failed.");
  }

  return result;
}

async function findUserIdByEmail(email) {
  try {
    const user = await admin.auth().getUserByEmail(email);
    return user.uid;
  } catch (err) {
    if (err.code === "auth/user-not-found") return "";
    throw err;
  }
}

async function sendResetEmail({ email, resetLink, request }) {
  const subject = "Reset Your Password | Recovery Tools";
  const userId = await findUserIdByEmail(email);

  if (useLocalSendGridSandbox()) {
    await logEmailEvent({
      type: "password_reset",
      status: "sandboxed",
      to: email,
      subject,
      userId,
      providerMode: "local-sandbox",
      sentByUid: request.auth?.uid,
      sentByEmail: request.auth?.token?.email,
    });
    console.info("SendGrid password reset skipped locally.", { email, resetLink });
    return { sandboxed: true };
  }

  const message = {
    to: email,
    from: "hello@recoverytools.au",
    templateId: PASSWORD_RESET_TEMPLATE_ID,
    dynamic_template_data: {
      reset_url: resetLink,
      subject,
    },
    mailSettings: {
      sandboxMode: {
        enable: useSendGridSandboxMode(),
      },
    },
  };

  sgMail.setApiKey(SENDGRID_API_KEY.value());
  await sgMail.send(message);
  await logEmailEvent({
    type: "password_reset",
    status: "sent",
    to: email,
    subject,
    userId,
    providerMode: useSendGridSandboxMode() ? "sendgrid-sandbox" : "live",
    sentByUid: request.auth?.uid,
    sentByEmail: request.auth?.token?.email,
  });
  return { sandboxed: false };
}

export const sendPasswordReset = onCall(
  {
    region: "australia-southeast1",
    secrets: [SENDGRID_API_KEY, RECAPTCHA_SECRET_KEY],
  },
  async (request) => {
    const { email, token } = request.data || {};
    const cleanTo = cleanEmail(email);

    if (!cleanTo) {
      throw new HttpsError("invalid-argument", "Missing user email.");
    }

    if (!isAdmin(request)) {
      await verifyRecaptcha(token);
    }

    try {
      const resetLink = await admin.auth().generatePasswordResetLink(cleanTo);
      const result = await sendResetEmail({ email: cleanTo, resetLink, request });

      return {
        success: true,
        sandboxed: result.sandboxed,
        resetLink: isAdmin(request) || process.env.FUNCTIONS_EMULATOR === "true"
          ? resetLink
          : undefined,
      };
    } catch (error) {
      const errorMessage = error.message || "Failed to send reset email.";
      console.error("Password reset email error:", error);
      await logEmailEvent({
        type: "password_reset",
        status: "failed",
        to: cleanTo,
        subject: "Reset Your Password | Recovery Tools",
        providerMode: useSendGridSandboxMode() ? "sendgrid-sandbox" : "live",
        errorMessage,
        sentByUid: request.auth?.uid,
        sentByEmail: request.auth?.token?.email,
      });

      throw new HttpsError("internal", "Failed to send reset email.");
    }
  },
);
