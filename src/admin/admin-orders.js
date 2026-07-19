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

const CUSTOMER_FOLLOW_UP_OPTIONS = [
  { value: "none", label: "No customer issue" },
  { value: "return_requested", label: "Return requested" },
  { value: "exchange_requested", label: "Swap requested" },
  { value: "complaint_open", label: "Complaint open" },
  { value: "resolved", label: "Resolved" },
];

const FIELD_CLASS = "mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white";

const urlParams = new URLSearchParams(window.location.search);
const filterOrderId = urlParams.get("filter");
const filterRef = urlParams.get("ref");
const filterIssues = urlParams.get("issues");

let allOrders = [];
let showArchivedOrders = false;
let showOpenIssuesOnly = filterIssues === "open";

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

function customerIssueTypeLabel(type) {
  return ({
    feedback: "Order feedback",
    return_requested: "Return requested",
    exchange_requested: "Replacement or swap",
    damaged_item: "Damaged item",
    complaint_open: "Complaint",
  })[type] || String(type || "Customer issue").replace(/_/g, " ");
}

function renderCustomerIssueDetails(order) {
  const issue = order.latestCustomerIssue;
  const status = customerFollowUpStatus(order);
  const resolved = status === "resolved";
  const panelClass = resolved
    ? "border-green-700/70 bg-green-950/20"
    : "border-amber-700/70 bg-amber-950/20";
  const headingClass = resolved ? "text-green-200" : "text-amber-200";
  return `
    <div
      class="customerIssueSubmission rounded border p-3 text-xs text-gray-200 ${panelClass}"
      data-id="${order.id}"
    >
      <div class="customerIssueSubmissionHeading font-semibold ${headingClass}">
        Latest customer submission: ${escapeHTML(customerIssueTypeLabel(issue?.issueType))}
      </div>
      <div class="mt-2 grid gap-2 sm:grid-cols-2">
        <div><strong>Affected items:</strong> ${escapeHTML(issue?.affectedItems || "Not specified")}</div>
        <div><strong>Preferred outcome:</strong> ${escapeHTML(issue?.preferredOutcome || "Not specified")}</div>
        <div><strong>Customer:</strong> ${escapeHTML(issue?.customerName || issue?.customerEmail || "Unknown")}</div>
      </div>
      <div class="mt-2 whitespace-pre-wrap">
        <strong>Customer message:</strong> ${escapeHTML(issue?.details || "No message supplied")}
      </div>
      <label class="mt-3 block text-xs text-gray-300">
        Return / complaint notes
        <textarea
          class="customerFollowUpNotesInput ${FIELD_CLASS}"
          data-id="${order.id}"
          placeholder="Customer issue, requested outcome, item condition, next step..."
        >${escapeHTML(order.customerFollowUpNotes || "")}</textarea>
      </label>
    </div>

    <label class="block text-xs text-gray-300">
      Resolution notes
      <textarea
        class="customerFollowUpResolutionInput ${FIELD_CLASS}"
        data-id="${order.id}"
        placeholder="Refund, replacement, swap, complaint outcome..."
      >${escapeHTML(order.customerFollowUpResolution || "")}</textarea>
    </label>
  `;
}

