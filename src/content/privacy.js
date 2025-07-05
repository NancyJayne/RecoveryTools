// content/privacy.js
export function initPrivacyPage() {
  const section = document.getElementById("privacySection");
  if (!section) return;
  section.classList.remove("hidden");
  section.innerHTML = `
    <div class="max-w-2xl mx-auto text-white text-sm">
      <h1 class="text-2xl font-bold mb-4">Privacy Policy</h1>
      <p>This is a placeholder for our Privacy Policy content.</p>
    </div>
  `;
}
export default initPrivacyPage;
