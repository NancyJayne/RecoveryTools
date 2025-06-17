
// 📧 sendTransactionalEmail.js
import { onCall, HttpsError } from "firebase-functions/v2/https";
import sgMail from "@sendgrid/mail";
import { defineSecret } from "firebase-functions/params";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

const sendTransactionalEmailHandler = async (data) => {
  const { to, templateId, dynamicTemplateData } = data;

  if (!to || !templateId) {
    throw new HttpsError("invalid-argument", "Missing email or template ID.");
  }

  sgMail.setApiKey(SENDGRID_API_KEY.value());

  const msg = {
    to,
    from: "hello@recoverytools.au",
    templateId,
    dynamic_template_data: dynamicTemplateData,
  };

  try {
    await sgMail.send(msg);
    return { success: true, message: "Email sent." };
  } catch (err) {
    console.error("SendGrid error:", err);
    throw new HttpsError("internal", "Failed to send email.");
  }
};

export const sendTransactionalEmail = onCall(
  {
    region: "australia-southeast1", // ✅ scoped region — no warning
    secrets: [SENDGRID_API_KEY],
  },
  sendTransactionalEmailHandler,
);
