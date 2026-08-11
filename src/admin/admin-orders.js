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
const AFFILIATE_PICKUP_STEPS = [
  { value: "new", label: "New" },
  { value: "packing", label: "Packing" },
  { value: "packed", label: "Packed" },
  { value: "shipped_to_affiliate", label: "Sent to affiliate" },
  { value: "ready_for_pickup", label: "Ready for pickup" },
  { value: "completed", label: "Collected / completed" },
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
  if (status === "not_required") return "not_required";
  if (status === "paid" || status === "pending" || status === "approved") return "new";
  if (status === "complete") return "completed";
  if ([...FULFILMENT_STEPS, ...AFFILIATE_PICKUP_STEPS]
    .some((step) => step.value === status)) return status;
  return "new";
}

function orderHasPhysicalItems(order) {
  if (typeof order.hasPhysicalItems === "boolean") return order.hasPhysicalItems;
  return orderItems(order).some((item) =>
    item.requiresShipping === true ||
    ["shipping", "pickup", "shipping-or-pickup"].includes(String(item.physicalFulfilment || "").toLowerCase()));
}

function orderHasDigitalAccess(order) {
  if (order.accessStatus === "granted") return true;
  return orderItems(order).some((item) =>
    item.accessGranted === true ||
    item.unlocksAccess === true ||
    (Array.isArray(item.accessTargets) && item.accessTargets.length > 0) ||
    (Array.isArray(item.accessGrants) && item.accessGrants.length > 0));
}

function orderFulfilmentType(order) {
  const physical = orderHasPhysicalItems(order);
  const digital = orderHasDigitalAccess(order);
  if (physical && digital) return "hybrid";
  if (digital) return "digital";
  return "physical";
}

function isWorkshopItem(item = {}) {
  const type = String(item.productType || item.type || "").toLowerCase();
  const accessTargets = item.accessTargets || item.accessGrants || [];
  return type.includes("workshop") ||
    Boolean(item.relatedWorkshopId || item.eventStartAt) ||
    accessTargets.some((target) =>
      String(target.accessEntityType || target.accessType || "").toLowerCase() === "workshop");
}

function isWorkshopOnlyOrder(order) {
  const items = Array.isArray(order.products) && order.products.length
    ? order.products
    : orderItems(order);
  return items.length > 0 && !orderHasPhysicalItems(order) && items.every(isWorkshopItem);
}

function isRefunded(order) {
  return String(order.refundStatus || order.paymentStatus || "").toLowerCase() === "refunded";
}

function refundStatusLabel(order) {
  const status = String(order.refundStatus || order.paymentStatus || "").toLowerCase();
  if (status === "refunded") return "refunded";
  if (status === "partially_refunded" || Number(order.refundedAmount || 0) > 0) {
    return "partially refunded";
  }
  if (["pending", "refund_pending"].includes(status)) return "refund pending";
  return "";
}

function hasPendingRefund(order) {
  return ["pending", "refund_pending"].includes(
    String(order.refundStatus || order.paymentStatus || "").toLowerCase(),
  );
}

function refundWorkflowComplete(order) {
  return isRefunded(order) && customerFollowUpStatus(order) === "resolved";
}

function refundButtonLabel(order) {
  const amount = Number(order.refundedAmount || order.total || 0).toFixed(2);
  if (hasPendingRefund(order)) return `Refund pending ($${amount})`;
  if (isRefunded(order)) return "Finish refund record";
  return `Refund full order ($${amount})`;
}

function accessEmailStatus(order) {
  if (order.confirmationEmailSentAt) return "Sent";
  if (order.confirmationEmailSandboxedAt) return "Sandboxed locally";
  if (order.confirmationEmailError) return `Failed: ${order.confirmationEmailError}`;
  return "Not sent";
}

function digitalAccessDescription(revoked) {
  return revoked
    ? "The customer can no longer open this Workshop from their profile."
    : "The customer can open unlocked courses, workshops, and programs from their profile.";
}

