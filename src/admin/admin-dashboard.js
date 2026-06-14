// Main admin panel
// src/admin/admin-dashboard.js

export function initAdminDashboard() {
  console.log("✅ Admin dashboard loaded");

  document.querySelectorAll("main > section").forEach((section) => {
    section.classList.add("hidden");
  });

  const container =
    document.getElementById("adminDashboardSection") || createFallbackSection();

  container.classList.remove("hidden");

  container.innerHTML = `
    <div class="max-w-4xl mx-auto py-12 px-6">
      <h1 class="text-3xl font-bold text-white mb-6">Admin Dashboard</h1>
      <p class="text-gray-400">This is a placeholder for the admin dashboard features.</p>
    </div>
  `;
}

function createFallbackSection() {
  const section = document.createElement("section");
  section.id = "adminDashboardSection";
  section.classList.add("min-h-screen", "bg-gray-900");
  document.querySelector("main")?.appendChild(section);
  return section;
}

export default initAdminDashboard;
