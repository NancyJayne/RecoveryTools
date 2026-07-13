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

function orderIssueUrl(invoiceId, type = "return_requested", rating = "") {
  const params = new URLSearchParams({ order: invoiceId, type });
  if (rating) params.set("rating", rating);
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
      const total = order.total?.toFixed(2) || "0.00";

      const left = document.createElement("div");
      left.innerHTML = `
        <p class="text-white font-semibold">Invoice #${invoiceId}</p>
        <p class="text-sm text-gray-400">Date: ${date}</p>
        <p class="text-sm text-gray-400">Total: $${total}</p>
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

export async function loadProfileCourses() {
  const grid = document.getElementById("myCoursesGrid");
  if (!grid) return;
  grid.textContent = "Loading your courses...";

  try {
    const uid = auth?.currentUser?.uid;
    if (!uid) {
      grid.textContent = "No user found.";
      return;
    }

    const purchasesSnap = await getDocs(collection(db, "users", uid, "purchases"));
    grid.textContent = "";

    if (purchasesSnap.empty) {
      grid.textContent = "No courses found.";
      return;
    }

    for (const purchase of purchasesSnap.docs) {
      const courseId = purchase.id || purchase.data().courseId;
      const courseSnap = await getDoc(doc(db, "courses", courseId));
      if (!courseSnap.exists()) continue;
      const course = courseSnap.data();

      const card = document.createElement("div");
      card.className = "bg-gray-800 p-4 rounded shadow cursor-pointer hover:bg-gray-700";
      card.addEventListener("click", () => {
        window.location.href = `/courses?course=${courseId}`;
      });

      const title = document.createElement("h4");
      title.className = "text-white font-semibold";
      title.textContent = course.title || course.name;

      const desc = document.createElement("p");
      desc.className = "text-sm text-gray-400";
      desc.textContent = course.description;

      card.append(title, desc);
      grid.appendChild(card);
    }
  } catch (err) {
    console.error("Error loading courses:", err);
    grid.textContent = "Failed to load courses.";
  }
}

export async function loadProfileWorkshops() {
  const grid = document.getElementById("myWorkshopsGrid");
  if (!grid) return;
  grid.textContent = "Loading your workshops...";

  try {
    const uid = auth?.currentUser?.uid;
    const ticketQuery = query(
      collection(db, "workshopTickets"),
      where("userId", "==", uid),
    );

    const ticketSnap = await getDocs(ticketQuery);
    grid.textContent = "";

    if (ticketSnap.empty) {
      grid.textContent = "No workshops found.";
      return;
    }

    const workshopDocs = await Promise.all(
      ticketSnap.docs.map((t) => {
        const wid = t.data()?.workshopId;
        return wid ? getDoc(doc(db, "workshops", wid)) : Promise.resolve(null);
      }),
    );

    workshopDocs.forEach((wsSnap) => {
      if (!wsSnap?.exists()) return;
      const ws = wsSnap.data();
      const workshopId = wsSnap.id;

      const card = document.createElement("div");
      card.className = "bg-gray-800 p-4 rounded shadow";

      const title = document.createElement("h4");
      title.className = "text-white font-semibold";
      title.textContent = ws.name || ws.title;

      const desc = document.createElement("p");
      desc.className = "text-sm text-gray-400";
      desc.textContent = ws.description || "";

      const link = document.createElement("a");
      link.href = `/workshops?event=${workshopId}`;
      link.className = "text-[#407471] text-sm hover:underline mt-2 inline-block";
      link.textContent = "View Details";

      card.append(title, desc, link);
      grid.appendChild(card);
    });
  } catch (err) {
    console.error("Error loading workshops:", err);
    grid.textContent = "Failed to load workshops.";
  }
}

export async function loadMyPrograms() {
  const grid = document.getElementById("myPrograms");
  if (!grid) return;
  grid.textContent = "Loading your programs...";

  try {
    const q = query(
      collection(db, "programs"),
      where("assignedTo", "==", auth?.currentUser?.uid),
    );
    const snapshot = await getDocs(q);
    grid.textContent = "";

    if (snapshot.empty) {
      grid.textContent = "No programs found.";
      return;
    }

    snapshot.forEach((doc) => {
      const program = doc.data();
      const block = document.createElement("div");
      block.className = "bg-gray-800 p-4 rounded shadow mb-4";

      const title = document.createElement("h4");
      title.className = "text-white font-semibold";
      title.textContent = program.name;

      const desc = document.createElement("p");
      desc.className = "text-sm text-gray-400";
      desc.textContent = program.description;

      block.append(title, desc);
      grid.appendChild(block);
    });
  } catch (err) {
    console.error("Error loading programs:", err);
    grid.textContent = "Failed to load programs.";
  }
}
