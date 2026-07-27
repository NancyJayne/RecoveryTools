// View affiliate performance

import { httpsCallable } from "firebase/functions";
import { functions } from "../utils/firebase-config.js";

const fetchAffiliateStats = httpsCallable(functions, "getAffiliatePerformance");
const managePickupApprovals = httpsCallable(functions, "manageAffiliatePickupApprovals");
const manageAffiliateApplications = httpsCallable(functions, "manageAffiliateApplications");

function formatDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : date.toLocaleString("en-AU", { timeZone: "Australia/Brisbane" });
}

async function updateApplication(affiliateId, action) {
  const notes = document.querySelector(
    `[data-affiliate-decision-notes="${CSS.escape(affiliateId)}"]`,
  )?.value.trim() || "";
  const buttons = document.querySelectorAll(
    `[data-affiliate-application-id="${CSS.escape(affiliateId)}"]`,
  );
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const result = await manageAffiliateApplications({
      action,
      affiliateId,
      decisionNotes: notes,
    });
    if (result.data?.emailSent === false) {
      console.warn("Affiliate status changed, but the decision email was not sent.");
    }
    await renderAffiliateApplications();
  } catch (error) {
    console.error(`Unable to ${action} affiliate application:`, error);
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function detailRow(label, value) {
  const row = document.createElement("p");
  const strong = document.createElement("strong");
  strong.className = "text-gray-200";
  strong.textContent = `${label}: `;
  row.append(strong, document.createTextNode(value || "Not provided"));
  return row;
}

async function renderAffiliateApplications() {
  const container = document.getElementById("affiliateApplicationApprovalContainer");
  if (!container) return;
  container.innerHTML = "<p class='text-gray-400'>Loading affiliate applications...</p>";
  try {
    const response = await manageAffiliateApplications({ action: "list" });
    const applications = response.data?.applications || [];
    container.replaceChildren();
    if (!applications.length) {
      container.innerHTML = "<p class='text-gray-400'>No pending or rejected affiliate applications.</p>";
      return;
    }
    applications.forEach((application) => {
      const card = document.createElement("article");
      card.className = "rounded border border-gray-700 bg-gray-900/50 p-4";
      const header = document.createElement("div");
      header.className = "flex flex-wrap items-start justify-between gap-3";
      const heading = document.createElement("div");
      const title = document.createElement("h3");
      title.className = "font-semibold text-white";
      title.textContent = application.businessName || application.name || application.email;
      const submitted = document.createElement("p");
      submitted.className = "mt-1 text-xs text-gray-400";
      submitted.textContent = `Applied ${formatDate(application.submittedAt)}`;
      heading.append(title, submitted);
      const status = document.createElement("span");
      status.className = application.status === "pending"
        ? "rounded bg-purple-700 px-2 py-1 text-xs uppercase text-white"
        : "rounded bg-amber-800 px-2 py-1 text-xs uppercase text-white";
      status.textContent = application.status;
      header.append(heading, status);

      const body = document.createElement("div");
      body.className = "mt-4 grid gap-2 text-sm text-gray-300 md:grid-cols-2";
      [
        ["Applicant", application.name],
        ["Email", application.email],
        ["Business", application.businessName],
        ["ABN", application.abn],
        ["Phone", application.phone],
        ["Address", application.address],
        ["Website", application.website],
        ["Timezone", application.timezone],
      ].forEach(([label, value]) => body.appendChild(detailRow(label, value)));
      const description = detailRow("Description", application.description);
      description.className = "md:col-span-2";
      body.appendChild(description);

      if (application.logoUrl) {
        const logoLink = document.createElement("a");
        logoLink.href = application.logoUrl;
        logoLink.target = "_blank";
        logoLink.rel = "noopener noreferrer";
        logoLink.className = "mt-3 inline-block text-sm text-green-400 underline";
        logoLink.textContent = "View submitted logo";
        card.append(header, body, logoLink);
      } else {
        card.append(header, body);
      }

      const notes = document.createElement("textarea");
      notes.dataset.affiliateDecisionNotes = application.affiliateId;
      notes.className = "input mt-4 w-full";
      notes.rows = 2;
      notes.placeholder = "Optional decision notes (included in the applicant email)";
      notes.value = application.decisionNotes || "";
      const actions = document.createElement("div");
      actions.className = "mt-3 flex flex-wrap gap-2";
      [
        { action: "approve", label: "Approve application", className: "bg-[#407471]" },
        { action: "reject", label: "Reject application", className: "bg-gray-700" },
      ].forEach((config) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.affiliateApplicationId = application.affiliateId;
        button.className = `rounded px-3 py-2 text-sm text-white ${config.className}`;
        button.textContent = config.label;
        button.addEventListener("click", () =>
          updateApplication(application.affiliateId, config.action));
        actions.appendChild(button);
      });
      card.append(notes, actions);
      container.appendChild(card);
    });
  } catch (error) {
    console.error("Failed to load affiliate applications:", error);
    container.innerHTML = "<p class='text-red-400'>Unable to load affiliate applications.</p>";
  }
}

