// affiliate-dashboard.js
import { loadAffiliatePayouts } from "./affiliate-payouts.js";
import { setupStripeButtons } from "./affiliate-stripe.js";
import { renderSubmittedCourses, setupCourseProposalForm } from "./affiliate-courses.js";
import { renderSubmittedWorkshops, setupWorkshopForm } from "./affiliate-workshops.js";
import { exportPayoutsToCSV } from "./affiliate-utils.js";
import { formatDateTime } from "../utils/date-utils.js";
import { db, auth, functions } from "../utils/firebase-config.js";
import { collection, query, where, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { showToast } from "../utils/utils.js";

let payoutsCache = [];
let affiliateSettingsLoaded = false;

function affiliateSetting(id) {
  return document.getElementById(id);
}

async function loadAffiliateBusinessProfile() {
  const uid = auth?.currentUser?.uid;
  if (!uid) return;
  const updateProfile = httpsCallable(functions, "updateAffiliateBusinessProfile");
  const response = await updateProfile({ action: "get" });
  const profile = response.data?.profile || {};
  affiliateSetting("affiliateSettingsBusinessName").value = profile.businessName || "";
  affiliateSetting("affiliateSettingsWebsite").value = profile.website || "";
  affiliateSetting("affiliateSettingsBusinessEmail").value = profile.businessEmail || profile.email || "";
  affiliateSetting("affiliateSettingsBusinessPhone").value = profile.businessPhone || profile.phone || "";
  affiliateSetting("affiliateSettingsBusinessAddress").value = profile.businessAddress || "";
  const enabled = profile.pickupEnabled === true;
  affiliateSetting("affiliateSettingsPickupEnabled").checked = enabled;
  affiliateSetting("affiliateSettingsPickupFields").classList.toggle("hidden", !enabled);
  affiliateSetting("affiliateSettingsPickupStatus").textContent = enabled
    ? `Pickup approval: ${profile.pickupApprovalStatus || "pending"}`
    : "Customer pickup is not enabled.";
  const location = profile.pickupLocation || {};
  affiliateSetting("affiliateSettingsPickupName").value = location.locationName || "";
  affiliateSetting("affiliateSettingsPickupLine1").value = location.addressLine1 || "";
  affiliateSetting("affiliateSettingsPickupLine2").value = location.addressLine2 || "";
  affiliateSetting("affiliateSettingsPickupSuburb").value = location.suburb || "";
  affiliateSetting("affiliateSettingsPickupState").value = location.state || "";
  affiliateSetting("affiliateSettingsPickupPostcode").value = location.postcode || "";
  affiliateSetting("affiliateSettingsPickupCountry").value = location.country || "Australia";
  affiliateSettingsLoaded = true;
}

async function saveAffiliateBusinessProfile(event) {
  event.preventDefault();
  const pickupEnabled = affiliateSetting("affiliateSettingsPickupEnabled").checked;
  try {
    const updateProfile = httpsCallable(functions, "updateAffiliateBusinessProfile");
    const response = await updateProfile({
      businessName: affiliateSetting("affiliateSettingsBusinessName").value.trim(),
      website: affiliateSetting("affiliateSettingsWebsite").value.trim(),
      businessEmail: affiliateSetting("affiliateSettingsBusinessEmail").value.trim(),
      businessPhone: affiliateSetting("affiliateSettingsBusinessPhone").value.trim(),
      businessAddress: affiliateSetting("affiliateSettingsBusinessAddress").value.trim(),
      pickupEnabled,
      locationName: affiliateSetting("affiliateSettingsPickupName").value.trim(),
      pickupLocation: {
        addressLine1: affiliateSetting("affiliateSettingsPickupLine1").value.trim(),
        addressLine2: affiliateSetting("affiliateSettingsPickupLine2").value.trim(),
        suburb: affiliateSetting("affiliateSettingsPickupSuburb").value.trim(),
        state: affiliateSetting("affiliateSettingsPickupState").value.trim(),
        postcode: affiliateSetting("affiliateSettingsPickupPostcode").value.trim(),
        country: affiliateSetting("affiliateSettingsPickupCountry").value.trim(),
      },
    });
    affiliateSetting("affiliateSettingsPickupStatus").textContent = pickupEnabled
      ? `Pickup approval: ${response.data?.pickupApprovalStatus || "pending"}`
      : "Customer pickup is not enabled.";
    showToast(
      pickupEnabled
        ? "Business details saved. Pickup address sent for admin approval."
        : "Business details saved.",
      "success",
    );
  } catch (error) {
    console.error("Unable to save affiliate business profile:", error);
    showToast(error.message || "Unable to save business details.", "error");
  }
}

async function markAffiliateOrderReady(orderId, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const manageOrders = httpsCallable(functions, "manageAffiliatePickupOrders");
    const response = await manageOrders({ action: "ready", orderId });
    const email = response.data?.email || {};
    showToast(
      email.error
        ? "Order marked ready, but the customer email could not be sent."
        : email.sandboxed
          ? "Order marked ready; customer email was sandboxed locally."
          : "Order marked ready and the customer was notified.",
      email.error ? "error" : "success",
    );
    await renderAffiliatePickupOrders();
  } catch (error) {
    console.error("Unable to mark pickup order ready:", error);
    showToast(error.message || "Unable to update pickup order.", "error");
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function renderAffiliatePickupOrders() {
  const container = document.getElementById("affiliatePickupOrdersContainer");
  if (!container) return;
  container.innerHTML = "<p class='text-gray-400'>Loading pickup orders...</p>";
  try {
    const manageOrders = httpsCallable(functions, "manageAffiliatePickupOrders");
    const response = await manageOrders({ action: "list" });
    const orders = response.data?.orders || [];
    container.replaceChildren();
    if (!orders.length) {
      container.innerHTML = "<p class='text-gray-400'>No pickup orders assigned to you.</p>";
      return;
    }
    orders.forEach((order) => {
      const card = document.createElement("article");
      card.className = "rounded border border-gray-700 bg-gray-900/50 p-4";
      const title = document.createElement("h3");
      title.className = "font-semibold text-white";
      title.textContent = `Order ${order.invoiceId}`;
      const customer = document.createElement("p");
      customer.className = "mt-1 text-sm text-gray-300";
      customer.textContent = `Customer: ${order.customerName}`;
      const status = document.createElement("p");
      status.className = "mt-1 text-sm text-gray-300";
      status.textContent = `Status: ${String(order.fulfilmentStatus || "new").replaceAll("_", " ")}`;
      const items = document.createElement("ul");
      items.className = "mt-3 list-disc pl-5 text-sm text-gray-300";
      order.items.forEach((item) => {
        const row = document.createElement("li");
        row.textContent = `${item.quantity} × ${item.name}${item.variantName ? ` — ${item.variantName}` : ""}`;
        items.appendChild(row);
      });
      card.append(title, customer, status, items);
      if (order.trackingNumber) {
        const tracking = document.createElement("p");
        tracking.className = "mt-2 text-xs text-gray-400";
        tracking.textContent = `Incoming stock: ${order.shippingCarrier || "Carrier"} ${order.trackingNumber}`;
        card.appendChild(tracking);
      }
      if (order.fulfilmentStatus === "shipped_to_affiliate") {
        const ready = document.createElement("button");
        ready.type = "button";
        ready.className = "mt-3 rounded bg-[#407471] px-3 py-2 text-sm text-white";
        ready.textContent = "Stock received / ready for pickup";
        ready.addEventListener("click", () => markAffiliateOrderReady(order.id, ready));
        card.appendChild(ready);
      }
      container.appendChild(card);
    });
  } catch (error) {
    console.error("Unable to load affiliate pickup orders:", error);
    container.innerHTML = "<p class='text-red-400'>Unable to load pickup orders.</p>";
  }
}

export function initAffiliateDashboard() {
  const links = [...document.querySelectorAll(".affiliate-link")];
  const availableTabs = new Set(links.map((link) => link.dataset.affiliateTab));

  const showAffiliateTab = async (targetId, updateUrl = true) => {
    if (!availableTabs.has(targetId)) return;

    document.querySelectorAll(".affiliate-tab").forEach((tab) => tab.classList.add("hidden"));
    document.getElementById(targetId)?.classList.remove("hidden");
    links.forEach((link) => {
      const selected = link.dataset.affiliateTab === targetId;
      link.classList.toggle("bg-green-800", selected);
      link.setAttribute("aria-current", selected ? "page" : "false");
    });

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.pathname = "/affiliate";
      url.searchParams.set("panel", targetId);
      url.hash = "";
      history.replaceState({}, "", `${url.pathname}${url.search}`);
    }

    if (targetId === "affiliateEarningsTab") {
      await renderPayouts();
      await renderAffiliateOrders();
    } else if (targetId === "affiliateSettingsTab") {
      await setupStripeButtons();
      if (!affiliateSettingsLoaded) await loadAffiliateBusinessProfile();
    } else if (targetId === "affiliatePickupOrdersTab") {
      await renderAffiliatePickupOrders();
    } else if (targetId === "submitCourseProposalTab") {
      setupCourseProposalForm();
    } else if (targetId === "mySubmittedCoursesTab") {
      renderSubmittedCourses();
    } else if (targetId === "submitWorkshopTab") {
      setupWorkshopForm();
    } else if (targetId === "mySubmittedWorkshopsTab") {
      renderSubmittedWorkshops();
    }
  };

  links.forEach((link) => {
    link.onclick = () => showAffiliateTab(link.dataset.affiliateTab);
  });

  const requestedTab = new URLSearchParams(window.location.search).get("panel");
  void showAffiliateTab(
    availableTabs.has(requestedTab) ? requestedTab : "affiliateEarningsTab",
    false,
  );

  document.getElementById("exportPayoutsBtn")?.addEventListener("click", () => exportPayoutsToCSV(payoutsCache));
  document.getElementById("applyFilterBtn")?.addEventListener("click", applyFilter);
  document.getElementById("filterType")?.addEventListener("change", toggleFilterInputs);
  document.getElementById("affiliateSettingsPickupEnabled")?.addEventListener("change", (event) => {
    document.getElementById("affiliateSettingsPickupFields")
      ?.classList.toggle("hidden", !event.target.checked);
  });
  document.getElementById("affiliateBusinessProfileForm")
    ?.addEventListener("submit", saveAffiliateBusinessProfile);
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

async function renderAffiliateOrders() {
  const uid = auth?.currentUser?.uid;
  if (!uid) return;
  const ordersRef = collection(db, "orders");
  const q = query(ordersRef, where("referredBy", "==", uid));
  const snapshot = await getDocs(q);
  const container = document.getElementById("affiliateOrdersGrid");
  if (!container) return;
  container.innerHTML = "";
  if (snapshot.empty) {
    container.innerHTML = `<p class="text-sm text-gray-400">No orders yet.</p>`;
    return;
  }
  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const div = document.createElement("div");
    div.className = "bg-gray-800 p-4 rounded";
    div.innerHTML = `
      <div><strong>Invoice:</strong> ${docSnap.id}</div>
      <div><strong>Total:</strong> $${(data.total || 0).toFixed(2)}</div>
    `;
    container.appendChild(div);
  });
}

export default initAffiliateDashboard;
