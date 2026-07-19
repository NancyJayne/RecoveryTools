import { httpsCallable } from "firebase/functions";
import { onAuthStateChanged } from "firebase/auth";
import { auth, functions } from "../utils/firebase-config.js";
import { showAuthModal } from "../auth/auth-modal.js";
import { showToast } from "../utils/utils.js";

const ISSUE_OPTIONS = [
  { value: "feedback", label: "Order feedback or comment" },
  { value: "return_requested", label: "Return" },
  { value: "exchange_requested", label: "Replacement or swap" },
  { value: "damaged_item", label: "Damaged item" },
  { value: "complaint_open", label: "Complaint" },
];

const AUTH_RETURN_TO_KEY = "recovery_auth_return_to";

function waitForAuth() {
  if (auth?.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const timeout = setTimeout(() => {
      unsubscribe();
      resolve(auth?.currentUser || null);
    }, 1200);
    unsubscribe = onAuthStateChanged(auth, (user) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(user);
    });
  });
}

function ensureSection() {
  let section = document.getElementById("order-issueSection");
  if (section) return section;

  section = document.createElement("section");
  section.id = "order-issueSection";
  section.className = "tab-content hidden min-h-screen bg-gray-950 text-white";
  document.querySelector("main")?.appendChild(section);
  return section;
}

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showOnly(section) {
  document.querySelectorAll("main > section, .tab-content").forEach((el) => {
    el.classList.add("hidden");
  });
  section.classList.remove("hidden");
}

function selectedOptionHtml(currentType) {
  return ISSUE_OPTIONS.map((option) => `
    <option value="${option.value}" ${option.value === currentType ? "selected" : ""}>
      ${option.label}
    </option>
  `).join("");
}

function renderForm(section, { orderId, issueType }) {
  section.innerHTML = `
    <div class="mx-auto max-w-2xl px-6 py-10">
      <a href="/profile" class="router-link text-sm text-[#63d6b2] hover:underline">Back to profile</a>
      <h1 class="mt-4 text-3xl font-bold">Order help</h1>
      <p class="mt-2 text-sm text-gray-300">
        Send general feedback, ask for help, or open a return, replacement, damaged item, or complaint request.
      </p>

      <form id="orderIssueForm" class="mt-6 space-y-4 rounded border border-gray-800 bg-gray-900 p-5">
        <label class="block text-sm">
          Order number
          <input
            id="orderIssueOrderId"
            class="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-white"
            value="${escapeHTML(orderId)}"
            required
          />
        </label>

        <label class="block text-sm">
          What would you like to send?
          <select
            id="orderIssueType"
            class="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-white"
          >
            ${selectedOptionHtml(issueType)}
          </select>
        </label>

        <label class="block text-sm">
          Item or items affected
          <input
            id="orderIssueAffectedItems"
            class="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-white"
            placeholder="Example: Medium silicone cup, order item 2"
          />
        </label>

        <label class="block text-sm">
          Preferred outcome
          <input
            id="orderIssuePreferredOutcome"
            class="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-white"
            placeholder="Example: no action needed, replacement, return, refund, product support"
          />
        </label>

        <label class="block text-sm">
          Message
          <textarea
            id="orderIssueDetails"
            class="mt-1 min-h-32 w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-white"
            placeholder="Example: thanks for quick shipping, my order was slow, or I need help."
          ></textarea>
        </label>

        <div id="orderIssueMessage" class="hidden rounded border px-3 py-2 text-sm"></div>

        <button
          type="submit"
          class="w-full rounded bg-[#407471] px-4 py-2 font-semibold text-white hover:bg-[#305a56]"
        >
          Send to admin team
        </button>
      </form>
    </div>
  `;
}

function setMessage(message, type = "info") {
  const box = document.getElementById("orderIssueMessage");
  if (!box) return;
  box.textContent = message;
  box.classList.remove(
    "hidden",
    "border-red-700",
    "bg-red-950",
    "text-red-200",
    "border-green-700",
    "bg-green-950",
    "text-green-200",
  );
  if (type === "error") {
    box.classList.add("border-red-700", "bg-red-950", "text-red-200");
  } else {
    box.classList.add("border-green-700", "bg-green-950", "text-green-200");
  }
}

function bindForm() {
  const form = document.getElementById("orderIssueForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const user = await waitForAuth();
    if (!user) {
      sessionStorage.setItem(AUTH_RETURN_TO_KEY, window.location.href);
      showToast("Please sign in before submitting an order issue.", "error");
      showAuthModal("login");
      return;
    }

    const submitButton = form.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Sending...";
    }

    try {
      const submitOrderIssue = httpsCallable(functions, "submitOrderIssue");
      await submitOrderIssue({
        orderId: document.getElementById("orderIssueOrderId")?.value.trim(),
        issueType: document.getElementById("orderIssueType")?.value,
        affectedItems: document.getElementById("orderIssueAffectedItems")?.value.trim(),
        preferredOutcome: document.getElementById("orderIssuePreferredOutcome")?.value.trim(),
        details: document.getElementById("orderIssueDetails")?.value.trim(),
      });
      setMessage("Thanks. This has been added to your order and sent to the admin queue.", "success");
      showToast("Order request submitted.", "success");
      form.reset();
    } catch (err) {
      console.error("Order issue submission failed:", err);
      setMessage(err.message || "Could not submit this request. Please try again.", "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Send to admin team";
      }
    }
  });
}

export default async function initOrderIssuePage() {
  const section = ensureSection();
  const params = new URLSearchParams(window.location.search);
  renderForm(section, {
    orderId: params.get("order") || "",
    issueType: params.get("type") || "feedback",
  });
  showOnly(section);
  bindForm();

  const user = await waitForAuth();
  if (!user) {
    sessionStorage.setItem(AUTH_RETURN_TO_KEY, window.location.href);
    showToast("Please sign in so we can connect this request to your order.", "info", 5000);
    showAuthModal("login");
  }
}
