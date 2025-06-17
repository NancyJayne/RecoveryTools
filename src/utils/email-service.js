// SendGrid or SMTP trigger logic

// email-service.js — SendGrid Email Trigger via Firebase Callable Function

import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase-config.js";

const sendEmail = httpsCallable(functions, "sendTransactionalEmail");

/**
 * Send a dynamic email through Firebase Callable Function + SendGrid.
 * @param {Object} params - Email parameters
 * @param {string} params.to - Recipient email
 * @param {string} params.templateId - SendGrid template ID
 * @param {Object} params.dynamicTemplateData - Template data
 */
export async function sendTransactionalEmail({ to, templateId, dynamicTemplateData }) {
  try {
    const response = await sendEmail({ to, templateId, dynamicTemplateData });
    return response.data;
  } catch (error) {
    console.error("Error sending transactional email:", error);
    throw error;
  }
}
