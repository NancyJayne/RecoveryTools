function n(){const e=document.getElementById("adminDashboardSection")||a();e.innerHTML=`
    <div class="max-w-4xl mx-auto py-12 px-6">
      <h1 class="text-3xl font-bold text-white mb-6">Admin Dashboard</h1>
      <p class="text-gray-400">This is a placeholder for the admin dashboard features.</p>
    </div>
  `}function a(){var t;const e=document.createElement("section");return e.id="adminDashboardSection",e.classList.add("min-h-screen","bg-gray-900"),(t=document.querySelector("main"))==null||t.appendChild(e),e}export{n as initAdminDashboard};
