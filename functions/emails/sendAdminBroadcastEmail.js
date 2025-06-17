
// 📢 sendAdminBroadcastEmail.js – Admin broadcast email to multiple recipients
import { onCall, HttpsError } from "firebase-functions/v2/https";
import sgMail from "@sendgrid/mail";
import { defineSecret } from "firebase-functions/params";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

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

  try {
    await sgMail.send(messages);
    return { success: true, count: messages.length };
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
