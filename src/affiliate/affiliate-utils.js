// affiliate-utils.js – Shared affiliate utilities

import { formatDateTime } from "../utils/date-utils.js"; // ✅ Ensure this import exists

export function generateSlug(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

export function validateSlug(slug) {
  return /^[a-z0-9-]+$/.test(slug);
}

/**
 * Convert payouts to CSV + trigger download
 * @param {Array} payoutsCache - Array of payout objects to export
 */
export function exportPayoutsToCSV(payoutsCache = []) {
  if (!Array.isArray(payoutsCache) || payoutsCache.length === 0) return;

  const headers = ["Amount", "Date", "Stripe Payout ID"];
  const rows = payoutsCache.map((p) => [
    p.amount || 0,
    formatDateTime(p.createdAt),
    p.stripePayoutId || "",
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "affiliate_payouts.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
