// contact.js – Handles contact form submission with reCAPTCHA, Firestore logging, and secure email
import { functions } from "../utils/firebase-config.js";
import { httpsCallable } from "firebase/functions";
import { showToast } from "../utils/utils.js";
import { executeRecaptcha } from "../utils/verifyRecaptchaToken.js"; // ✅ Use central utility

export function initContactPage() {
  const section = document.getElementById("contactSection");
  section?.classList.add("active");
  section?.scrollIntoView({ behavior: "smooth" });

  const form = document.getElementById("contactForm");
  const status = document.getElementById("contactStatus");

  if (!form) return;
  if (form.dataset.bound === "true") return;
  form.dataset.bound = "true";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = form.name.value.trim();
    const email = form.email.value.trim().toLowerCase();
    const message = form.message.value.trim();
    const submitBtn = form.querySelector("button[type='submit']");

    if (!name || !email || !message) {
      showToast("Please complete all fields.", "error");
      form.name.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";

    try {
      // sendContactMessage performs the authoritative CAPTCHA check. Avoid
      // consuming this single-use token in verifyRecaptchaToken first.
      const token = await executeRecaptcha("contact_form", { verify: false });

      // ✅ Log to Firestore
      // ✅ Trigger backend email
      const sendContactMessage = httpsCallable(functions, "sendContactMessage");
      await sendContactMessage({ name, email, message, token });

      form.reset();
      status?.classList.remove("hidden");
      showToast("✅ Message sent successfully!", "success");
    } catch (err) {
      console.error("❌ Contact form error:", err);
      showToast("There was a problem sending your message. Please try again.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send Message";
    }
  });
}

export default initContactPage;
