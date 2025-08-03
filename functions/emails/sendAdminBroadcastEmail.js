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

// Secret configured via `firebase functions:secrets:set SENDGRID_API_KEY`
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

// SendGrid recommends no more than 1000 messages per request
const BATCH_SIZE = 1000;

const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

const sendAdminBroadcastEmailHandler = async (data) => {
  const { recipients, subject, htmlContent } = data;

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    throw new HttpsError("invalid-argument", "Recipients list is missing or invalid.");
  }

  if (!subject || !htmlContent) {
    throw new HttpsError("invalid-argument", "Missing subject or content.");
  }

  sgMail.setApiKey(SENDGRID_API_KEY.value());

  const messages = recipients.map((email) => ({
    to: email,
    from: "hello@recoverytools.au",
    subject,
    html: htmlContent,
  }));

  const batches = chunkArray(messages, BATCH_SIZE);

  try {
    let totalSent = 0;
    for (const batch of batches) {
      await sgMail.send(batch);
      totalSent += batch.length;
    }
    return { success: true, count: totalSent };
  } catch (err) {
    console.error("SendGrid broadcast error:", err);
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
