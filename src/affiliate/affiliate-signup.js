// ./affiliate/affiliate-signup.js – Placeholder setup for Affiliate Signup Page

export function initAffiliateSignup() {
  const section = document.getElementById("affiliateSignupSection");
  if (!section) return;

  section.classList.remove("hidden");
  section.scrollIntoView({ behavior: "smooth" });

  section.innerHTML = `
    <div class="max-w-2xl mx-auto text-center mt-12">
      <h2 class="text-2xl font-bold text-white mb-4">Become an Affiliate</h2>
      <p class="text-gray-300 mb-6">
        Help us spread recovery education and earn commissions when people sign up through your link.
        This section is currently being built – more details coming soon.
      </p>
      <a
        href="/"
        class="inline-block bg-[#407471] text-white px-4 py-2 rounded hover:bg-[#305c56] transition"
      >
        Back to Home
      </a>
    </div>
  `;
}

