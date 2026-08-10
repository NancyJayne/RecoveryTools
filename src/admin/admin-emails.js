import { db, functions, auth } from "../utils/firebase-config.js";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getUserRole } from "../auth/user-roles.js";
import { showToast } from "../utils/utils.js";

let communications = [];
let activeView = "inbox";
let initialized = false;
let communicationUsers = [];
let communicationOrders = [];
let badgeRefreshTimer = null;

function escapeHTML(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function statusClass(status) {
  return ({
    new: "bg-purple-700 text-white", open: "bg-blue-800 text-blue-100",
    waiting: "bg-yellow-800 text-yellow-100", resolved: "bg-green-800 text-green-100",
    archived: "bg-gray-700 text-gray-200", sent: "bg-green-900/60 text-green-200",
    sandboxed: "bg-blue-900/60 text-blue-200", failed: "bg-red-900/60 text-red-200",
  })[status] || "bg-gray-700 text-gray-200";
}

function typeLabel(type) {
  return String(type || "email").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstInboundBody(communication) {
  return communication.messages?.find((message) => message.direction === "inbound")?.bodyText || "";
}

function userOptionMarkup(selectedUserId) {
  const options = communicationUsers.map((user) => {
    const label = [user.name, user.email].filter(Boolean).join(" - ") || user.id;
    return `<option value="${escapeHTML(user.id)}" ${user.id === selectedUserId ? "selected" : ""}>${escapeHTML(label)}</option>`;
  });
  return ["<option value=\"\">Guest / no linked user</option>", ...options].join("");
}

function orderOptionMarkup(selectedOrderIds = []) {
  const selected = new Set(selectedOrderIds);
  return communicationOrders.map((order) => {
    const customer = [order.customerName, order.customerEmail].filter(Boolean).join(" - ");
    const label = customer ? `${order.id} | ${customer}` : order.id;
    return `<option value="${escapeHTML(order.id)}" ${selected.has(order.id) ? "selected" : ""}>${escapeHTML(label)}</option>`;
  }).join("");
}

function searchable(communication) {
  return [communication.contactName, communication.contactEmail, communication.subject,
    ...(communication.orderIds || []), ...(communication.messages || []).map((message) => message.bodyText)]
    .join(" ").toLowerCase();
}

function filteredCommunications() {
  const term = document.getElementById("communicationSearch")?.value.trim().toLowerCase() || "";
  const status = document.getElementById("communicationStatusFilter")?.value || "active";
  return communications.filter((communication) => {
    if (activeView === "inbox" && !["new", "open", "waiting"].includes(communication.status)) return false;
    if (activeView === "mine" && communication.assignedToUid !== auth.currentUser?.uid) return false;
    if (status === "active" && !["new", "open", "waiting"].includes(communication.status)) return false;
    if (status !== "active" && status !== "all" && communication.status !== status) return false;
    return !term || searchable(communication).includes(term);
  });
}

function messageMarkup(message) {
  const internal = message.internal === true || message.direction === "internal";
  const classes = internal ? "border-yellow-700 bg-yellow-950/30" :
    message.direction === "outbound" ? "border-[#407471] bg-[#17302f]" : "border-gray-700 bg-gray-900";
  const label = internal ? "Internal note" : message.direction === "outbound" ? "Admin reply" : "Customer message";
  return `<article class="rounded border ${classes} p-3">
    <div class="flex flex-wrap justify-between gap-2 text-xs text-gray-400">
      <strong class="text-gray-200">${label}</strong><span>${escapeHTML(formatDate(message.createdAt))}</span>
    </div>
    <div class="mt-2 whitespace-pre-wrap break-words text-sm text-gray-100">${escapeHTML(message.bodyText || "")}</div>
    ${message.deliveryStatus && message.deliveryStatus !== "received" && message.deliveryStatus !== "not_applicable"
    ? `<div class="mt-2 text-xs text-gray-400">Delivery: ${escapeHTML(message.deliveryStatus)}</div>` : ""}
  </article>`;
}

function communicationCard(communication) {
  const preview = firstInboundBody(communication).slice(0, 180);
  const orders = (communication.orderIds || []).join(", ") || "Not linked";
  return `<article class="rounded border ${communication.unreadByAdmin ? "border-purple-500" : "border-gray-700"} bg-gray-800 p-4" data-communication-id="${escapeHTML(communication.id)}">
    <button type="button" data-action="open" class="w-full text-left">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            ${communication.unreadByAdmin ? "<span class=\"h-2.5 w-2.5 rounded-full bg-purple-400\" title=\"Unread\"></span>" : ""}
            <strong class="text-white">${escapeHTML(communication.contactName || "Unknown contact")}</strong>
            <span class="text-xs text-gray-400">${escapeHTML(communication.contactEmail || "")}</span>
          </div>
          <div class="mt-1 text-sm text-gray-300">${escapeHTML(communication.subject || "Contact message")}</div>
          <div class="mt-2 text-sm text-gray-400">${escapeHTML(preview)}${preview.length >= 180 ? "..." : ""}</div>
        </div>
        <div class="text-right"><span class="rounded px-2 py-1 text-xs ${statusClass(communication.status)}">${escapeHTML(communication.status)}</span>
          <div class="mt-2 text-xs text-gray-500">${escapeHTML(formatDate(communication.lastMessageAt))}</div></div>
      </div>
      <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400">
        <span>Assigned: ${escapeHTML(communication.assignedToName || "Unassigned")}</span>
        <span>Orders: ${escapeHTML(orders)}</span><span>User: ${escapeHTML(communication.userId || "Guest/unlinked")}</span>
      </div>
    </button>
    <div data-detail class="mt-4 hidden border-t border-gray-700 pt-4">
      <div class="space-y-3">${(communication.messages || []).map(messageMarkup).join("")}</div>
      <div class="mt-4 grid gap-3 lg:grid-cols-2">
        <label class="text-sm text-gray-300">Status<select data-field="status" class="input mt-1 w-full">
          ${["new", "open", "waiting", "resolved", "archived"].map((status) => `<option value="${status}" ${communication.status === status ? "selected" : ""}>${typeLabel(status)}</option>`).join("")}
        </select></label>
        <label class="text-sm text-gray-300">Linked orders
          <select data-field="orders" class="input mt-1 min-h-28 w-full" multiple>${orderOptionMarkup(communication.orderIds)}</select>
          <span class="mt-1 block text-xs text-gray-500">Hold Ctrl (Windows) or Cmd (Mac) to select more than one.</span>
        </label>
        <label class="text-sm text-gray-300">Linked user
          <select data-field="user" class="input mt-1 w-full">${userOptionMarkup(communication.userId)}</select>
        </label>
        <div class="flex flex-wrap items-end gap-2">
          <button type="button" data-action="save" class="rounded bg-[#407471] px-3 py-2 text-sm text-white">Save details</button>
          <button type="button" data-action="claim" class="rounded bg-gray-700 px-3 py-2 text-sm text-white">Assign to me</button>
          <button type="button" data-action="unassign" class="rounded bg-gray-700 px-3 py-2 text-sm text-white">Unassign</button>
        </div>
      </div>
      <div class="mt-4 grid gap-4 xl:grid-cols-2">
        <form data-form="note" class="rounded border border-gray-700 p-3"><label class="text-sm font-semibold">Internal note<textarea class="input mt-2 min-h-24 w-full" name="body" required></textarea></label><button class="mt-2 rounded bg-gray-700 px-3 py-2 text-sm">Add note</button></form>
        <form data-form="reply" class="rounded border border-[#407471] p-3"><label class="text-sm font-semibold">Reply by email<textarea class="input mt-2 min-h-24 w-full" name="body" required></textarea></label><button class="mt-2 rounded bg-[#407471] px-3 py-2 text-sm">Send reply</button></form>
      </div>
    </div>
  </article>`;
}

function renderCommunications() {
  const list = document.getElementById("communicationList");
  if (!list) return;
  const records = filteredCommunications();
  document.getElementById("communicationResultCount").textContent = `${records.length} communication${records.length === 1 ? "" : "s"}`;
  list.innerHTML = records.length ? records.map(communicationCard).join("") :
    "<div class='rounded border border-gray-700 p-4 text-gray-400'>No communications match these filters.</div>";
}

async function refreshSummary() {
  try {
    const result = await httpsCallable(functions, "getCommunicationSummary")();
    const count = Number(result.data?.unread || 0);
    ["adminCommunicationsMenuBadge", "adminCommunicationAlertBadge"].forEach((id) => {
      const badge = document.getElementById(id);
      if (badge) { badge.textContent = String(count); badge.classList.toggle("hidden", count === 0); }
    });
  } catch (error) { console.warn("Could not load communication unread count.", error); }
}

async function loadCommunications() {
  const list = document.getElementById("communicationList");
  if (list) list.textContent = "Loading communications...";
  try {
    const result = await httpsCallable(functions, "getCommunications")({ limit: 200 });
    communications = result.data?.communications || [];
    renderCommunications();
    await refreshSummary();
  } catch (error) {
    console.error("Failed to load communications:", error);
    if (list) list.textContent = "Failed to load communications.";
  }
}

async function loadLinkOptions() {
  try {
    const result = await httpsCallable(functions, "getCommunicationLinkOptions")();
    communicationUsers = result.data?.users || [];
    communicationOrders = result.data?.orders || [];
  } catch (error) {
    console.error("Failed to load communication link options:", error);
    showToast("User and order selectors could not be loaded", "error");
  }
}

async function updateRecord(card, extra = {}) {
  const communicationId = card.dataset.communicationId;
  await httpsCallable(functions, "updateCommunication")({ communicationId, ...extra });
  await loadCommunications();
}

async function handleCommunicationClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-communication-id]");
  if (!card) return;
  const action = button.dataset.action;
  if (action === "open") {
    card.querySelector("[data-detail]")?.classList.toggle("hidden");
    const record = communications.find((entry) => entry.id === card.dataset.communicationId);
    if (record?.unreadByAdmin) {
      const nextStatus = record.status === "new" ? "open" : record.status;
      await httpsCallable(functions, "updateCommunication")({
        communicationId: record.id,
        unreadByAdmin: false,
        status: nextStatus,
      });
      record.unreadByAdmin = false;
      record.status = nextStatus;
      card.classList.remove("border-purple-500");
      card.classList.add("border-gray-700");
      button.querySelector("[title='Unread']")?.remove();
      await refreshSummary();
    }
    return;
  }
  button.disabled = true;
  try {
    if (action === "claim" || action === "unassign") await updateRecord(card, { assignment: action === "claim" ? "self" : "unassigned" });
    if (action === "save") {
      await updateRecord(card, {
        status: card.querySelector("[data-field=\"status\"]").value,
        orderIds: [...card.querySelector("[data-field=\"orders\"]").selectedOptions]
          .map((option) => option.value),
        userId: card.querySelector("[data-field=\"user\"]").value,
        unreadByAdmin: false,
      });
    }
    showToast("Communication updated", "success");
  } catch (error) { showToast(error.message || "Could not update communication", "error"); button.disabled = false; }
}

