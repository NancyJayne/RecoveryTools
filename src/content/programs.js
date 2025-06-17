// src/content/programs.js – Placeholder for Programs Section

export function initProgramsPage() {
  const section = document.getElementById("programsSection");
  if (!section) return;

  section.classList.add("active");
  section.innerHTML = `
    <div class="text-center py-10">
      <h2 class="text-2xl font-bold text-white mb-4">Programs Coming Soon</h2>
      <p class="text-gray-400">We're working on self-guided rehab, mobility and recovery plans.</p>
    </div>
  `;
  section.scrollIntoView({ behavior: "smooth" });
}

// This placeholder ensures the route /programs doesn't trigger a "no module found" warning
