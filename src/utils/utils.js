// utils.js – Frontend Shared UI Utilities for RecoveryTools Platform

export function setupNavMenuToggle() {
  document.getElementById("mobileMenuToggle")?.addEventListener("click", () => {
    document.getElementById("mainNav")?.classList.toggle("hidden");
  });
}

export function showToast(message, type = "info", duration = 3000) {
  const toast = document.createElement("div");

  const bgColor =
    type === "success"
      ? "bg-green-600"
      : type === "error"
        ? "bg-red-600"
        : "bg-gray-800";

  toast.className = [
    "fixed bottom-4 left-1/2 transform -translate-x-1/2",
    "px-4 py-2 rounded shadow-lg z-50 text-white text-sm",
    bgColor,
  ].join(" ");

  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

export function formatCurrency(amount, locale = "en-AU", currency = "AUD") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount);
}

export function debounce(func, wait = 300) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

export function scrollToElement(selector) {
  const el = document.querySelector(selector);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

export function showTabContent(id) {
  let targetId = id;
  if (!document.getElementById(targetId)) {
    targetId = "homeSection";
  }

  document.querySelectorAll(".tab-content").forEach((el) => {
    const isTarget = el.id === targetId;
    el.classList.toggle("hidden", !isTarget);
    el.classList.toggle("active", isTarget);
  });
  // Recalculate layout so footer stays at the bottom
  if (typeof window.adjustMainHeight === "function") {
    window.adjustMainHeight();
  }
}

export function showSection(id) {
  document.querySelectorAll(".section").forEach((section) => {
    section.classList.add("hidden");
  });
  const target = document.getElementById(id);
  if (target) target.classList.remove("hidden");
}

export function redirectToPayment(url) {
  window.location.href = url;
}