async function handleCommunicationSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const card = form.closest("[data-communication-id]");
  const body = form.elements.body.value.trim();
  if (!body) return;
  const submit = form.querySelector("button[type='submit'], button:not([type])");
  submit.disabled = true;
  try {
    if (form.dataset.form === "note") await updateRecord(card, { note: body });
    else {
      const result = await httpsCallable(functions, "replyToCommunication")({ communicationId: card.dataset.communicationId, bodyText: body });
      showToast(result.data?.sandboxed ? "Reply saved in email sandbox" : "Reply sent", "success");
      await loadCommunications();
    }
  } catch (error) { showToast(error.message || "Could not complete this action", "error"); submit.disabled = false; }
}

function setView(view) {
  activeView = view;
  const statusFilter = document.getElementById("communicationStatusFilter");
  if (statusFilter && view === "all") statusFilter.value = "all";
  if (statusFilter && view === "inbox") statusFilter.value = "active";
  const inbox = document.getElementById("communicationInboxPanel");
  const broadcast = document.getElementById("communicationBroadcastPanel");
  const emails = document.getElementById("communicationEmailLogPanel");
  inbox?.classList.toggle("hidden", ["broadcast", "emails"].includes(view));
  broadcast?.classList.toggle("hidden", view !== "broadcast");
  emails?.classList.toggle("hidden", view !== "emails");
  document.querySelectorAll("[data-communication-view]").forEach((button) => {
    button.classList.toggle("bg-[#407471]", button.dataset.communicationView === view);
    button.classList.toggle("bg-gray-700", button.dataset.communicationView !== view);
  });
  if (!["broadcast", "emails"].includes(view)) renderCommunications();
  if (view === "emails") loadEmailLogs();
}

