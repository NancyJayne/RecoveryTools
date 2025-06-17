// 📧 sendContactMessage.js – Firebase Callable Function with fallback secret support
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import fetch from "node-fetch";

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

const sendContactMessageHandler = async (data) => {
  const { name, email, message, recaptchaToken } = data || {};

  if (!name || !email || !message || !recaptchaToken) {
    throw new HttpsError("invalid-argument", "Missing required fields.");
  }

  const recaptchaKey = process.env.RECAPTCHA_SECRET_KEY ||
    (typeof RECAPTCHA_SECRET_KEY.value === "function"
      ? RECAPTCHA_SECRET_KEY.value()
      : undefined);
  const sendgridKey = process.env.SENDGRID_API_KEY ||
    (typeof SENDGRID_API_KEY.value === "function"
      ? SENDGRID_API_KEY.value()
      : undefined);

  if (!recaptchaKey || !sendgridKey) {
    console.error("Missing reCAPTCHA or SendGrid key.");
    throw new HttpsError("internal", "Server configuration error.");
  }

  // ✅ Verify reCAPTCHA
  const verifyRes = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `secret=${recaptchaKey}&response=${recaptchaToken}`,
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

  const msg = {
    to: "hello@recoverytools.au",
    from: "no-reply@recoverytools.au",
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
