// content/support.js
export function initSupportPage() {
  const section = document.getElementById("supportSection");
  if (!section) return;
  section.classList.remove("hidden");
  section.innerHTML = `
    <div class="max-w-2xl mx-auto text-white text-sm">
      <h1 class="text-2xl font-bold mb-4">Support</h1>
      <p>This is a placeholder for our Support content.</p>
    </div>
  `;
}