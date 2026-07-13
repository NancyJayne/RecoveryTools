// 📧 sendAffiliateWelcomeEmail.js – Welcome email for new affiliates
import { onCall, HttpsError } from "firebase-functions/v2/https";
import sgMail from "@sendgrid/mail";
import { defineSecret } from "firebase-functions/params";
import { getBusinessProfile } from "../utils/businessProfile.js";

// Define secret
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

const sendAffiliateWelcomeEmailHandler = async (request) => {
  if (!request.auth?.token?.admin) {
    throw new HttpsError(
      "permission-denied",
      "Only admins can send affiliate welcome emails.",
    );
  }

  const { email, name } = request.data || {};

  if (!email || !name) {
    throw new HttpsError("invalid-argument", "Missing name or email.");
  }

  sgMail.setApiKey(SENDGRID_API_KEY.value());
  const business = await getBusinessProfile();

  const msg = {
    to: email,
    from: business.email,
    subject: `Welcome to the ${business.name} Affiliate Program!`,
    html: `
      <h2>Welcome, ${name}!</h2>
      <p>You're now part of our affiliate team. Start sharing and earning by using your dashboard:</p>
      <a href="https://recoverytools.au/affiliate">Visit Affiliate Dashboard</a>
      <p>Need help? Reach out anytime at ${business.email}</p>
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
