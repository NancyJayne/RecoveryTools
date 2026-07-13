// 📧 sendContactMessage.js – Firebase Callable Function using Firebase Secret Manager
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import fetch from "node-fetch";
import { getBusinessProfile } from "../utils/businessProfile.js";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const RECAPTCHA_SECRET_KEY = defineSecret("RECAPTCHA_SECRET_KEY");

if (!Array.isArray(admin.apps) || admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

// Simple HTML escape to prevent injection
function escapeHTML(str) {
  return str?.replace(/[&<>"']/g, (match) => {
    const escapeMap = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;",
    };
    return escapeMap[match];
  });
}

const sendContactMessageHandler = async (request) => {
  const { name, email, message, token } = request.data || {};

  if (!name || !email || !message || !token) {
    throw new HttpsError("invalid-argument", "Missing required fields.");
  }

  const recaptchaKey = RECAPTCHA_SECRET_KEY.value();
  const sendgridKey = SENDGRID_API_KEY.value();

  if (!recaptchaKey || !sendgridKey) {
    console.error("Missing reCAPTCHA or SendGrid key.");
    throw new HttpsError("internal", "Server configuration error.");
  }

  // ✅ Verify reCAPTCHA
  const verifyRes = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `secret=${recaptchaKey}&response=${token}`,
  });

  const verifyData = await verifyRes.json();

  if (!verifyData.success || verifyData.score < 0.5) {
    console.warn("⚠️ reCAPTCHA failed or suspicious score:", verifyData);

    await db.collection("contactMessages").add({
      name,
      email,
      message,
      recaptchaScore: verifyData.score || null,
      verified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    throw new HttpsError("permission-denied", "Failed CAPTCHA verification.");
  }

  sgMail.setApiKey(sendgridKey);

  const safeName = escapeHTML(name);
  const safeEmail = escapeHTML(email);
  const safeMessage = escapeHTML(message).replace(/\n/g, "<br>");
  const business = await getBusinessProfile();

  const msg = {
    to: business.email,
    from: business.email,
    replyTo: safeEmail,
    subject: `📬 Contact Message from ${safeName || "Unknown Sender"}`,
    text: `Name: ${name}\nEmail: ${email}\nMessage:\n${message}`,
    html: [
      `<p><strong>Name:</strong> ${safeName}</p>`,
      `<p><strong>Email:</strong> ${safeEmail}</p>`,
      `<p><strong>Message:</strong></p>`,
      `<p>${safeMessage}</p>`,
    ].join(""),
  };

  try {
    await sgMail.send(msg);

    await db.collection("contactMessages").add({
      name,
      email,
      message,
      recaptchaScore: verifyData.score,
      verified: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      message: "Message sent successfully.",
    };
  } catch (err) {
    console.error("❌ SendGrid error:", err.response?.body || err);

    await db.collection("contactMessages").add({
      name,
      email,
      message,
      recaptchaScore: verifyData.score,
      verified: true,
      emailSent: false,
      error: err.message || "SendGrid error",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    throw new HttpsError("internal", "Failed to send message.");
  }
};

export const sendContactMessage = onCall(
  {
    region: "australia-southeast1",
    secrets: [SENDGRID_API_KEY, RECAPTCHA_SECRET_KEY],
  },
  sendContactMessageHandler,
);