async function updatePickupApproval(pickupLocationId, action) {
  const button = document.querySelector(
    `[data-pickup-location-id="${CSS.escape(pickupLocationId)}"][data-pickup-action="${action}"]`,
  );
  if (button) button.disabled = true;
  try {
    await managePickupApprovals({ action, pickupLocationId });
    await renderPickupApprovals();
  } catch (error) {
    console.error(`Unable to ${action} pickup address:`, error);
    if (button) button.disabled = false;
  }
}

async function renderPickupApprovals() {
  const container = document.getElementById("affiliatePickupApprovalContainer");
  if (!container) return;
  container.innerHTML = "<p class='text-gray-400'>Loading pickup requests...</p>";
  try {
    const response = await managePickupApprovals({ action: "list" });
    const requests = response.data?.requests || [];
    container.replaceChildren();
    if (!requests.length) {
      container.innerHTML = "<p class='text-gray-400'>No affiliate pickup requests found.</p>";
      return;
    }
    requests.forEach((request) => {
      const card = document.createElement("article");
      card.className = "rounded border border-gray-700 bg-gray-900/50 p-4";
      const header = document.createElement("div");
      header.className = "flex flex-wrap items-start justify-between gap-3";
      const identity = document.createElement("div");
      const business = document.createElement("h3");
      business.className = "font-semibold text-white";
      business.textContent = request.businessName || request.affiliateId || "Affiliate";
      const location = document.createElement("p");
      location.className = "mt-1 text-sm text-gray-300";
      location.textContent = [request.locationName, request.address].filter(Boolean).join(" — ");
      identity.append(business, location);
      const status = document.createElement("span");
      status.className = request.approvalStatus === "pending"
        ? "rounded bg-purple-700 px-2 py-1 text-xs uppercase text-white"
        : "rounded bg-gray-700 px-2 py-1 text-xs uppercase text-white";
      status.textContent = request.approvalStatus || "draft";
      header.append(identity, status);
      const actions = document.createElement("div");
      actions.className = "mt-3 flex flex-wrap gap-2";
      [
        { action: "approve", label: "Approve pickup address", className: "bg-[#407471]" },
        { action: "reject", label: "Reject", className: "bg-gray-700" },
      ].forEach((config) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `rounded px-3 py-2 text-sm text-white ${config.className}`;
        button.dataset.pickupLocationId = request.pickupLocationId;
        button.dataset.pickupAction = config.action;
        button.textContent = config.label;
        button.addEventListener("click", () =>
          updatePickupApproval(request.pickupLocationId, config.action));
        actions.appendChild(button);
      });
      if (request.userId) {
        const crmLink = document.createElement("a");
        crmLink.href = `/admin/crm?uid=${encodeURIComponent(request.userId)}`;
        crmLink.className = "router-link rounded bg-gray-700 px-3 py-2 text-sm text-white";
        crmLink.textContent = "Open in CRM";
        actions.appendChild(crmLink);
      }
      card.append(header, actions);
      container.appendChild(card);
    });
  } catch (error) {
    console.error("Failed to load affiliate pickup approvals:", error);
    container.innerHTML = "<p class='text-red-400'>Unable to load pickup approvals.</p>";
  }
}

export async function setupAffiliateStats() {
  const container = document.getElementById("affiliateStatsContainer");
  if (!container) return;
  container.innerHTML = "<p class='text-gray-400'>Loading affiliates...</p>";
  const refreshButton = document.getElementById("refreshAffiliatePickupApprovals");
  if (refreshButton) refreshButton.onclick = renderPickupApprovals;
  const refreshApplications = document.getElementById("refreshAffiliateApplications");
  if (refreshApplications) refreshApplications.onclick = renderAffiliateApplications;
  await Promise.all([renderAffiliateApplications(), renderPickupApprovals()]);

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