function dateInputValue(value) {
  if (!value) return "";
  let date;
  if (typeof value.toDate === "function") date = value.toDate();
  else if (typeof value.seconds === "number") date = new Date(value.seconds * 1000);
  else if (typeof value._seconds === "number") date = new Date(value._seconds * 1000);
  else date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultOrderDueDate(order) {
  if (order.dueDate) return dateInputValue(order.dueDate) || String(order.dueDate);
  const source = order.purchasedAt || order.orderDate || order.createdAt;
  let date;
  if (source?.toDate) date = source.toDate();
  else if (typeof source?.seconds === "number") date = new Date(source.seconds * 1000);
  else if (typeof source?._seconds === "number") date = new Date(source._seconds * 1000);
  else date = new Date(source);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + 14);
  return dateInputValue(date);
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

function reviewRequestEmailStatus(order) {
  if (order.reviewRequestEmailSentAt) {
    return "sent";
  }
  if (order.reviewRequestEmailSandboxedAt) {
    return "sandboxed locally";
  }
  if (order.reviewRequestEmailError) {
    return `failed: ${escapeHTML(order.reviewRequestEmailError)}`;
  }
  return "not sent";
}

function customerFollowUpStatus(order) {
  return String(order.customerFollowUpStatus || "none").toLowerCase();
}

function renderCustomerFollowUpOptions(order) {
  const current = customerFollowUpStatus(order);
  return CUSTOMER_FOLLOW_UP_OPTIONS.map((option) => `
    <option value="${option.value}" ${current === option.value ? "selected" : ""}>
      ${option.label}
    </option>
  `).join("");
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

function formattedDateTime(timestamp) {
  if (!timestamp) return "-";
  let date = null;
  if (timestamp.toDate) date = timestamp.toDate();
  else if (timestamp.seconds) date = new Date(timestamp.seconds * 1000);
  else if (timestamp._seconds) date = new Date(timestamp._seconds * 1000);
  else date = new Date(timestamp);
  if (!date || Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function orderUpdatedDate(order) {
  return formattedDate(order.updatedAt || order.purchasedAt || order.orderDate || order.createdAt);
}

function orderPurchasedDate(order) {
  return formattedDate(order.purchasedAt || order.orderDate || order.createdAt);
}

function itemName(item) {
  return item.productName || item.name || item.productTitle || item.title ||
    item.description || item.productId || "Item";
}

function itemVariantName(item) {
  return item.variantName || item.productVariantName || "";
}

function itemVariantId(item) {
  return item.productVariantId || item.variantId || "";
}

function itemPackingReference(item) {
  const variant = itemVariantName(item) || itemVariantId(item);
  return [
    variant ? `Variant: ${variant}` : "",
    item.sku ? `SKU: ${item.sku}` : "",
  ].filter(Boolean).join(" | ") || "-";
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
  if (Array.isArray(order.orderLines) && order.orderLines.length) return order.orderLines;
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
            <span class="block">
              <span class="font-medium text-gray-100">${escapeHTML(itemName(item))}</span>
              <span class="text-gray-400">x${itemQuantity(item)}</span>
            </span>
            <span class="block text-gray-300">${escapeHTML(itemPackingReference(item))}</span>
          </span>
          <span class="text-gray-300">$${itemLineTotal(item).toFixed(2)}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function shippingAddressLines(order) {
  const address = order.shippingAddress || order.shipping?.address || {};
  if (typeof address === "string") return [address];
  return [
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code || address.postcode].filter(Boolean).join(" "),
    address.country,
  ].filter(Boolean);
}

function packingSlipHtml(order, values = {}) {
  const items = orderItems(order);
  const recipient = order.shippingName || order.customerName || orderName(order);
  const phone = order.shippingPhone || order.customerPhone || "Not supplied";
  const email = order.shippingEmail || order.customerEmail || orderEmail(order) || "Not supplied";
  const addressLines = shippingAddressLines(order);
  const notes = values.notes || order.adminNotes || order.note || "No packing notes";
  const dueDate = values.dueDate || defaultOrderDueDate(order) || "Not set";
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Packing slip ${escapeHTML(orderInvoiceId(order))}</title>
        <style>
          body { font: 14px Arial, sans-serif; color: #111; margin: 32px; }
          h1 { margin: 0 0 4px; font-size: 24px; }
          h2 { margin: 24px 0 8px; font-size: 16px; border-bottom: 1px solid #bbb; padding-bottom: 4px; }
          .meta { color: #444; line-height: 1.5; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 8px 4px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
          th:last-child, td:last-child { text-align: right; }
          .notes { white-space: pre-wrap; border: 1px solid #bbb; padding: 10px; min-height: 48px; }
          @page { margin: 15mm; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>
        <h1>Packing slip</h1>
        <div class="meta">
          <strong>Order:</strong> ${escapeHTML(orderInvoiceId(order))}<br>
          <strong>Order placed:</strong> ${escapeHTML(orderPurchasedDate(order))}<br>
          <strong>Due date:</strong> ${escapeHTML(dueDate)}
        </div>
        <h2>Recipient</h2>
        <div class="meta">
          <strong>${escapeHTML(recipient)}</strong><br>
          ${addressLines.length
    ? addressLines.map((line) => `${escapeHTML(line)}<br>`).join("")
    : "Address not supplied<br>"}
          <strong>Phone:</strong> ${escapeHTML(phone)}<br>
          <strong>Email:</strong> ${escapeHTML(email)}
        </div>
        <h2>Items</h2>
        <table>
          <thead><tr><th>Item</th><th>SKU / variant</th><th>Quantity</th></tr></thead>
          <tbody>
            ${items.length ? items.map((item) => `
              <tr>
                <td>${escapeHTML(itemName(item))}</td>
                <td>${escapeHTML(itemPackingReference(item))}</td>
                <td>${itemQuantity(item)}</td>
              </tr>
            `).join("") : `<tr><td colspan="3">No line items found.</td></tr>`}
          </tbody>
        </table>
        <h2>Packing notes</h2>
        <div class="notes">${escapeHTML(notes)}</div>
      </body>
    </html>`;
}

function showPackingSlipPreview(order, values, pdfUrl) {
  document.getElementById("packingSlipPreviewModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "packingSlipPreviewModal";
  modal.className = "fixed inset-0 z-[100] flex flex-col bg-black/80 p-4";
  modal.innerHTML = `
    <div class="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 rounded-t bg-gray-900 p-3">
      <h2 class="font-semibold text-white">Packing slip preview</h2>
      <div class="flex flex-wrap gap-2">
        <button type="button" data-packing-print disabled
          class="rounded bg-[#407471] px-3 py-2 text-sm text-white disabled:opacity-50">Print</button>
        <button type="button" data-packing-download
          class="rounded bg-[#407471] px-3 py-2 text-sm text-white">Download PDF</button>
        <button type="button" data-packing-close class="rounded bg-gray-700 px-3 py-2 text-sm text-white">Close</button>
      </div>
    </div>
    <iframe title="Packing slip preview" class="mx-auto min-h-0 w-full max-w-5xl flex-1 rounded-b bg-white"></iframe>
  `;
  document.body.appendChild(modal);

  const frame = modal.querySelector("iframe");
  const printButton = modal.querySelector("[data-packing-print]");
  frame.addEventListener("load", () => {
    printButton.disabled = false;
  }, { once: true });
  frame.srcdoc = packingSlipHtml(order, values);
  printButton?.addEventListener("click", () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  });
  modal.querySelector("[data-packing-download]")?.addEventListener("click", async (event) => {
    const downloadButton = event.currentTarget;
    const originalText = downloadButton.textContent;
    try {
      downloadButton.disabled = true;
      downloadButton.textContent = "Preparing download...";
      const response = await fetch(pdfUrl);
      if (!response.ok) throw new Error("PDF download failed.");
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `packing-slip-${orderInvoiceId(order)}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (err) {
      console.error("Packing slip download failed:", err);
      showToast("Could not download the packing slip PDF.", "error");
    } finally {
      downloadButton.disabled = false;
      downloadButton.textContent = originalText;
    }
  });
  modal.querySelector("[data-packing-close]")?.addEventListener("click", () => modal.remove());
}

async function printPackingSlip(order, button) {
  const orderId = order.id;
  const notes = document.querySelector(`.orderNoteInput[data-id='${orderId}']`)?.value.trim();
  const dueDate = document.querySelector(`.orderDueDateInput[data-id='${orderId}']`)?.value;
  const originalText = button?.textContent;
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Preparing packing slip...";
    }
    const generatePackingSlipPDF = httpsCallable(functions, "generatePackingSlipPDF");
    const result = await generatePackingSlipPDF({
      invoiceId: order.id,
      notes: notes || "",
      dueDate: dueDate || "",
    });
    if (!result.data?.url) throw new Error("Packing slip URL was not returned.");
    showPackingSlipPreview(order, { notes, dueDate }, result.data.url);
  } catch (err) {
    console.error("Packing slip generation failed:", err);
    showToast(err.message || "Could not generate packing slip.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || "View packing slip PDF";
    }
  }
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
    ...orderItems(order).flatMap((item) => [
      itemName(item),
      itemVariantName(item),
      itemVariantId(item),
      item.sku,
    ]),
    trackingValue(order),
  ].join(" ").toLowerCase();
  return haystack.includes(term);
}

function timelineItems(order) {
  return Array.isArray(order.timeline)
    ? [...order.timeline].sort((a, b) => {
      const aTime = a?.at?.seconds || 0;
      const bTime = b?.at?.seconds || 0;
      return bTime - aTime;
    })
    : [];
}

function renderTimeline(order) {
  const items = timelineItems(order).slice(0, 6);
  if (!items.length) {
    return `<p class="text-xs text-gray-400">No timeline entries yet.</p>`;
  }

  return `
    <ol class="space-y-2">
      ${items.map((item) => `
        <li class="border-l border-gray-700 pl-3 text-xs">
          <div class="text-gray-100">${escapeHTML(item.label || item.type || "Update")}</div>
          <div class="text-gray-500">
            ${formattedDateTime(item.at)}
            ${item.byName || item.byEmail ? ` by ${escapeHTML(item.byName || item.byEmail)}` : ""}
          </div>
        </li>
      `).join("")}
    </ol>
  `;
}

function setupOrderProcessHelp() {
  const modal = document.getElementById("orderProcessHelpModal");
  const openBtn = document.getElementById("orderProcessHelpBtn");
  const closeBtn = document.getElementById("orderProcessHelpCloseBtn");
  if (!modal || !openBtn || !closeBtn || modal.dataset.bound === "true") return;

  const openModal = () => {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    closeBtn.focus();
  };

  const closeModal = () => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    openBtn.focus();
  };

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
  });
  modal.dataset.bound = "true";
}

export function setupOrderManagement() {
  setupOrderProcessHelp();
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

  document.getElementById("showArchivedOrdersToggle")?.addEventListener("change", (event) => {
    showArchivedOrders = event.target.checked;
    if (showArchivedOrders && showOpenIssuesOnly) {
      showOpenIssuesOnly = false;
      document.getElementById("openIssuesFilterBtn")?.classList.remove("active");
      showToast("Open issues filter cleared for archived orders.", "info");
    }
    loadAllOrdersForAdmin();
  });

  document.getElementById("openIssuesFilterBtn")?.addEventListener("click", () => {
    showOpenIssuesOnly = !showOpenIssuesOnly;
    document.getElementById("openIssuesFilterBtn")?.classList.toggle("active", showOpenIssuesOnly);
    loadAllOrdersForAdmin();
  });
  document.getElementById("openIssuesFilterBtn")?.classList.toggle("active", showOpenIssuesOnly);

  if (document.getElementById(ORDER_GRID_ID)) loadAllOrdersForAdmin();
}

export async function loadAllOrdersForAdmin() {
  const grid = document.getElementById(ORDER_GRID_ID);
  if (grid) grid.textContent = "Loading orders...";

  try {
    const getAllOrders = httpsCallable(functions, "getAllOrdersForAdmin");
    const result = await getAllOrders({
      referredBy: filterRef || undefined,
      includeArchived: showArchivedOrders,
      issueOnly: showOpenIssuesOnly,
    });
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
    grid.textContent = showOpenIssuesOnly
      ? "No open returns, swaps, or complaints found."
      : "No orders found.";
    return;
  }

  orders.forEach((data) => {
    const fulfilmentStatus = currentFulfilmentStatus(data);
    const div = document.createElement("div");
    div.className = `order-card bg-gray-800 p-4 rounded mb-4 ${formatStatusClass(fulfilmentStatus)}`;
    if (data.archived === true) div.classList.add("opacity-75");
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
            ${escapeHTML(data.archived === true ? "archived" : fulfilmentStatus)}
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
        <div class="text-xs text-gray-400">
          Review/returns email: ${reviewRequestEmailStatus(data)}
        </div>

        <section class="rounded border border-gray-700 bg-gray-900/60 p-3">
          <label class="block text-xs text-gray-300">
            Return / swap / complaint status
            <select
              class="customerFollowUpInput mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white"
              data-id="${data.id}"
            >
              ${renderCustomerFollowUpOptions(data)}
            </select>
          </label>

          <div
            class="customerIssueDetails mt-3 space-y-3 ${customerFollowUpStatus(data) === "none" ? "hidden" : ""}"
            data-id="${data.id}"
          >
            ${renderCustomerIssueDetails(data)}
          </div>
        </section>

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
            value="${escapeHTML(defaultOrderDueDate(data))}"
          />
        </label>

        <button
          class="save-fulfilment-btn w-full bg-[#407471] hover:bg-[#305a56] text-white px-3 py-2 rounded"
          data-id="${data.id}"
        >
          Save fulfilment
        </button>

        <button
          type="button"
          class="print-packing-slip-btn w-full bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded"
          data-id="${data.id}"
        >
          View packing slip PDF
        </button>

        <button
          class="archive-order-btn w-full bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded"
          data-id="${data.id}"
          data-archive="${data.archived === true ? "false" : "true"}"
        >
          ${data.archived === true ? "Unarchive order" : "Archive now"}
        </button>

        <details class="rounded border border-gray-700 bg-gray-900/60 p-3">
          <summary class="cursor-pointer text-xs uppercase tracking-wide text-gray-400">Order timeline</summary>
          <div class="mt-3">${renderTimeline(data)}</div>
        </details>
      </div>
    `;
    grid.appendChild(div);
  });

  document.querySelectorAll(".customerFollowUpInput").forEach((select) => {
    select.addEventListener("change", () => {
      const orderId = select.dataset.id;
      const details = document.querySelector(`.customerIssueDetails[data-id='${orderId}']`);
      const submission = document.querySelector(`.customerIssueSubmission[data-id='${orderId}']`);
      const heading = submission?.querySelector(".customerIssueSubmissionHeading");
      const hidden = select.value === "none";
      details?.classList.toggle("hidden", hidden);
      const resolved = select.value === "resolved";
      submission?.classList.toggle("border-green-700/70", resolved);
      submission?.classList.toggle("bg-green-950/20", resolved);
      submission?.classList.toggle("border-amber-700/70", !resolved);
      submission?.classList.toggle("bg-amber-950/20", !resolved);
      heading?.classList.toggle("text-green-200", resolved);
      heading?.classList.toggle("text-amber-200", !resolved);
    });
  });

  document.querySelectorAll(".print-packing-slip-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const order = orders.find((entry) => entry.id === button.dataset.id);
      if (order) await printPackingSlip(order, button);
    });
  });

  document.querySelectorAll(".save-fulfilment-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = btn.dataset.id;
      const trackingNumber = document.querySelector(`.trackingInput[data-id='${orderId}']`)?.value.trim();
      const shippingCarrier = document.querySelector(`.shippingCarrierInput[data-id='${orderId}']`)?.value.trim();
      const adminNotes = document.querySelector(`.orderNoteInput[data-id='${orderId}']`)?.value.trim();
      const dueDate = document.querySelector(`.orderDueDateInput[data-id='${orderId}']`)?.value;
      const customerFollowUpStatus =
        document.querySelector(`.customerFollowUpInput[data-id='${orderId}']`)?.value || "none";
      const customerFollowUpNotes =
        document.querySelector(`.customerFollowUpNotesInput[data-id='${orderId}']`)?.value.trim();
      const customerFollowUpResolution =
        document.querySelector(`.customerFollowUpResolutionInput[data-id='${orderId}']`)?.value.trim();
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
          customerFollowUpStatus,
          customerFollowUpNotes,
          customerFollowUpResolution,
        });

        if (result.data?.reviewRequestEmailSandboxed) {
          showToast("Order updated and review email sandboxed locally", "success");
        } else if (result.data?.reviewRequestEmailError) {
          showToast(`Order updated, but review email failed: ${result.data.reviewRequestEmailError}`, "error", 6000);
        } else if (result.data?.reviewRequestEmailSent) {
          showToast("Order updated and review email sent", "success");
        } else if (result.data?.trackingEmailSandboxed) {
          showToast("Order updated and tracking email sandboxed locally", "success");
        } else if (result.data?.trackingEmailError) {
          showToast(`Order updated, but email failed: ${result.data.trackingEmailError}`, "error", 6000);
        } else {
          showToast(
            result.data?.trackingEmailSent ? "Order updated and tracking email sent" : "Order updated",
            "success",
          );
        }
        if (showOpenIssuesOnly && customerFollowUpStatus === "resolved") {
          showToast("Resolved order removed from the open issues queue.", "info", 5000);
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

  document.querySelectorAll(".archive-order-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = btn.dataset.id;
      const shouldArchive = btn.dataset.archive === "true";
      const confirmed = confirm(
        shouldArchive
          ? "Archive this order now? It will move out of the active orders view."
          : "Unarchive this order and return it to the active orders view?",
      );
      if (!confirmed) return;

      try {
        btn.disabled = true;
        btn.textContent = shouldArchive ? "Archiving..." : "Unarchiving...";
        const updateArchive = httpsCallable(functions, "updateOrderArchive");
        await updateArchive({
          orderId,
          archived: shouldArchive,
          reason: shouldArchive ? "manual_admin_archive" : "manual_admin_unarchive",
        });
        showToast(shouldArchive ? "Order archived" : "Order unarchived", "success");
        await loadAllOrdersForAdmin();
      } catch (err) {
        console.error("Failed to update archive status:", err);
        showToast(err.message || "Error updating archive status", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = shouldArchive ? "Archive now" : "Unarchive order";
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
  let filteredOrders = allOrders;

  if (normalizedFilter === "open-issues") {
    filteredOrders = allOrders.filter((order) => order.customerFollowUpOpen === true);
  } else if (normalizedFilter !== "all") {
    filteredOrders = allOrders.filter((order) => {
      const fulfilmentStatus = currentFulfilmentStatus(order);
      return (
        fulfilmentStatus === normalizedFilter ||
        String(order.status || "").toLowerCase() === normalizedFilter
      );
    });
  }

  renderOrderGrid(filteredOrders);
}
