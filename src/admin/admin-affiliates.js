// View affiliate performance

import { httpsCallable } from "firebase/functions";
import { functions } from "../utils/firebase-config.js";

const fetchAffiliateStats = httpsCallable(functions, "getAffiliatePerformance");

export async function setupAffiliateStats() {
  const container = document.getElementById("affiliateStatsContainer");
  if (!container) return;
  container.innerHTML = "<p class='text-gray-400'>Loading affiliates...</p>";

  try {
    const res = await fetchAffiliateStats();
    const affiliates = res.data.affiliates || [];
    if (!affiliates.length) {
      container.innerHTML = "<p class='text-gray-400'>No affiliate data found.</p>";
      return;
    }

    const table = document.createElement("table");
    table.className = "min-w-full text-sm";
    table.innerHTML = `
      <thead>
        <tr>
          <th class="px-2 py-1 text-left">Affiliate</th>
          <th class="px-2 py-1 text-left">Clicks</th>
          <th class="px-2 py-1 text-left">Conversions</th>
          <th class="px-2 py-1 text-left">Orders</th>
          <th class="px-2 py-1 text-left">Sales (AUD)</th>
          <th class="px-2 py-1 text-left">Payouts (AUD)</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");
    affiliates.forEach((a) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td class="border-t px-2 py-1">${a.businessName || a.name || a.email || a.uid}</td>
        <td class="border-t px-2 py-1">${a.clicks || 0}</td>
        <td class="border-t px-2 py-1">${a.conversions || 0}</td>
        <td class="border-t px-2 py-1">${a.orderCount || 0}</td>
        <td class="border-t px-2 py-1">$${(a.totalSales || 0).toFixed(2)}</td>
        <td class="border-t px-2 py-1">$${(a.totalPayouts || 0).toFixed(2)}</td>
      `;
      tbody.appendChild(row);
    });

    container.innerHTML = "";
    container.appendChild(table);
  } catch (err) {
    console.error("Failed to load affiliate stats:", err);
    container.innerHTML = "<p class='text-red-500'>Error loading stats.</p>";
  }
}
