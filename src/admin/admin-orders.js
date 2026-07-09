// Admin order fulfilment, shipping tracking, notes, and filters.
import { db, functions } from "../utils/firebase-config.js";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { showToast } from "../utils/utils.js";
import { refreshAdminOrderAlertBadge } from "./admin-order-alerts.js";

const ORDER_GRID_ID = "globalOrdersGrid";
const FULFILMENT_STEPS = [
  { value: "new", label: "New" },
  { value: "packing", label: "Packing" },
  { value: "packed", label: "Packed" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "completed", label: "Completed" },
];

const urlParams = new URLSearchParams(window.location.search);
const filterOrderId = urlParams.get("filter");
const filterRef = urlParams.get("ref");

let allOrders = [];

function formatStatusClass(status) {
  return `status-${(status || "unknown").toLowerCase().replace(/\s+/g, "-")}`;
}

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function orderUserId(order) {
  return order.uid || order.userId || order.buyerUid || "";
}

function orderEmail(order) {
  return order.userEmail || order.customerEmail || order.shippingEmail || order.email || "";
}

function orderName(order) {
  return order.userName || order.customerName || order.shippingName || "Unknown";
}

function orderInvoiceId(order) {
  return order.invoiceNumber || order.invoiceId || order.id;
}

function assignedAdmin(order) {
  return order.assignedAdminName || order.assignedAdminEmail || "";
}

function lastUpdatedAdmin(order) {
  return order.lastFulfilmentUpdatedByName || order.lastFulfilmentUpdatedByEmail || assignedAdmin(order);
}

function currentFulfilmentStatus(order) {
  const status = String(order.fulfilmentStatus || order.status || "new").toLowerCase();
  if (status === "paid" || status === "pending" || status === "approved") return "new";
  if (status === "complete") return "completed";
  if (FULFILMENT_STEPS.some((step) => step.value === status)) return status;
  return "new";
}

function trackingValue(order) {
  return order.trackingNumber || order.tracking || order.trackingId || "";
}

function trackingEmailStatus(order) {
  if (order.trackingEmailSentAt) {
    return `sent for ${escapeHTML(order.trackingEmailSentFor || trackingValue(order))}`;
  }
  if (order.trackingEmailSandboxedAt) {
    return `sandboxed locally for ${escapeHTML(order.trackingEmailSandboxedFor || trackingValue(order))}`;
  }
  if (order.trackingEmailError) {
    return `failed: ${escapeHTML(order.trackingEmailError)}`;
  }
  return "not sent";
}

function formattedDate(timestamp) {
  if (!timestamp) return "-";
  if (timestamp.toDate) return timestamp.toDate().toLocaleDateString();
  if (timestamp.seconds) return new Date(timestamp.seconds * 1000).toLocaleDateString();
  if (timestamp._seconds) return new Date(timestamp._seconds * 1000).toLocaleDateString();
  const parsed = new Date(timestamp);
  if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString();
  return "-";
}

function orderUpdatedDate(order) {
  return formattedDate(order.updatedAt || order.purchasedAt || order.orderDate || order.createdAt);
}

function orderPurchasedDate(order) {
  return formattedDate(order.purchasedAt || order.orderDate || order.createdAt);
}

function itemName(item) {
  return item.name || item.productTitle || item.title || item.description || item.productId || "Item";
}

