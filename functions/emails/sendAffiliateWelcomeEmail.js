// 📧 sendAffiliateWelcomeEmail.js – Welcome email for new affiliates
import { onCall, HttpsError } from "firebase-functions/v2/https";
import sgMail from "@sendgrid/mail";
import { defineSecret } from "firebase-functions/params";

// Define secret
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

const sendAffiliateWelcomeEmailHandler = async (data) => {
  const { email, name } = data;

  if (!email || !name) {
    throw new HttpsError("invalid-argument", "Missing name or email.");
  }

  sgMail.setApiKey(SENDGRID_API_KEY.value());

  const msg = {
    to: email,
    from: "hello@recoverytools.au",
    subject: "Welcome to the RecoveryTools Affiliate Program!",
    html: `
      <h2>Welcome, ${name}!</h2>
      <p>You're now part of our affiliate team. Start sharing and earning by using your dashboard:</p>
      <a href="https://recoverytools.au/affiliate">Visit Affiliate Dashboard</a>
      <p>Need help? Reach out anytime at hello@recoverytools.au</p>
    `,
  };

  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (err) {
    console.error("SendGrid affiliate welcome error:", err);
    throw new HttpsError("internal", "Email failed.");
  }
};

// ✅ Set region at function level (not globally)
export const sendAffiliateWelcomeEmail = onCall(
  {
    region: "australia-southeast1",
    secrets: [SENDGRID_API_KEY],
  },
  sendAffiliateWelcomeEmailHandler,
);
