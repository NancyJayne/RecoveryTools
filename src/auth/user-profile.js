// user-profile.js – Handles Firestore updates and reads for user data

import {
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db, auth, functions } from "../utils/firebase-config.js";
import { httpsCallable } from "firebase/functions";
import { showToast } from "../utils/utils.js";
import { updatePassword } from "firebase/auth";

function trackingUrl(order) {
  const trackingNumber = order.trackingNumber || order.tracking || order.trackingId;
  if (order.shippingUrl) return order.shippingUrl;
  if (!trackingNumber) return "";
  return `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(trackingNumber)}`;
}

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function orderIssueUrl(invoiceId, type = "return_requested") {
  const params = new URLSearchParams({ order: invoiceId, type });
  return `/order-issue?${params.toString()}`;
}

function orderItems(order) {
  if (Array.isArray(order.products)) return order.products;
  if (Array.isArray(order.items)) return order.items;
  return [];
}

function itemName(item) {
  return item.name || item.productTitle || item.title || item.productId || "Item";
}

function itemQuantity(item) {
  const quantity = Number(item.quantity || 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function itemProductId(item) {
  return item.productId || item.id || item.slug || "";
}

function productReviewUrl(item) {
  const productId = itemProductId(item);
  if (!productId) return "";
  return `/shop/${encodeURIComponent(productId)}?review=1`;
}

function formattedOrderDate(value) {
  if (!value) return "";
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-AU");
}

function orderIsRefunded(order = {}) {
  return ["refunded", "partially_refunded"].includes(
    String(order.refundStatus || order.paymentStatus || "").toLowerCase(),
  ) || Number(order.refundedAmount || 0) > 0;
}

function renderOrderItems(order) {
  const items = orderItems(order);
  if (!items.length) {
    return `<p class="mt-3 text-sm text-gray-400">No item details found.</p>`;
  }
  const reviewClass = "router-link bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-xs";

  return `
    <div class="mt-3 rounded border border-gray-700 bg-gray-900/50 p-3">
      <div class="mb-2 text-xs uppercase tracking-wide text-gray-400">Items purchased</div>
      <div class="space-y-2">
        ${items.map((item) => {
    const reviewUrl = productReviewUrl(item);
    return `
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div class="text-sm text-gray-200">
                ${itemName(item)} <span class="text-gray-400">x${itemQuantity(item)}</span>
              </div>
              ${reviewUrl
    ? `<a href="${reviewUrl}" class="${reviewClass}">Review</a>`
    : ""}
            </div>
          `;
  }).join("")}
      </div>
    </div>
  `;
}

export async function getUserProfile(uid) {
  const userRef = doc(db, "users", uid);
  const snapshot = await getDoc(userRef);
  return snapshot.exists() ? snapshot.data() : null;
}

export async function updateUserProfile({
  name,
  phone,
  address,
  billingAddress,
  emailPreferences,
}) {
  const uid = auth?.currentUser?.uid;
  if (!uid) throw new Error("Not logged in");

  const ref = doc(db, "users", uid);

  await updateDoc(ref, {
    name,
    phone,
    address,
    billingAddress,
    emailPreferences,
  });
}

export async function changeUserPassword(newPassword) {
  if (!auth?.currentUser) throw new Error("User not authenticated");
  return await updatePassword(auth.currentUser, newPassword);
}

export async function loadOrderReceipts() {
  const grid = document.getElementById("orderHistoryGrid");
  if (!grid) return;

  grid.textContent = "Loading orders...";

  try {
    const callable = httpsCallable(functions, "getUserOrders");
    const res = await callable();
    const orders = res.data.orders;
    grid.textContent = "";

    if (orders.length === 0) {
      grid.textContent = "No orders found.";
      return;
    }

    orders.forEach((order) => {
      const card = document.createElement("div");
      card.className = "bg-gray-800 p-4 rounded shadow";

      const date = order.purchasedAt?.toDate
        ? order.purchasedAt.toDate().toLocaleDateString()
        : "";
      const invoiceId = order.invoiceId || order.id;
      const total = Number(order.total || 0).toFixed(2);
      const refunded = orderIsRefunded(order);
      const refundedAmount = Number(order.refundedAmount || (refunded ? order.total : 0) || 0).toFixed(2);
      const refundedDate = formattedOrderDate(order.refundedAt || order.refundRequestedAt);

      const left = document.createElement("div");
      left.innerHTML = `
        <p class="text-white font-semibold">Invoice #${invoiceId}</p>
        <p class="text-sm text-gray-400">Date: ${date}</p>
        <p class="text-sm text-gray-400">Total: $${total}</p>
        ${refunded ? `
          <div class="mt-2 rounded border border-purple-500/60 bg-purple-950/30 p-2 text-sm">
            <p class="font-semibold text-purple-200">${Number(refundedAmount) < Number(total) ? "Partially refunded" : "Refunded"} $${refundedAmount}</p>
            ${refundedDate ? `<p class="text-xs text-gray-300">Refunded: ${refundedDate}</p>` : ""}
            ${order.refundReason ? `<p class="text-xs text-gray-300">Reason: ${escapeHTML(order.refundReason)}</p>` : ""}
          </div>
        ` : ""}
      `;

      const downloadBtn = document.createElement("button");
      downloadBtn.className =
        "bg-[#407471] text-white px-4 py-2 rounded text-sm";
      downloadBtn.textContent = "Download Invoice";
      downloadBtn.addEventListener("click", () =>
        downloadInvoice(invoiceId),
      );

      const actionWrap = document.createElement("div");
      actionWrap.className = "flex flex-wrap gap-2 sm:justify-end";
      actionWrap.appendChild(downloadBtn);

      const trackingHref = trackingUrl(order);
      if (trackingHref) {
        const trackingLink = document.createElement("a");
        trackingLink.className = "bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm";
        trackingLink.href = trackingHref;
        trackingLink.target = "_blank";
        trackingLink.rel = "noopener";
        trackingLink.textContent = "Track order";
        actionWrap.appendChild(trackingLink);
      }

      const issueLink = document.createElement("a");
      issueLink.className = "router-link bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm";
      issueLink.href = orderIssueUrl(invoiceId, "feedback");
      issueLink.textContent = "Request help";
      actionWrap.appendChild(issueLink);

      const row = document.createElement("div");
      row.className = "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between";
      row.append(left, actionWrap);

      card.appendChild(row);
      card.insertAdjacentHTML("beforeend", renderOrderItems(order));
      grid.appendChild(card);
    });
  } catch (err) {
    console.error("Error loading user orders:", err);
    grid.textContent = "Failed to load orders.";
  }
}

window.downloadInvoice = async function (invoiceId) {
  const callable = httpsCallable(functions, "generateOrderPDF");
  try {
    const res = await callable({ invoiceId });
    window.open(res.data.url, "_blank");
  } catch (err) {
    console.error("PDF download failed:", err);
    showToast("Failed to generate invoice.", "error");
  }
};

function accessIsActive(access) {
  const expiresAt = access.expiresAt?.toMillis?.() ||
    (access.expiresAt ? new Date(access.expiresAt).getTime() : null);
  return access.active !== false && !access.revokedAt &&
    (!expiresAt || Number.isNaN(expiresAt) || expiresAt > Date.now());
}

async function loadAccessibleContent(contentType) {
  const uid = auth?.currentUser?.uid;
  if (!uid) return [];
  const accessSnap = await getDocs(query(
    collection(db, "userAccess"),
    where("userId", "==", uid),
  ));
  const records = await Promise.all(accessSnap.docs.map(async (accessDoc) => {
    const access = accessDoc.data();
    const accessType = String(access.accessType || access.accessEntityType || "").toLowerCase();
    const accessId = access.accessId || access.accessEntityId;
    const collectionName = {
      item: "items",
      blueprint: "blueprints",
      plan: "plans",
    }[accessType];
    if (!accessIsActive(access) || !collectionName || !accessId) return null;
    try {
      const contentSnap = await getDoc(doc(db, collectionName, accessId));
      if (!contentSnap.exists()) return null;
      const content = contentSnap.data();
      const storedType = String(
        content.type || content.itemType || content.blueprintType ||
        content.planType || content.planTypeName || "",
      ).toLowerCase();
      return storedType === contentType ? { id: accessId, entityType: accessType, ...content } : null;
    } catch (error) {
      console.warn(`Could not load unlocked ${accessType} ${accessId}.`, error);
      return null;
    }
  }));
  return [...new Map(records.filter(Boolean).map((record) => [record.id, record])).values()];
}

async function renderAccessibleContent({ gridId, contentType, label, href }) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.textContent = `Loading your ${label.toLowerCase()}...`;
  try {
    if (!auth?.currentUser?.uid) {
      grid.textContent = "No user found.";
      return;
    }
    const records = await loadAccessibleContent(contentType);
    grid.textContent = "";
    if (!records.length) {
      grid.textContent = `No ${label.toLowerCase()} found.`;
      return;
    }
    records.forEach((record) => {
      const card = document.createElement("div");
      card.className = "bg-gray-800 p-4 rounded shadow";
      const title = document.createElement("h4");
      title.className = "text-white font-semibold";
      title.textContent = record.title || record.name || record.id;
      const desc = document.createElement("p");
      desc.className = "text-sm text-gray-400";
      desc.textContent = record.shortDescription || record.description || record.longDescription || "";
      const link = document.createElement("a");
      link.href = `${href}${encodeURIComponent(record.id)}`;
      link.className = "inline-block mt-3 text-[#407471] hover:underline";
      link.textContent = `View ${label.replace(/s$/, "")}`;
      card.append(title, desc, link);
      grid.appendChild(card);
    });
  } catch (err) {
    console.error(`Error loading ${label.toLowerCase()}:`, err);
    grid.textContent = `Failed to load ${label.toLowerCase()}.`;
  }
}

export function loadProfileCourses() {
  return renderAccessibleContent({
    gridId: "myCoursesGrid",
    contentType: "course",
    label: "Courses",
    href: "/courses?course=",
  });
}

export function loadProfileWorkshops() {
  return renderAccessibleContent({
    gridId: "myWorkshopsGrid",
    contentType: "workshop",
    label: "Workshops",
    href: "/workshops?event=",
  });
}

export function loadMyPrograms() {
  return renderAccessibleContent({
    gridId: "myPrograms",
    contentType: "program",
    label: "Programs",
    href: "/programs?program=",
  });
}
