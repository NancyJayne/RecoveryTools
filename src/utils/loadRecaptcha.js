// src/utils/loadRecaptcha.js
export async function loadRecaptchaScript(siteKey) {
  if (!siteKey || typeof document === "undefined") {
    console.warn("⚠️ Site key missing or document undefined.");
    return;
  }

  if (document.querySelector("#recaptchaScript")) {
    console.log("ℹ️ reCAPTCHA script already loaded.");
    return;
  }

  console.log("🌀 Injecting reCAPTCHA script with siteKey:", siteKey);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "recaptchaScript";
    script.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (window.grecaptcha) {
        window.grecaptcha.ready(resolve);
      } else {
        reject(new Error("reCAPTCHA failed to load"));
      }
    };

    script.onerror = reject;
    document.head.appendChild(script);
  });
}
