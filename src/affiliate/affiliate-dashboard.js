// affiliate-dashboard.js
import { loadAffiliatePayouts } from "./affiliate-payouts.js";
import { setupStripeButtons } from "./affiliate-stripe.js";
import { renderSubmittedCourses, setupCourseProposalForm } from "./affiliate-courses.js";
import { renderSubmittedWorkshops, setupWorkshopForm } from "./affiliate-workshops.js";
import { exportPayoutsToCSV } from "./affiliate-utils.js";
import { formatDateTime } from "../utils/date-utils.js";

let payoutsCache = [];

export function initAffiliateDashboard() {
  document.querySelectorAll(".affiliate-link").forEach((link) => {
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      const targetId = link.getAttribute("href").replace("#", "");
      document.querySelectorAll(".affiliate-tab").forEach((tab) => tab.classList.add("hidden"));
      document.getElementById(targetId)?.classList.remove("hidden");

      if (targetId === "affiliateEarningsTab") {
        await renderPayouts();
      } else if (targetId === "affiliateSettingsTab") {
        await setupStripeButtons();
      } else if (targetId === "submitCourseProposalTab") {
        setupCourseProposalForm();
      } else if (targetId === "mySubmittedCoursesTab") {
        renderSubmittedCourses();
      } else if (targetId === "submitWorkshopTab") {
        setupWorkshopForm();
      } else if (targetId === "mySubmittedWorkshopsTab") {
        renderSubmittedWorkshops();
      }
    });
  });

  // Auto-show first tab
  document.querySelector(".affiliate-link")?.click();

  document.getElementById("exportPayoutsBtn")?.addEventListener("click", () => exportPayoutsToCSV(payoutsCache));
  document.getElementById("applyFilterBtn")?.addEventListener("click", applyFilter);
  document.getElementById("filterType")?.addEventListener("change", toggleFilterInputs);
}

async function renderPayouts(filters = {}) {
  const payouts = await loadAffiliatePayouts();
  payoutsCache = payouts;

  const payoutsContainer = document.getElementById("payoutsContainer");
  payoutsContainer.innerHTML = "";

  let filtered = payouts;
  if (filters.month) {
    const [year, month] = filters.month.split("-");
    filtered = payouts.filter((p) => {
      const date = new Date(p.createdAt.seconds * 1000);
      return date.getFullYear() == year && (date.getMonth() + 1) == month;
    });
  } else if (filters.start && filters.end) {
    filtered = payouts.filter((p) => {
      const date = new Date(p.createdAt.seconds * 1000);
      return date >= filters.start && date <= filters.end;
    });
  }

  if (!filtered.length) {
    payoutsContainer.innerHTML = `<p class="text-sm text-gray-500">No payouts match your filter.</p>`;
    return;
  }

  const total = filtered.reduce((sum, p) => sum + (p.amount || 0), 0);
  payoutsContainer.innerHTML = `
  <div class="text-green-400 text-sm font-semibold mb-3">
    Total: $${total.toFixed(2)}
  </div>
`;

  filtered.forEach((payout) => {
    const div = document.createElement("div");
    div.className = "bg-gray-800 p-4 rounded shadow-sm flex justify-between items-center";
    const dateStr = formatDateTime(payout.createdAt);

    div.innerHTML = `
      <div>
        <p class="text-white font-medium">Payout of $${(payout.amount || 0).toFixed(2)} AUD</p>
        <p class="text-sm text-gray-400">${dateStr}</p>
      </div>
      <span class="text-green-400 text-sm font-mono">Stripe ID: ${payout.stripePayoutId || "—"}</span>
    `;
    payoutsContainer.appendChild(div);
  });
}

function toggleFilterInputs(e) {
  const type = e.target.value;
  document.getElementById("monthInput").classList.toggle("hidden", type !== "monthly");
  document.getElementById("financialYearInput").classList.toggle("hidden", type !== "financialYear");
}

function applyFilter() {
  const type = document.getElementById("filterType").value;

  if (type === "monthly") {
    const month = document.getElementById("monthInput").value;
    if (month) renderPayouts({ month });
  } else if (type === "financialYear") {
    const fy = document.getElementById("financialYearInput").value;
    const start = new Date(`${fy}-07-01`);
    const end = new Date(`${+fy + 1}-06-30`);
    renderPayouts({ start, end });
  } else {
    renderPayouts();
  }
}