async function loadEmailLogs() {
  const panel = document.getElementById("communicationEmailLogPanel");
  if (!panel) return;
  panel.innerHTML = "<div class='text-gray-400'>Loading email activity...</div>";
  try {
    const result = await httpsCallable(functions, "getEmailLogs")({ limit: 100 });
    const logs = result.data?.logs || [];
    panel.innerHTML = `<div class="mb-3 flex justify-between"><div><h3 class="text-lg font-semibold">All emails</h3><p class="text-xs text-gray-400">Delivery attempts and provider results.</p></div><button id="refreshEmailLogsBtn" class="rounded bg-gray-700 px-3 py-2 text-sm">Refresh</button></div><div class="space-y-2">${logs.length ? logs.map((log) => `<div class="rounded border border-gray-700 bg-gray-800 p-3 text-sm"><div class="flex justify-between gap-2"><strong>${escapeHTML(typeLabel(log.type))}</strong><span class="rounded px-2 py-1 text-xs ${statusClass(log.status)}">${escapeHTML(log.status)}</span></div><div class="mt-1 break-words text-gray-300">${escapeHTML(log.subject || "-")}</div><div class="mt-2 grid gap-1 text-xs text-gray-400 md:grid-cols-2"><span>To: ${escapeHTML(Array.isArray(log.to) ? log.to.join(", ") : log.to || "-")}</span><span>${escapeHTML(formatDate(log.createdAt))}</span><span>Order: ${escapeHTML(log.orderId || "-")}</span><span>By: ${escapeHTML(log.sentByEmail || "System")}</span></div>${log.errorMessage ? `<div class="mt-2 text-xs text-red-300">${escapeHTML(log.errorMessage)}</div>` : ""}</div>`).join("") : "<p class='text-gray-400'>No email activity logged yet.</p>"}</div>`;
    document.getElementById("refreshEmailLogsBtn")?.addEventListener("click", loadEmailLogs);
  } catch { panel.textContent = "Failed to load email activity."; }
}

