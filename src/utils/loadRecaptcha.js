// src/utils/loadRecaptcha.js
export async function loadRecaptchaScript(siteKey) {
  if (!siteKey || typeof document === "undefined") {
    console.warn("⚠️ Site key missing or document undefined.");
    return;
  }

  const existingScript = document.querySelector("#recaptchaScript");
  if (existingScript) {
    console.log("ℹ️ reCAPTCHA script already loaded.");

    if (window.grecaptcha) {
      // grecaptcha is ready or will call the callback when ready
      return new Promise((resolve) => window.grecaptcha.ready(resolve));
    }

    // Script element exists but grecaptcha not yet available
    return new Promise((resolve, reject) => {
      existingScript.addEventListener("load", () => {
        if (window.grecaptcha) {
          window.grecaptcha.ready(resolve);
        } else {
          reject(new Error("reCAPTCHA failed to load"));
        }
      });
      existingScript.addEventListener("error", reject);
    });
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