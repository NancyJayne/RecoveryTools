// View clients, calendar
// therapist-dashboard.js – Therapist Entry Point

export function initTherapistDashboard() {
  const section = document.getElementById("therapistDashboardSection");
  if (!section) return;

  section.classList.remove("hidden");
  section.innerHTML = `
    <div class="max-w-4xl mx-auto px-4 py-8 text-white">
      <h1 class="text-3xl font-bold mb-4">Therapist Dashboard</h1>
      <p class="text-gray-400 mb-6">Welcome! Here you'll manage your clients, appointments, and resources.</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-gray-800 p-6 rounded shadow">
          <h2 class="text-xl font-semibold mb-2">🗓️ Appointments</h2>
          <p class="text-sm text-gray-400">View and manage upcoming sessions.</p>
        </div>
        <div class="bg-gray-800 p-6 rounded shadow">
          <h2 class="text-xl font-semibold mb-2">📁 Patient Files</h2>
          <p class="text-sm text-gray-400">Access client notes and treatment records.</p>
        </div>
        <div class="bg-gray-800 p-6 rounded shadow">
          <h2 class="text-xl font-semibold mb-2">📚 Resources</h2>
          <p class="text-sm text-gray-400">Prescribe programs, products, and courses.</p>
        </div>
        <div class="bg-gray-800 p-6 rounded shadow">
          <h2 class="text-xl font-semibold mb-2">💼 Account Settings</h2>
          <p class="text-sm text-gray-400">Update your profile, preferences, and payment info.</p>
        </div>
      </div>
    </div>
  `;

  section.scrollIntoView({ behavior: "smooth" });
}
