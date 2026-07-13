import { httpsCallable } from "firebase/functions";
import { functions } from "../utils/firebase-config.js";

function createFallbackSection() {
  const section = document.createElement("section");
  section.id = "adminDashboardSection";
  section.classList.add("min-h-screen", "bg-gray-900");
  document.querySelector("main")?.appendChild(section);
  return section;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(Number(value || 0));
}

function statTile({ label, value, href = "" }) {
  const linkClasses = [
    "router-link block min-h-32 rounded border border-gray-700 bg-gray-800 p-4",
    "hover:border-[#407471] focus:outline-none focus:ring-2 focus:ring-[#407471]",
  ].join(" ");
  const content = `
    <div class="min-h-9 text-xs uppercase tracking-wide leading-snug text-gray-400">${label}</div>
    <div class="mt-3 min-w-0 break-words text-2xl font-semibold leading-tight text-white sm:text-3xl">${value}</div>
  `;

  if (!href) {
    return `<div class="min-h-32 rounded border border-gray-700 bg-gray-800 p-4">${content}</div>`;
  }

  return `
    <a
      href="${href}"
      class="${linkClasses}"
    >
      ${content}
    </a>
  `;
}

function renderDashboard(container, stats = {}) {
  const tiles = [
    statTile({
      label: "Open orders",
      value: Number(stats.openOrders || 0),
      href: "/admin/orders",
    }),
    statTile({
      label: "New / unassigned",
      value: Number(stats.newUnassignedOrders || 0),
      href: "/admin/orders",
    }),
    statTile({
      label: "Open returns / complaints",
      value: Number(stats.openCustomerIssues || 0),
      href: "/admin/orders?issues=open",
    }),
    statTile({
      label: "Pending approvals",
      value: Number(stats.pendingApprovals || 0),
      href: "/admin/approvals",
    }),
    statTile({
      label: "Total orders",
      value: Number(stats.totalOrders || 0),
    }),
    statTile({
      label: "Users",
      value: Number(stats.totalUsers || 0),
    }),
    statTile({
      label: "Revenue",
      value: formatCurrency(stats.totalRevenue),
    }),
  ].join("");

  container.innerHTML = `
    <div class="mx-auto max-w-6xl px-6 py-10">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-white">Admin Dashboard</h1>
      </div>

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        ${tiles}
      </div>
    </div>
  `;
}

export async function initAdminDashboard() {
  document.querySelectorAll("main > section").forEach((section) => {
    section.classList.add("hidden");
  });

  const container = document.getElementById("adminDashboardSection") || createFallbackSection();
  container.classList.remove("hidden");
  container.innerHTML = `
    <div class="mx-auto max-w-6xl px-6 py-10 text-gray-300">
      Loading dashboard...
    </div>
  `;

  try {
    const getStats = httpsCallable(functions, "getUserDashboardStats");
    const result = await getStats();
    renderDashboard(container, result.data || {});
  } catch (err) {
    console.error("Failed to load admin dashboard stats:", err);
    container.innerHTML = `
      <div class="mx-auto max-w-6xl px-6 py-10">
        <h1 class="text-3xl font-bold text-white">Admin Dashboard</h1>
        <p class="mt-4 text-red-300">Failed to load dashboard stats.</p>
      </div>
    `;
  }
}

export default initAdminDashboard;
