
// 📧 sendTransactionalEmail.js
import { HttpsError } from "firebase-functions/v2/https";
import sgMail from "@sendgrid/mail";
import { defineSecret } from "firebase-functions/params";
import { getBusinessProfile } from "../utils/businessProfile.js";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

export async function sendTransactionalEmail({
  to,
  templateId,
  dynamicTemplateData,
}) {
  if (!to || !templateId) {
    throw new HttpsError("invalid-argument", "Missing email or template ID.");
  }

  sgMail.setApiKey(SENDGRID_API_KEY.value());
  const business = await getBusinessProfile();

  const msg = {
    to,
    from: business.email,
    templateId,
    dynamic_template_data: dynamicTemplateData,
  };

  try {
    await sgMail.send(msg);

    return {
      success: true,
      message: "Email sent.",
    };
  } catch (err) {
    console.error("SendGrid error:", err);

    throw new HttpsError(
      "internal",
      "Failed to send email.",
    );
  }
}
