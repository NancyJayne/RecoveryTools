// functions/emails/sendPasswordReset.js
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { sendTransactionalEmail } from "./sendTransactionalEmail.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const sendPasswordReset = onCall(
  { region: "australia-southeast1" },
  async (data) => {
    const { email } = data;
    if (!email) {
      throw new HttpsError("invalid-argument", "Missing user email.");
    }

    try {
      const link = await admin.auth().generatePasswordResetLink(email);

      const templateId = "d-96f4ed75c9ed4114a4ff41cb0516e22b"; 
      await sendTransactionalEmail({
        to: email,
        templateId,
        dynamicTemplateData: {
          reset_url: link,
          subject: "Reset Your Password | Recovery Tools",
        },
      });

      return { success: true, resetLink: link };
    } catch (error) {
      console.error("Password reset email error:", error);
      throw new HttpsError("internal", "Failed to generate reset link.");
    }
  },
);
