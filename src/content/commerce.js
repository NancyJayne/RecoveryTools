// content/commerce.js
export function initCommercePage() {
  const section = document.getElementById("commerceSection");
  if (!section) return;
  section.classList.remove("hidden");
  section.innerHTML = `
    <div class="max-w-2xl mx-auto text-white text-sm">
      <h1 class="text-2xl font-bold mb-4">Commerce Info</h1>
      <p>This is a placeholder for our Commerce content.</p>
    </div>
  `;
}
export default initCommercePage;
