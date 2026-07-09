// 📢 Cloud Function: Admin broadcast email to multiple recipients
/**
 * Sends a broadcast email using SendGrid.
 *
 * Required data fields:
 * - `recipients`: string[] – array of recipient email addresses.
 * - `subject`: string – email subject line.
 * - `htmlContent`: string – HTML body of the email.
 *
 * The `SENDGRID_API_KEY` secret must be configured in Firebase.
 * Recipients are sent in batches to stay under SendGrid's per-request limits.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import sgMail from "@sendgrid/mail";
import { defineSecret } from "firebase-functions/params";
import { logEmailEvent } from "../utils/emailLog.js";

// Secret configured via `firebase functions:secrets:set SENDGRID_API_KEY`
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

// SendGrid recommends no more than 1000 messages per request
const BATCH_SIZE = 1000;

function useSendGridSandboxMode() {
  if (process.env.SENDGRID_SANDBOX_MODE) {
    return process.env.SENDGRID_SANDBOX_MODE === "true";
  }
  return process.env.FUNCTIONS_EMULATOR === "true";
}

function useLocalSendGridSandbox() {
  return process.env.FUNCTIONS_EMULATOR === "true" && useSendGridSandboxMode();
}

const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

const sendAdminBroadcastEmailHandler = async (request) => {
  if (!request.auth?.token?.admin) {
    throw new HttpsError(
      "permission-denied",
      "Only admins can send broadcast emails.",
    );
  }

  const { recipients, subject, htmlContent } = request.data || {};

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    throw new HttpsError("invalid-argument", "Recipients list is missing or invalid.");
  }

  if (!subject || !htmlContent) {
    throw new HttpsError("invalid-argument", "Missing subject or content.");
  }

  const messages = recipients.map((email) => ({
    to: email,
    from: "hello@recoverytools.au",
    subject,
    html: htmlContent,
    mailSettings: {
      sandboxMode: {
        enable: useSendGridSandboxMode(),
      },
    },
  }));

  const batches = chunkArray(messages, BATCH_SIZE);

  try {
    if (useLocalSendGridSandbox()) {
      await logEmailEvent({
        type: "admin_broadcast",
        status: "sandboxed",
        to: recipients,
        subject,
        providerMode: "local-sandbox",
        sentByUid: request.auth?.uid,
        sentByEmail: request.auth?.token?.email,
        metadata: {
          recipientCount: recipients.length,
        },
      });
      return { success: true, count: recipients.length, sandboxed: true };
    }

    sgMail.setApiKey(SENDGRID_API_KEY.value());
    let totalSent = 0;
    for (const batch of batches) {
      await sgMail.send(batch);
      totalSent += batch.length;
    }
    await logEmailEvent({
      type: "admin_broadcast",
      status: "sent",
      to: recipients,
      subject,
      providerMode: useSendGridSandboxMode() ? "sendgrid-sandbox" : "live",
      sentByUid: request.auth?.uid,
      sentByEmail: request.auth?.token?.email,
      metadata: {
        recipientCount: totalSent,
      },
    });
    return { success: true, count: totalSent };
  } catch (err) {
    console.error("SendGrid broadcast error:", err);
    await logEmailEvent({
      type: "admin_broadcast",
      status: "failed",
      to: recipients,
      subject,
      providerMode: useSendGridSandboxMode() ? "sendgrid-sandbox" : "live",
      errorMessage: err.message || "Failed to send broadcast email.",
      sentByUid: request.auth?.uid,
      sentByEmail: request.auth?.token?.email,
      metadata: {
        recipientCount: recipients.length,
      },
    });
    throw new HttpsError("internal", "Failed to send broadcast email.");
  }
};

// ✅ Set region at function level, not globally
export const sendAdminBroadcastEmail = onCall(
  {
    secrets: [SENDGRID_API_KEY],
    region: "australia-southeast1",
  },
  sendAdminBroadcastEmailHandler,
);
