import { getBusinessProfile } from "../utils/business-profile.js";

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isOpenableUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function policyActions({ title, pdfUrl }) {
  if (!pdfUrl) return "";
  if (!isOpenableUrl(pdfUrl)) {
    return `
      <div class="mt-5 rounded border border-yellow-700 bg-yellow-950/40 p-4 text-sm text-yellow-100">
        The configured PDF asset is not a browser-openable URL yet.
        <div class="mt-2 break-all text-yellow-200">${escapeHTML(pdfUrl)}</div>
      </div>
    `;
  }

  const safeUrl = escapeHTML(pdfUrl);
  const safeTitle = escapeHTML(title);
  return `
    <div class="mt-5 flex flex-wrap items-center gap-3">
      <button
        type="button"
        class="policy-open-pdf inline-flex rounded bg-[#407471] px-4 py-2 font-semibold text-white hover:bg-[#305a56]"
        data-pdf-url="${safeUrl}"
      >
        Open PDF
      </button>
      <a
        href="${safeUrl}"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex rounded bg-gray-700 px-4 py-2 font-semibold text-white hover:bg-gray-600"
      >
        Open in new tab
      </a>
      <button
        type="button"
        class="policy-copy-link inline-flex rounded bg-gray-700 px-4 py-2 font-semibold text-white hover:bg-gray-600"
        data-pdf-url="${safeUrl}"
      >
        Copy link
      </button>
    </div>
    <div class="mt-4 rounded border border-gray-700 bg-gray-900 p-3 text-sm text-gray-300">
      If the preview below is blank in this browser, use Open PDF or Open in new tab.
    </div>
    <object
      data="${safeUrl}"
      type="application/pdf"
      title="${safeTitle} PDF"
      class="mt-5 h-[75vh] w-full rounded border border-gray-700 bg-white"
    >
      <div class="p-4 text-gray-900">
        PDF preview is not available in this browser.
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Open ${safeTitle}</a>.
      </div>
    </object>
  `;
}

function bindPolicyActions(section) {
  section.querySelectorAll(".policy-open-pdf").forEach((button) => {
    button.addEventListener("click", () => {
      const url = button.dataset.pdfUrl;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });
  });

  section.querySelectorAll(".policy-copy-link").forEach((button) => {
    button.addEventListener("click", async () => {
      const url = button.dataset.pdfUrl;
      if (!url) return;
      await navigator.clipboard?.writeText(url);
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy link";
      }, 1600);
    });
  });
}

export async function renderPolicyPage({ sectionId, title, pdfField, fallback }) {
  const section = document.getElementById(sectionId);
  if (!section) return;

  const business = await getBusinessProfile();
  const pdfUrl = business[pdfField] || "";
  section.classList.remove("hidden");
  section.innerHTML = `
    <div class="mx-auto max-w-3xl px-6 py-12 text-white">
      <h1 class="text-3xl font-bold">${escapeHTML(title)}</h1>
      ${pdfUrl
    ? policyActions({ title, pdfUrl })
    : `<p class="mt-3 text-gray-300">${escapeHTML(fallback)}</p>`}
    </div>
  `;
  bindPolicyActions(section);
}