function digitalAccessStatusLabel(revoked, partiallyRevoked) {
  if (revoked) return "Access revoked after refund";
  if (partiallyRevoked) return "Some access revoked after refund";
  return "Access granted";
}

function currentDigitalAccessDescription(revoked, partiallyRevoked) {
  if (partiallyRevoked) {
    return "Access for fully refunded digital, Course, or Workshop items has been removed. " +
      "Other purchased access remains active.";
  }
  return digitalAccessDescription(revoked);
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
  const options = isWorkshopOnlyOrder(order)
    ? [
      ...CUSTOMER_FOLLOW_UP_OPTIONS.slice(0, -1),
      { value: "workshop_cancellation", label: "Workshop cancellation" },
      CUSTOMER_FOLLOW_UP_OPTIONS.at(-1),
    ]
    : CUSTOMER_FOLLOW_UP_OPTIONS;
  return options.map((option) => `
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
  const fulfilment = item.physicalFulfilment === "pickup"
    ? "Pickup"
    : item.physicalFulfilment === "shipping"
      ? "Shipping"
      : "";
  return [
    variant ? `Variant: ${variant}` : "",
    item.sku ? `SKU: ${item.sku}` : "",
    fulfilment ? `Fulfilment: ${fulfilment}` : "",
    item.pickupLocation?.businessName
      ? `Pickup business: ${item.pickupLocation.businessName}`
      : "",
    item.pickupLocation?.locationName ? `Pickup location: ${item.pickupLocation.locationName}` : "",
    item.pickupLocation?.address ? item.pickupLocation.address : "",
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

function itemRefundedQuantity(item) {
  return Math.max(Number(item.refundedQuantity || 0), 0);
}

function itemRefundableQuantity(item) {
  return Math.max(itemQuantity(item) - itemRefundedQuantity(item), 0);
}

function orderShippingAmount(order) {
  const value = Number(order.shipping?.amount_total ?? order.shippingAmount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function renderRefundableItem(order, item, index) {
  const number = Number(item.lineNumber || index + 1);
  const available = itemRefundableQuantity(item);
  const options = Array.from(
    { length: available },
    (_, option) => `<option value="${option + 1}">${option + 1}</option>`,
  ).join("");
  const remainingAmount = Math.max(itemLineTotal(item) - Number(item.refundedAmount || 0), 0);
  const estimatedUnitRefund = remainingAmount / available;
  return `
    <div class="rounded border border-gray-700 bg-gray-900/70 p-2">
      <label class="flex items-start gap-2">
        <input type="checkbox" class="itemRefundCheckbox mt-1" data-id="${order.id}"
          data-line="${number}" data-unit-price="${estimatedUnitRefund}"
          data-available="${available}" data-remaining-amount="${remainingAmount}" />
        <span class="min-w-0 flex-1">
          <span class="block font-medium text-white">${escapeHTML(itemName(item))}</span>
          ${itemVariantName(item) || itemVariantId(item) ? `
            <span class="block text-xs font-medium text-purple-200">
              Variant: ${escapeHTML(itemVariantName(item) || itemVariantId(item))}
            </span>` : ""}
          ${item.sku ? `<span class="block text-xs text-gray-400">SKU: ${escapeHTML(item.sku)}</span>` : ""}
          <span class="block text-xs text-gray-400">
            $${estimatedUnitRefund.toFixed(2)} each &middot; ${available} refundable
          </span>
        </span>
        <select class="itemRefundQuantity rounded border border-gray-700 bg-gray-900 px-2 py-1 text-white"
          data-id="${order.id}" data-line="${number}" disabled>${options}</select>
      </label>
    </div>`;
}

function renderItemRefundPanel(order) {
  const items = orderItems(order);
  const refundableItems = items.map((item, index) => ({ item, index }))
    .filter(({ item }) => itemRefundableQuantity(item) > 0);
  const shippingRemaining = Math.max(
    orderShippingAmount(order) - Number(order.refundedShippingAmount || 0),
    0,
  );
  const remaining = Math.max(Number(order.total || 0) - Number(order.refundedAmount || 0), 0);
  if ((!refundableItems.length && shippingRemaining <= 0) || remaining <= 0) return "";

  return `
    <details class="itemRefundPanel rounded border border-purple-500/60 bg-purple-950/20 p-3 text-sm" data-id="${order.id}">
      <summary class="cursor-pointer font-semibold text-purple-200">Refund selected items</summary>
      <p class="mt-2 text-xs text-gray-300">
        Select products and quantities. Digital, Course, and Workshop access is revoked when its complete order line is refunded. Physical stock is not automatically returned to inventory.
      </p>
      <div class="mt-3 space-y-2">
        ${refundableItems.map(({ item, index }) => renderRefundableItem(order, item, index)).join("")}
        ${shippingRemaining > 0 ? `
          <label class="flex items-center gap-2 rounded border border-gray-700 bg-gray-900/70 p-2">
            <input type="checkbox" class="shippingRefundCheckbox" data-id="${order.id}" data-amount="${shippingRemaining}" />
            <span class="flex-1 text-white">Refund shipping</span>
            <span class="text-gray-300">$${shippingRemaining.toFixed(2)}</span>
          </label>` : ""}
      </div>
      <div class="mt-3 flex items-center justify-between rounded bg-gray-900 px-3 py-2">
        <span class="text-gray-300">Calculated refund</span>
        <strong class="itemRefundTotal text-purple-200" data-id="${order.id}">$0.00</strong>
      </div>
      <label class="mt-3 block text-xs text-gray-300">
        Refund reason
        <input type="text" class="itemRefundReason mt-1 w-full rounded border border-purple-500/60 bg-gray-900 px-2 py-2 text-white" data-id="${order.id}" placeholder="Reason shown in the timeline and refund email" />
      </label>
      <button type="button" class="refund-selected-items-btn mt-3 w-full rounded bg-purple-700 px-3 py-2 font-semibold text-white hover:bg-purple-600 disabled:bg-gray-700" data-id="${order.id}" disabled>
        Refund selected items
      </button>
      <p class="itemRefundStatus mt-2 hidden text-xs" data-id="${order.id}" role="status"></p>
    </details>`;
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
            ${itemRefundedQuantity(item) > 0 ? `<span class="mt-1 inline-block rounded bg-purple-900/70 px-2 py-0.5 text-purple-200">Refunded ${itemRefundedQuantity(item)} of ${itemQuantity(item)}</span>` : ""}
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
  const steps = orderItems(order).some((item) =>
    item.physicalFulfilment === "pickup" &&
    item.pickupLocation?.sourceType === "affiliate")
    ? AFFILIATE_PICKUP_STEPS
    : FULFILMENT_STEPS;
  const currentIndex = steps.findIndex((step) => step.value === current);

  return steps.map((step, index) => {
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
    const fulfilmentType = orderFulfilmentType(data);
    const hasPhysicalFulfilment = fulfilmentType !== "digital";
    const hasDigitalAccess = fulfilmentType !== "physical";
    const accessRevoked = ["revoked", "removed", "cancelled", "canceled"].includes(
      String(data.accessStatus || "").toLowerCase(),
    ) || isRefunded(data);
    const accessPartiallyRevoked = String(data.accessStatus || "").toLowerCase() === "partially_revoked";
    const orderStatusLabel = data.archived === true
      ? "archived"
      : fulfilmentType === "digital" ? "digital access" : fulfilmentStatus;
    const accessEmailButtonLabel = data.confirmationEmailSentAt || data.confirmationEmailSandboxedAt
      ? "Resend access email"
      : "Send access email";
    const fulfilmentDestinationName = escapeHTML(
      data.fulfilmentDestination?.businessName ||
      data.fulfilmentDestination?.locationName ||
      "Affiliate pickup location",
    );
    const fulfilmentDestinationPhone = data.fulfilmentDestination?.contactPhone
      ? `<div class="text-gray-400">${escapeHTML(data.fulfilmentDestination.contactPhone)}</div>`
      : "";
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
          <div class="flex flex-col items-end gap-1">
            ${refundStatusLabel(data) ? `
              <span class="rounded bg-purple-900/80 px-2 py-1 text-xs uppercase tracking-wide text-purple-100">
                ${escapeHTML(refundStatusLabel(data))}
              </span>` : ""}
            <span class="rounded bg-gray-700 px-2 py-1 text-xs uppercase tracking-wide">
              ${escapeHTML(orderStatusLabel)}
            </span>
          </div>
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
          ${data.referredBy ? `
            <div class="mt-3 border-t border-gray-700 pt-3 text-sm">
              <strong>Affiliate:</strong>
              ${escapeHTML(data.affiliateBusinessName || data.affiliateId || data.referredBy)}
            </div>
          ` : ""}
        </div>
        ${hasDigitalAccess ? `
          <section class="rounded border border-purple-500/60 bg-purple-950/20 p-3 text-sm">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="text-xs uppercase tracking-wide text-purple-200">Digital access</div>
                <div class="mt-1 font-semibold ${accessRevoked ? "text-purple-200" : "text-white"}">
                  ${digitalAccessStatusLabel(accessRevoked, accessPartiallyRevoked)}
                </div>
                <div class="mt-1 text-xs text-gray-300">
                  ${accessRevoked ? "Original access email" : "Access email"}:
                  ${escapeHTML(accessEmailStatus(data))}
                </div>
              </div>
              ${accessRevoked ? `
                <span class="rounded bg-gray-700 px-3 py-2 text-xs font-semibold text-gray-200">
                  Revoked
                </span>
              ` : `
                <button
                  type="button"
                  class="send-access-email-btn rounded bg-purple-700 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-600"
                  data-id="${data.id}"
                >
                  ${accessEmailButtonLabel}
                </button>
              `}
            </div>
            <p class="mt-2 text-xs text-gray-400">
              ${currentDigitalAccessDescription(accessRevoked, accessPartiallyRevoked)}
            </p>
          </section>
        ` : ""}
        ${hasPhysicalFulfilment && data.fulfilmentDestination?.type === "affiliate_pickup" ? `
          <div class="rounded border border-[#407471] bg-gray-900/60 p-3 text-sm">
            <div class="text-xs uppercase tracking-wide text-gray-400 mb-1">
              Ship replacement stock to
            </div>
            <div class="font-semibold">
              ${fulfilmentDestinationName}
            </div>
            <div class="text-gray-300">${escapeHTML(data.fulfilmentDestination.address || "")}</div>
            ${fulfilmentDestinationPhone}
          </div>
        ` : ""}

        ${hasPhysicalFulfilment ? `<div class="flex flex-wrap gap-3 border-y border-gray-700 py-3">
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
        ` : ""}

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
          placeholder="${hasPhysicalFulfilment ? "Packing notes..." : "Order or access notes..."}"
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

        ${hasPhysicalFulfilment ? `<button
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
        ` : `<button
          type="button"
          class="save-digital-order-btn w-full bg-[#407471] hover:bg-[#305a56] text-white px-3 py-2 rounded"
          data-id="${data.id}"
        >
          Save order notes
        </button>`}

        ${isWorkshopOnlyOrder(data) && Number(data.refundedAmount || 0) === 0 ? `
          <section
            class="workshopCancellationPanel rounded border border-purple-500/60 bg-purple-950/20 p-3 text-sm ${customerFollowUpStatus(data) === "workshop_cancellation" ? "" : "hidden"}"
            data-id="${data.id}"
          >
            <div class="text-xs uppercase tracking-wide text-purple-200">Workshop cancellation</div>
            <p class="mt-1 text-xs text-gray-300">
              Refunds the full order through Stripe, removes workshop access, and removes this booking from the active attendee count.
            </p>
            <label class="mt-3 block text-xs text-gray-300">
              Refund reason
              <input
                type="text"
                class="workshopRefundReasonInput mt-1 w-full rounded border border-purple-500/60 bg-gray-900 px-2 py-2 text-white"
                data-id="${data.id}"
                value="${escapeHTML(data.refundReason || "Workshop cancelled")}"
                ${hasPendingRefund(data) ? "disabled" : ""}
              />
            </label>
            <button
              type="button"
              class="refund-workshop-order-btn mt-3 w-full rounded px-3 py-2 font-semibold text-white ${hasPendingRefund(data) ? "bg-gray-700" : "bg-purple-700 hover:bg-purple-600"}"
              data-id="${data.id}"
              ${hasPendingRefund(data) ? "disabled" : ""}
            >
              ${refundButtonLabel(data)}
            </button>
            <p class="workshopRefundStatus mt-2 hidden text-xs" data-id="${data.id}" role="status"></p>
          </section>
        ` : ""}

        ${isWorkshopOnlyOrder(data) && isRefunded(data) ? `
          <section class="rounded border border-purple-500/60 bg-purple-950/20 p-3 text-sm">
            <div class="font-semibold text-purple-200">
              Refunded $${Number(data.refundedAmount || data.total || 0).toFixed(2)}
            </div>
            <p class="mt-1 text-xs text-gray-300">
              ${escapeHTML(data.refundReason || "Workshop booking cancelled")}
            </p>
            <button
              type="button"
              class="resend-refund-email-btn mt-3 w-full rounded bg-purple-700 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-600"
              data-id="${data.id}"
            >
              Resend refund email
            </button>
          </section>
        ` : ""}

        ${renderItemRefundPanel(data)}

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
      const cancellationPanel = document.querySelector(
        `.workshopCancellationPanel[data-id='${orderId}']`,
      );
      const hidden = select.value === "none";
      details?.classList.toggle("hidden", hidden);
      const resolved = select.value === "resolved";
      submission?.classList.toggle("border-green-700/70", resolved);
      submission?.classList.toggle("bg-green-950/20", resolved);
      submission?.classList.toggle("border-amber-700/70", !resolved);
      submission?.classList.toggle("bg-amber-950/20", !resolved);
      heading?.classList.toggle("text-green-200", resolved);
      heading?.classList.toggle("text-amber-200", !resolved);
      cancellationPanel?.classList.toggle("hidden", select.value !== "workshop_cancellation");
    });
  });

  document.querySelectorAll(".print-packing-slip-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const order = orders.find((entry) => entry.id === button.dataset.id);
      if (order) await printPackingSlip(order, button);
    });
  });

  document.querySelectorAll(".send-access-email-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const order = orders.find((entry) => entry.id === button.dataset.id);
      if (!order) return;
      try {
        button.disabled = true;
        button.textContent = "Sending...";
        const sendEmail = httpsCallable(functions, "sendOrderEmailWithPDF");
        const result = await sendEmail({
          to: orderEmail(order),
          invoiceId: orderInvoiceId(order),
          userName: orderName(order),
        });
        showToast(
          result.data?.sandboxed ? "Access email sandboxed locally" : "Access email sent",
          "success",
        );
        await loadAllOrdersForAdmin();
      } catch (err) {
        console.error("Failed to send access email:", err);
        showToast(err.message || "Could not send the access email", "error");
      } finally {
        button.disabled = false;
        button.textContent = "Resend access email";
      }
    });
  });

  function updateItemRefundTotal(orderId) {
    let total = 0;
    document.querySelectorAll(`.itemRefundCheckbox[data-id='${orderId}']:checked`).forEach((checkbox) => {
      const quantityInput = document.querySelector(
        `.itemRefundQuantity[data-id='${orderId}'][data-line='${checkbox.dataset.line}']`,
      );
      const selectedQuantity = Number(quantityInput?.value || 0);
      total += selectedQuantity === Number(checkbox.dataset.available || 0)
        ? Number(checkbox.dataset.remainingAmount || 0)
        : Number(checkbox.dataset.unitPrice || 0) * selectedQuantity;
    });
    const shipping = document.querySelector(`.shippingRefundCheckbox[data-id='${orderId}']:checked`);
    total += Number(shipping?.dataset.amount || 0);
    const totalNode = document.querySelector(`.itemRefundTotal[data-id='${orderId}']`);
    const button = document.querySelector(`.refund-selected-items-btn[data-id='${orderId}']`);
    if (totalNode) totalNode.textContent = `$${total.toFixed(2)}`;
    if (button) {
      button.disabled = total <= 0;
      button.dataset.amount = total.toFixed(2);
    }
  }

  document.querySelectorAll(".itemRefundCheckbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const quantityInput = document.querySelector(
        `.itemRefundQuantity[data-id='${checkbox.dataset.id}'][data-line='${checkbox.dataset.line}']`,
      );
      if (quantityInput) quantityInput.disabled = !checkbox.checked;
      updateItemRefundTotal(checkbox.dataset.id);
    });
  });
  document.querySelectorAll(".itemRefundQuantity, .shippingRefundCheckbox").forEach((input) => {
    input.addEventListener("change", () => updateItemRefundTotal(input.dataset.id));
  });
  document.querySelectorAll(".refund-selected-items-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const order = orders.find((entry) => entry.id === button.dataset.id);
      if (!order) return;
      const reasonInput = document.querySelector(`.itemRefundReason[data-id='${order.id}']`);
      const status = document.querySelector(`.itemRefundStatus[data-id='${order.id}']`);
      const reason = String(reasonInput?.value || "").trim();
      const selectedLines = [...document.querySelectorAll(
        `.itemRefundCheckbox[data-id='${order.id}']:checked`,
      )].map((checkbox) => ({
        lineNumber: Number(checkbox.dataset.line),
        quantity: Number(document.querySelector(
          `.itemRefundQuantity[data-id='${order.id}'][data-line='${checkbox.dataset.line}']`,
        )?.value || 0),
      }));
      const refundShipping = Boolean(document.querySelector(
        `.shippingRefundCheckbox[data-id='${order.id}']:checked`,
      ));
      const amount = Number(button.dataset.amount || 0);
      if (!reason) {
        status?.classList.remove("hidden", "text-green-300");
        status?.classList.add("text-red-300");
        if (status) status.textContent = "Enter a refund reason first.";
        reasonInput?.focus();
        return;
      }
      if (!amount || (!selectedLines.length && !refundShipping)) return;
      if (!window.confirm(`Refund the selected parts of order ${orderInvoiceId(order)}?\n\nCalculated refund: $${amount.toFixed(2)}\n\nStripe will be charged immediately. This cannot be undone here.`)) return;
      try {
        button.disabled = true;
        button.textContent = "Submitting refund...";
        status?.classList.remove("hidden", "text-red-300", "text-green-300");
        status?.classList.add("text-purple-200");
        if (status) status.textContent = "Validating the selection with Stripe...";
        const refundItems = httpsCallable(functions, "refundOrderItems");
        const result = await refundItems({ orderId: order.id, reason, lines: selectedLines,
          refundShipping, confirmation: "REFUND" });
        showToast(result.data?.emailWarning || `Refunded $${Number(result.data?.amount || amount).toFixed(2)}`,
          result.data?.emailWarning ? "warning" : "success");
        await loadAllOrdersForAdmin();
      } catch (err) {
        console.error("Failed to refund selected order items:", err);
        const message = err.message || "Could not refund the selected items";
        showToast(message, "error");
        status?.classList.remove("hidden", "text-purple-200", "text-green-300");
        status?.classList.add("text-red-300");
        if (status) status.textContent = message;
        button.disabled = false;
        button.textContent = "Refund selected items";
      }
    });
  });

  document.querySelectorAll(".refund-workshop-order-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const order = orders.find((entry) => entry.id === button.dataset.id);
      if (!order || hasPendingRefund(order) || refundWorkflowComplete(order)) return;
      const amount = Number(order.total || 0).toFixed(2);
      const repairingRefund = isRefunded(order);
      const reasonInput = document.querySelector(
        `.workshopRefundReasonInput[data-id='${order.id}']`,
      );
      const statusMessage = document.querySelector(
        `.workshopRefundStatus[data-id='${order.id}']`,
      );
      const reason = String(reasonInput?.value || order.refundReason || "").trim();
      if (!reason) {
        statusMessage?.classList.remove("hidden", "text-green-300");
        statusMessage?.classList.add("text-red-300");
        if (statusMessage) statusMessage.textContent = "Enter a refund reason first.";
        reasonInput?.focus();
        return;
      }
      const confirmed = window.confirm(repairingRefund
        ? `Finish the refund record for order ${orderInvoiceId(order)}?\n\nNo second Stripe refund will be issued.`
        : `Refund $${amount} for order ${orderInvoiceId(order)}?\n\nThis will send the refund to Stripe and remove the customer's workshop access. This cannot be undone here.`);
      if (!confirmed) return;
      try {
        button.disabled = true;
        if (reasonInput) reasonInput.disabled = true;
        button.textContent = "Submitting refund...";
        statusMessage?.classList.remove("hidden", "text-red-300", "text-green-300");
        statusMessage?.classList.add("text-purple-200");
        if (statusMessage) statusMessage.textContent = "Contacting Stripe...";
        const refundOrder = httpsCallable(functions, "refundWorkshopOrder");
        const result = await refundOrder({
          orderId: order.id,
          reason,
          confirmation: "REFUND",
        });
        const warning = result.data?.emailWarning;
        showToast(
          warning || `Refunded $${Number(result.data?.amount || amount).toFixed(2)}`,
          warning ? "warning" : "success",
        );
        await loadAllOrdersForAdmin();
      } catch (err) {
        console.error("Failed to refund workshop order:", err);
        const errorMessage = err.message || "Could not refund this workshop order";
        showToast(errorMessage, "error");
        statusMessage?.classList.remove("hidden", "text-purple-200", "text-green-300");
        statusMessage?.classList.add("text-red-300");
        if (statusMessage) statusMessage.textContent = errorMessage;
        button.disabled = false;
        if (reasonInput) reasonInput.disabled = false;
        button.textContent = `Refund full order ($${amount})`;
      }
    });
  });

  document.querySelectorAll(".resend-refund-email-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const order = orders.find((entry) => entry.id === button.dataset.id);
      if (!order || !isRefunded(order)) return;
      try {
        button.disabled = true;
        button.textContent = "Sending...";
        const refundOrder = httpsCallable(functions, "refundWorkshopOrder");
        const result = await refundOrder({
          orderId: order.id,
          reason: order.refundReason || "Workshop cancelled",
          confirmation: "REFUND",
        });
        showToast(
          result.data?.emailWarning || "Refund email sent",
          result.data?.emailWarning ? "warning" : "success",
        );
      } catch (err) {
        console.error("Failed to resend refund email:", err);
        showToast(err.message || "Could not resend the refund email", "error");
      } finally {
        button.disabled = false;
        button.textContent = "Resend refund email";
      }
    });
  });

  document.querySelectorAll(".save-digital-order-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      await saveOrderNote(button.dataset.id);
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
  const customerFollowUpStatus =
    document.querySelector(`.customerFollowUpInput[data-id='${orderId}']`)?.value || "none";
  const customerFollowUpNotes =
    document.querySelector(`.customerFollowUpNotesInput[data-id='${orderId}']`)?.value.trim() || "";
  const customerFollowUpResolution =
    document.querySelector(`.customerFollowUpResolutionInput[data-id='${orderId}']`)?.value.trim() || "";

  try {
    await updateDoc(doc(db, "orders", orderId), {
      note,
      dueDate: dueDate || null,
      customerFollowUpStatus,
      customerFollowUpOpen: [
        "return_requested",
        "exchange_requested",
        "complaint_open",
        "workshop_cancellation",
      ].includes(customerFollowUpStatus),
      customerFollowUpNotes,
      customerFollowUpResolution,
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
