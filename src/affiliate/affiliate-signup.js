// ./affiliate/affiliate-signup.js – Handles Affiliate signup CTA and form display

export function initAffiliateSignup() {
  const whySection = document.getElementById("affiliateWhySection");
  const registerSection = document.getElementById("affiliateRegisterSection");

  if (!whySection) return;

  // Show the informational "Why Join" section by default
  whySection.classList.add("active");
  whySection.classList.remove("hidden");
  whySection.scrollIntoView({ behavior: "smooth" });

  const showRegisterSection = async () => {
    if (!registerSection) return;
    registerSection.classList.remove("hidden");
    registerSection.classList.add("active");
    whySection.classList.add("hidden");
    whySection.classList.remove("active");

    const { initAffiliateRegisterForm } = await import(
      new URL("./affiliate-registration.js", import.meta.url)
    );
    initAffiliateRegisterForm?.();
  };

  const url = new URL(window.location.href);
  if (url.hash === "#register" || url.searchParams.has("register")) {
    showRegisterSection();
  }

  const startBtn = document.getElementById("startAffiliateBtn");
  startBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    history.pushState({}, "", "#register");
    showRegisterSection();
  });
}

export default initAffiliateSignup;
