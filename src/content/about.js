import { getBusinessProfile } from "../utils/business-profile.js";

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function initAboutPage() {
  const section = document.getElementById("aboutSection");
  if (!section) return;

  const business = await getBusinessProfile();
  section.innerHTML = `
    <div class="mx-auto grid max-w-5xl gap-8 px-6 py-12 text-white md:grid-cols-[1fr_360px] md:items-start">
      <div>
        <h1 class="text-3xl font-bold">${escapeHTML(business.aboutTitle || `About ${business.name}`)}</h1>
        <div class="mt-4 whitespace-pre-line text-gray-300 leading-7">
          ${escapeHTML(business.aboutDescription || "")}
        </div>
      </div>
      ${business.aboutImageUrl
    ? `<img
          src="${escapeHTML(business.aboutImageUrl)}"
          alt="${escapeHTML(business.aboutTitle || business.name || "Recovery Tools")}"
          class="w-full rounded-lg border border-gray-800 object-cover shadow"
        >`
    : ""}
    </div>
  `;
  section.classList.add("active");
  section.scrollIntoView({ behavior: "smooth" });
}

export default initAboutPage;