function itemQuantity(item) {
  const quantity = Number(item.quantity || 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function itemLineTotal(item) {
  const total = Number(item.lineTotal ?? item.amount_total ?? item.price ?? item.unitPrice ?? 0);
  return Number.isFinite(total) ? total : 0;
}

function orderItems(order) {
  if (Array.isArray(order.products) && order.products.length) return order.products;
  if (Array.isArray(order.items) && order.items.length) return order.items;
  if (order.itemsSummary) {
    return String(order.itemsSummary)
      .split(";")
      .map((summary) => summary.trim())
      .filter(Boolean)
      .map((summary) => ({ name: summary, quantity: 1 }));
  }
  return [];
}

function renderOrderItems(order) {
  const items = orderItems(order);
  if (!items.length) {
    return `<p class="text-xs text-gray-400">No line items found.</p>`;
  }

  return `
    <ul class="space-y-1">
      ${items.map((item) => `
        <li class="flex items-start justify-between gap-3 text-xs">
          <span>
            <span class="font-medium text-gray-100">${escapeHTML(itemName(item))}</span>
            <span class="text-gray-400">x${itemQuantity(item)}</span>
          </span>
          <span class="text-gray-300">$${itemLineTotal(item).toFixed(2)}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderFulfilmentSteps(order) {
  const current = currentFulfilmentStatus(order);
  const currentIndex = FULFILMENT_STEPS.findIndex((step) => step.value === current);

  return FULFILMENT_STEPS.map((step, index) => {
    const checked = step.value === current ? "checked" : "";
    const completeClass = index <= currentIndex ? "text-green-300" : "text-gray-400";
    return `
      <label class="inline-flex items-center gap-1 text-xs ${completeClass}">
        <input
          type="radio"
          name="fulfilment-${order.id}"
          value="${step.value}"
          class="fulfilment-step"
          data-id="${order.id}"
          ${checked}
        />
        <span>${step.label}</span>
      </label>
    `;
  }).join("");
}

function orderMatchesSearch(order, term) {
  const haystack = [
    order.id,
    orderName(order),
    orderEmail(order),
    order.customerPhone,
    order.shippingPhone,
    ...orderItems(order).map((item) => itemName(item)),
    trackingValue(order),
  ].join(" ").toLowerCase();
  return haystack.includes(term);
}

export function setupOrderManagement() {
  document.getElementById("viewGlobalOrdersBtn")?.addEventListener("click", loadAllOrdersForAdmin);
  document.getElementById("exportOrdersBtn")?.addEventListener("click", () => {
    showToast("Exporting to CSV (not implemented)", "info");
  });
  document.querySelectorAll("#statusFilterBar .filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => updateStatusFilter(btn.dataset.status));
  });

  const clearBtn = document.getElementById("clearFilterBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("filter");
      window.location.href = url.pathname;
    });
  }

  document.getElementById("orderSearchInput")?.addEventListener("input", (event) => {
    const term = event.target.value.toLowerCase().trim();
    renderOrderGrid(term ? allOrders.filter((order) => orderMatchesSearch(order, term)) : allOrders);
  });

  if (document.getElementById(ORDER_GRID_ID)) loadAllOrdersForAdmin();
}

export async function loadAllOrdersForAdmin() {
  const grid = document.getElementById(ORDER_GRID_ID);
  if (grid) grid.textContent = "Loading orders...";

  try {
    const getAllOrders = httpsCallable(functions, "getAllOrdersForAdmin");
    const result = await getAllOrders({ referredBy: filterRef || undefined });
    const rawOrders = Array.isArray(result.data?.orders) ? result.data.orders : [];
    allOrders = await attachUserDetails(rawOrders);
    renderOrderGrid(allOrders);
  } catch (err) {
    console.error("Failed to load admin orders:", err);
    allOrders = [];
    if (grid) grid.textContent = "Failed to load orders.";
    showToast(err.message || "Error loading orders", "error");
  }
}

async function attachUserDetails(orders) {
  const results = await Promise.all(
    orders.map(async (order) => {
      const uid = orderUserId(order);
      if (!uid) {
        return {
          ...order,
          userName: orderName(order),
          userEmail: orderEmail(order),
        };
      }

      try {
        const userDoc = await getDoc(doc(db, "users", uid));
        const userData = userDoc.exists() ? userDoc.data() : {};
        return {
          ...order,
          uid,
          userName: userData.name || orderName(order),
          userEmail: userData.email || orderEmail(order),
        };
      } catch {
        return { ...order, uid, userName: orderName(order), userEmail: orderEmail(order) };
      }
    }),
  );
  return results;
}

