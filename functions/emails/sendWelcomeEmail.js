// functions/emails/sendWelcomeEmail.js
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import sgMail from "@sendgrid/mail";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

export const sendWelcomeEmail = onCall(
  {
    region: "australia-southeast1",
    secrets: [SENDGRID_API_KEY],
  },
  async (data) => {
    const { to, firstName } = data;

    if (!to || !firstName) {
      throw new HttpsError("invalid-argument", "Missing email or first name.");
    }

    const templateId = "d-d2b2f4878eb14c8bb61dc5fbd0deff7a";
    sgMail.setApiKey(SENDGRID_API_KEY.value());

    const msg = {
      to,
      from: "hello@recoverytools.au",
      templateId,
      dynamic_template_data: {
        first_name: firstName,
      },
    };

    try {
      await sgMail.send(msg);
      return { success: true };
    } catch (err) {
      console.error("Welcome email error:", err);
      throw new HttpsError("internal", "Failed to send welcome email.");
    }
  },
);
