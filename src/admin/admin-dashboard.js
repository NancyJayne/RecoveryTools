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

function statTile({ label, value, href = "", attention = false, note = "" }) {
  const attentionClasses = attention
    ? "border-purple-500 bg-purple-950/60 ring-1 ring-purple-500/60"
    : "border-gray-700 bg-gray-800";
  const linkClasses = [
    `router-link block min-h-32 rounded border p-4 ${attentionClasses}`,
    "hover:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-500",
  ].join(" ");
  const labelColor = attention ? "text-purple-200" : "text-gray-400";
  const noteColor = attention ? "text-purple-200" : "text-gray-500";
  const content = `
    <div class="min-h-9 text-xs uppercase tracking-wide leading-snug ${labelColor}">${label}</div>
    <div class="mt-3 min-w-0 break-words text-2xl font-semibold leading-tight text-white sm:text-3xl">${value}</div>
    ${note ? `<div class="mt-2 text-xs ${noteColor}">${note}</div>` : ""}
  `;

  if (!href) {
    return `<div class="min-h-32 rounded border p-4 ${attentionClasses}">${content}</div>`;
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
  const actionTiles = [
    statTile({
      label: "New / unassigned",
      value: Number(stats.newUnassignedOrders || 0),
      href: "/admin/orders",
      attention: Number(stats.newUnassignedOrders || 0) > 0,
      note: "Orders waiting to be claimed",
    }),
    statTile({
      label: "Open returns / complaints",
      value: Number(stats.openCustomerIssues || 0),
      href: "/admin/orders?issues=open",
      attention: Number(stats.openCustomerIssues || 0) > 0,
      note: "Customer issues needing follow-up",
    }),
    statTile({
      label: "Pending approvals",
      value: Number(stats.pendingApprovals || 0),
      href: "/admin/approvals",
      attention: Number(stats.pendingApprovals || 0) > 0,
      note: "Submissions waiting for review",
    }),
  ].join("");

  const overviewTiles = [
    statTile({
      label: "Open orders",
      value: Number(stats.openOrders || 0),
      href: "/admin/orders",
    }),
    statTile({
      label: "Due soon / overdue",
      value: Number(stats.ordersDueSoon || 0),
      href: "/admin/orders",
      attention: Number(stats.ordersDueSoon || 0) > 0,
      note: "Open orders due within 3 days",
    }),
    statTile({
      label: "Total orders",
      value: Number(stats.totalOrders || 0),
    }),
    statTile({
      label: "Users",
      value: Number(stats.totalUsers || 0),
      href: "/admin/crm",
    }),
    statTile({
      label: "Revenue",
      value: formatCurrency(stats.totalRevenue),
    }),
    statTile({
      label: "Content drafts",
      value: Number(stats.contentDrafts || 0),
      href: "/admin/content?status=draft",
      note: "Items, Blueprints and Plans",
    }),
  ].join("");

  container.innerHTML = `
    <div class="mx-auto max-w-6xl px-6 py-10">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-white">Admin Dashboard</h1>
      </div>

      <section aria-labelledby="dashboardAttentionHeading">
        <h2 id="dashboardAttentionHeading" class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Needs attention
        </h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          ${actionTiles}
        </div>
      </section>

      <section class="mt-8" aria-labelledby="dashboardOverviewHeading">
        <h2 id="dashboardOverviewHeading" class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Overview
        </h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          ${overviewTiles}
        </div>
      </section>
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
