// Trigger order/affiliate emails
import { db, functions } from "../utils/firebase-config.js";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getUserRole } from "../auth/user-roles.js";
import { showToast } from "../utils/utils.js";

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function statusClass(status) {
  if (status === "sent") return "bg-green-900/60 text-green-200";
  if (status === "sandboxed") return "bg-blue-900/60 text-blue-200";
  if (status === "failed") return "bg-red-900/60 text-red-200";
  return "bg-gray-700 text-gray-200";
}

function typeLabel(type) {
  return String(type || "email")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function recipientLabel(to) {
  if (Array.isArray(to)) {
    if (to.length <= 2) return to.join(", ");
    return `${to.slice(0, 2).join(", ")} +${to.length - 2} more`;
  }
  return to || "-";
}

function renderEmailError(errorMessage) {
  if (!errorMessage) return "";
  return `
    <div class="mt-2 text-xs text-red-300 break-words">
      ${escapeHTML(errorMessage)}
    </div>
  `;
}

function ensureEmailLogPanel() {
  const section = document.getElementById("adminEmailSection");
  if (!section) return null;

  let panel = document.getElementById("adminEmailLogPanel");
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = "adminEmailLogPanel";
  panel.className = "mt-8 rounded border border-gray-700 bg-gray-900/50 p-4";
  panel.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <h3 class="text-lg font-semibold">Email log</h3>
        <p class="text-xs text-gray-400">Confirmation, tracking, and admin email attempts.</p>
      </div>
      <button
        id="refreshEmailLogsBtn"
        type="button"
        class="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded text-sm"
      >
        Refresh
      </button>
    </div>
    <div id="adminEmailLogList" class="space-y-2 text-sm">Loading email logs...</div>
  `;
  section.appendChild(panel);
  return panel;
}

async function loadEmailLogs() {
  ensureEmailLogPanel();
  const list = document.getElementById("adminEmailLogList");
  if (!list) return;

  list.textContent = "Loading email logs...";

  try {
    const getEmailLogs = httpsCallable(functions, "getEmailLogs");
    const result = await getEmailLogs({ limit: 50 });
    const logs = Array.isArray(result.data?.logs) ? result.data.logs : [];

    if (!logs.length) {
      list.textContent = "No email activity logged yet.";
      return;
    }

    list.innerHTML = logs.map((log) => `
      <div class="rounded border border-gray-700 bg-gray-800 p-3">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="font-medium text-white">${escapeHTML(typeLabel(log.type))}</div>
            <div class="text-xs text-gray-400 break-all">${escapeHTML(log.subject || "-")}</div>
          </div>
          <span class="rounded px-2 py-1 text-xs font-semibold ${statusClass(log.status)}">
            ${escapeHTML(log.status || "unknown")}
          </span>
        </div>
        <div class="mt-2 grid gap-1 text-xs text-gray-300 md:grid-cols-2">
          <div><span class="text-gray-500">To:</span> ${escapeHTML(recipientLabel(log.to))}</div>
          <div><span class="text-gray-500">When:</span> ${escapeHTML(formatDate(log.createdAt))}</div>
          <div><span class="text-gray-500">Order:</span> ${escapeHTML(log.orderId || "-")}</div>
          <div><span class="text-gray-500">Mode:</span> ${escapeHTML(log.providerMode || log.provider || "-")}</div>
          ${log.sentByEmail ? `<div><span class="text-gray-500">By:</span> ${escapeHTML(log.sentByEmail)}</div>` : ""}
        </div>
        ${renderEmailError(log.errorMessage)}
      </div>
    `).join("");
  } catch (err) {
    console.error("Failed to load email logs:", err);
    list.textContent = "Failed to load email logs.";
  }
}

export async function setupAdminEmails() {
  const role = await getUserRole();

  if (
    !(
      role === "admin" ||
    role?.admin === true
    )
  ) {
    return;
  }

  const form = document.getElementById("adminEmailForm");
  if (!form) return;

  ensureEmailLogPanel();
  document.getElementById("refreshEmailLogsBtn")?.addEventListener("click", loadEmailLogs);
  await loadEmailLogs();

  const sendBroadcast = httpsCallable(functions, "sendAdminBroadcastEmail");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const subject = document.getElementById("emailSubject")?.value.trim();
    const htmlContent = document.getElementById("emailHtml")?.value.trim();
    const audience = document.getElementById("emailAudience")?.value || "all";

    if (!subject || !htmlContent) {
      showToast("Subject and content required", "error");
      return;
    }

    try {
      let q = collection(db, "users");
      if (audience === "affiliates") {
        q = query(q, where("roles.affiliate", "==", true));
      }
      const snap = await getDocs(q);
      const recipients = snap.docs
        .map((doc) => doc.data()?.email)
        .filter(Boolean);

      if (!recipients.length) {
        showToast("No recipients found", "error");
        return;
      }

      const result = await sendBroadcast({ recipients, subject, htmlContent });
      showToast(
        result.data?.sandboxed
          ? `Email sandboxed locally for ${recipients.length} recipients`
          : `Email sent to ${recipients.length} recipients`,
        "success",
      );
      form.reset();
      await loadEmailLogs();
    } catch (err) {
      console.error("Broadcast email failed:", err);
      showToast("Failed to send email", "error");
      await loadEmailLogs();
    }
  });
}

export default setupAdminEmails;