async function setupBroadcastForm() {
  const form = document.getElementById("adminEmailForm");
  if (!form || form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const subject = document.getElementById("emailSubject")?.value.trim();
    const htmlContent = document.getElementById("emailHtml")?.value.trim();
    const audience = document.getElementById("emailAudience")?.value || "all";
    if (!subject || !htmlContent) return showToast("Subject and content required", "error");
    try {
      let usersQuery = collection(db, "users");
      if (audience === "affiliates") usersQuery = query(usersQuery, where("roles.affiliate", "==", true));
      const snapshot = await getDocs(usersQuery);
      const recipients = [...new Set(snapshot.docs.map((doc) => doc.data()?.email).filter(Boolean))];
      if (!recipients.length) return showToast("No recipients found", "error");
      const result = await httpsCallable(functions, "sendAdminBroadcastEmail")({ recipients, subject, htmlContent });
      showToast(result.data?.sandboxed ? `Broadcast sandboxed for ${recipients.length} recipients` : `Broadcast sent to ${recipients.length} recipients`, "success");
      form.reset();
    } catch (error) { showToast(error.message || "Failed to send broadcast", "error"); }
  });
}

export async function setupAdminCommunicationBadge() {
  const role = await getUserRole();
  if (!(role?.admin === true || role === "admin")) return;
  await refreshSummary();
  if (!badgeRefreshTimer) {
    badgeRefreshTimer = window.setInterval(refreshSummary, 60000);
    window.addEventListener("focus", refreshSummary);
  }
}

export async function setupAdminEmails() {
  const role = await getUserRole();
  if (!(role?.admin === true || role === "admin")) return;
  if (!initialized) {
    initialized = true;
    document.getElementById("communicationViewButtons")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-communication-view]");
      if (button) setView(button.dataset.communicationView);
    });
    document.getElementById("communicationList")?.addEventListener("click", handleCommunicationClick);
    document.getElementById("communicationList")?.addEventListener("submit", handleCommunicationSubmit);
    document.getElementById("communicationSearch")?.addEventListener("input", renderCommunications);
    document.getElementById("communicationStatusFilter")?.addEventListener("change", renderCommunications);
    document.getElementById("refreshCommunicationsBtn")?.addEventListener("click", loadCommunications);
    await setupBroadcastForm();
  }
  await loadLinkOptions();
  await loadCommunications();
}

export default setupAdminEmails;
