// content/terms.js
export function initTermsPage() {
  const section = document.getElementById("termsSection");
  if (!section) return;
  section.classList.remove("hidden");
  section.innerHTML = `
    <div class="max-w-2xl mx-auto text-white text-sm">
      <h1 class="text-2xl font-bold mb-4">Terms & Conditions</h1>
      <p>This is a placeholder for our Terms & Conditions content.</p>
    </div>
  `;
}
export default initTermsPage;
