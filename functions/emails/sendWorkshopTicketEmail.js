import { onCall, HttpsError } from "firebase-functions/v2/https";
import sgMail from "@sendgrid/mail";
import { defineSecret } from "firebase-functions/params";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

const sendWorkshopTicketEmailHandler = async (data) => {
  const { to, workshopName, ticketId } = data;
  if (!to || !workshopName || !ticketId) {
    throw new HttpsError("invalid-argument", "Missing required fields.");
  }

  sgMail.setApiKey(SENDGRID_API_KEY.value());
  const msg = {
    to,
    from: "hello@recoverytools.au",
    subject: `Your Ticket for ${workshopName}`,
    html: `
      <p>Hi there,</p>
      <p>Thanks for registering for <strong>${workshopName}</strong>.</p>
      <p>Your ticket ID: <strong>${ticketId}</strong></p>
      <p>We look forward to seeing you at the workshop.</p>
    `,
  };

  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (err) {
    console.error("sendWorkshopTicketEmail error:", err);
    throw new HttpsError("internal", "Failed to send ticket email.");
  }
};

export const sendWorkshopTicketEmail = onCall(
  {
    region: "australia-southeast1",
    secrets: [SENDGRID_API_KEY],
  },
  sendWorkshopTicketEmailHandler,
);