export function renderOrderGrid(orders) {
  const grid = document.getElementById(ORDER_GRID_ID);
  if (!grid) return;
  grid.innerHTML = "";

  if (!orders.length) {
    grid.textContent = "No orders found.";
    return;
  }

  orders.forEach((data) => {
    const fulfilmentStatus = currentFulfilmentStatus(data);
    const div = document.createElement("div");
    div.className = `order-card bg-gray-800 p-4 rounded mb-4 ${formatStatusClass(fulfilmentStatus)}`;
    div.setAttribute("data-order-id", data.id);

    if (data.id === filterOrderId) {
      div.classList.add("border", "border-yellow-400");
      setTimeout(() => div.scrollIntoView({ behavior: "smooth", block: "center" }), 200);
    }

    div.innerHTML = `
      <div class="space-y-3">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="font-semibold leading-snug">
              Invoice
              <span class="block text-xs text-gray-300 break-all">${escapeHTML(orderInvoiceId(data))}</span>
            </div>
            <a href="/admin/crm?uid=${escapeHTML(orderUserId(data))}" class="text-blue-400 hover:underline text-sm">
              ${escapeHTML(orderName(data))}
            </a>
            <div class="text-xs text-gray-400">${escapeHTML(orderEmail(data))}</div>
          </div>
          <span class="text-xs uppercase tracking-wide bg-gray-700 px-2 py-1 rounded">
            ${escapeHTML(fulfilmentStatus)}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-2 text-sm">
          <div><strong>Total:</strong> $${Number(data.total || 0).toFixed(2)}</div>
          <div><strong>Ordered:</strong> ${orderPurchasedDate(data)}</div>
          <div><strong>Updated:</strong> ${orderUpdatedDate(data)}</div>
        </div>

        <div class="rounded border border-gray-700 bg-gray-900/60 p-3 text-xs text-gray-300">
          <div><strong>Assigned:</strong> ${escapeHTML(assignedAdmin(data) || "Unassigned")}</div>
          <div><strong>Last updated by:</strong> ${escapeHTML(lastUpdatedAdmin(data) || "-")}</div>
        </div>

        <div class="rounded border border-gray-700 bg-gray-900/60 p-3">
          <div class="text-xs uppercase tracking-wide text-gray-400 mb-2">Items purchased</div>
          ${renderOrderItems(data)}
        </div>

        <div class="flex flex-wrap gap-3 border-y border-gray-700 py-3">
          ${renderFulfilmentSteps(data)}
        </div>

        <label class="block text-xs text-gray-300">
          Carrier
          <input
            class="shippingCarrierInput mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white"
            data-id="${data.id}"
            value="${escapeHTML(data.shippingCarrier || "Australia Post")}"
          />
        </label>

        <label class="block text-xs text-gray-300">
          Tracking number
          <input
            class="trackingInput mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white"
            data-id="${data.id}"
            placeholder="Tracking number"
            value="${escapeHTML(trackingValue(data))}"
          />
        </label>

        <div class="text-xs text-gray-400">
          Tracking email: ${trackingEmailStatus(data)}
        </div>

        <textarea
          class="orderNoteInput w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-sm"
          data-id="${data.id}"
          placeholder="Packing notes..."
        >${escapeHTML(data.adminNotes || data.note || "")}</textarea>

        <label class="block text-xs text-gray-300">
          Due date
          <input
            type="date"
            class="orderDueDateInput mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white"
            data-id="${data.id}"
            value="${escapeHTML(data.dueDate || "")}"
          />
        </label>

        <button
          class="save-fulfilment-btn w-full bg-[#407471] hover:bg-[#305a56] text-white px-3 py-2 rounded"
          data-id="${data.id}"
        >
          Save fulfilment
        </button>
      </div>
    `;
    grid.appendChild(div);
  });

  document.querySelectorAll(".save-fulfilment-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = btn.dataset.id;
      const trackingNumber = document.querySelector(`.trackingInput[data-id='${orderId}']`)?.value.trim();
      const shippingCarrier = document.querySelector(`.shippingCarrierInput[data-id='${orderId}']`)?.value.trim();
      const adminNotes = document.querySelector(`.orderNoteInput[data-id='${orderId}']`)?.value.trim();
      const dueDate = document.querySelector(`.orderDueDateInput[data-id='${orderId}']`)?.value;
      const fulfilmentStatus =
        document.querySelector(`input[name='fulfilment-${orderId}']:checked`)?.value || "new";

      try {
        btn.disabled = true;
        btn.textContent = "Saving...";
        const updateFulfilment = httpsCallable(functions, "updateOrderFulfilment");
        const result = await updateFulfilment({
          orderId,
          fulfilmentStatus,
          trackingNumber,
          shippingCarrier,
          adminNotes,
          dueDate,
        });

        if (result.data?.trackingEmailSandboxed) {
          showToast("Order updated and tracking email sandboxed locally", "success");
        } else if (result.data?.trackingEmailError) {
          showToast(`Order updated, but email failed: ${result.data.trackingEmailError}`, "error", 6000);
        } else {
          showToast(
            result.data?.trackingEmailSent ? "Order updated and tracking email sent" : "Order updated",
            "success",
          );
        }
        await loadAllOrdersForAdmin();
        await refreshAdminOrderAlertBadge();
      } catch (err) {
        console.error("Failed to update fulfilment:", err);
        showToast(err.message || "Error updating order", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Save fulfilment";
      }
    });
  });
}

export async function saveOrderNote(orderId) {
  const note = document.querySelector(`.orderNoteInput[data-id='${orderId}']`)?.value.trim();
  const dueDate = document.querySelector(`.orderDueDateInput[data-id='${orderId}']`)?.value;

  try {
    await updateDoc(doc(db, "orders", orderId), {
      note,
      dueDate: dueDate || null,
      updatedAt: serverTimestamp(),
    });
    showToast("Note saved", "success");
    loadAllOrdersForAdmin();
  } catch (err) {
    console.error("Failed to save note:", err);
    showToast("Error saving note", "error");
  }
}

export function updateStatusFilter(filter) {
  showToast(`Filtering by: ${filter}`, "info");
  const normalizedFilter = String(filter || "All").toLowerCase();
  const filteredOrders = normalizedFilter === "all"
    ? allOrders
    : allOrders.filter((order) => {
      const fulfilmentStatus = currentFulfilmentStatus(order);
      return (
        fulfilmentStatus === normalizedFilter ||
        String(order.status || "").toLowerCase() === normalizedFilter
      );
    });
  renderOrderGrid(filteredOrders);
}
