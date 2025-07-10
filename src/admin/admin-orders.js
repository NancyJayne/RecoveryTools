// admin-orders.js // Manages global order review, shipping status, notes, and filters
import { db } from "../utils/firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { showToast } from "../utils/utils.js";

const ORDER_GRID_ID = "globalOrdersGrid";
const urlParams = new URLSearchParams(window.location.search);
const filterOrderId = urlParams.get("filter");
const filterRef = urlParams.get("ref");

let allOrders = [];

function formatStatusClass(status) {
  return `status-${(status || "unknown").toLowerCase().replace(/\s+/g, "-")}`;
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

  if (document.getElementById(ORDER_GRID_ID)) loadAllOrdersForAdmin();
}

export async function loadAllOrdersForAdmin() {
  let q = collection(db, "orders");
  if (filterRef) {
    q = query(q, where("referredBy", "==", filterRef));
  }
  const snapshot = await getDocs(q);
  let rawOrders = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  allOrders = await attachUserDetails(rawOrders);
  renderOrderGrid(allOrders);
}

async function attachUserDetails(orders) {
  const results = await Promise.all(
    orders.map(async (order) => {
      if (!order.uid) return { ...order, userName: "Unknown", userEmail: order.email };
      try {
        const userDoc = await getDoc(doc(db, "users", order.uid));
        const userData = userDoc.exists() ? userDoc.data() : {};
        return {
          ...order,
          userName: userData.name || userData.email || "Unknown",
          userEmail: userData.email || order.email,
        };
      } catch {
        return { ...order, userName: "Unknown", userEmail: order.email };
      }
    }),
  );
  return results;
}

export function renderOrderGrid(orders) {
  const grid = document.getElementById(ORDER_GRID_ID);
  if (!grid) return;
  grid.innerHTML = "";

  orders.forEach((data) => {
    const div = document.createElement("div");
    div.className = `order-card bg-gray-800 p-4 rounded mb-4 ${formatStatusClass(data.status)}`;
    div.setAttribute("data-order-id", data.id);

    if (data.id === filterOrderId) {
      div.classList.add("border", "border-yellow-400");
      setTimeout(() => div.scrollIntoView({ behavior: "smooth", block: "center" }), 200);
    }

    div.innerHTML = `
      <div><strong>Invoice:</strong> ${data.id}</div>
      <div>
        <strong>User:</strong>
        <a href="/admin/crm?uid=${data.uid}" class="text-blue-400 hover:underline" title="Go to user in CRM">
          ${data.userName} (${data.userEmail})
        </a>
      </div>
      <div><strong>Status:</strong> ${data.status}</div>
      <input class="trackingInput" data-id="${data.id}" placeholder="Tracking number" value="${data.tracking || ""}" />
      <textarea class="orderNoteInput" data-id="${data.id}" placeholder="Admin note...">${data.note || ""}</textarea>
      <input type="date" class="orderDueDateInput" data-id="${data.id}" value="${data.dueDate || ""}" />
      <div class="text-xs text-gray-400">
      Last Updated: ${
  data.updatedAt
    ? new Date(data.updatedAt.seconds * 1000).toLocaleDateString()
    : "—"
}
    </div>
      <button class="update-status-btn" data-id="${data.id}">Save Status</button>
      <button class="save-note-btn" data-id="${data.id}">Save Note</button>
    `;
    grid.appendChild(div);
  });

  document.querySelectorAll("select.order-status").forEach((select) => {
    select.addEventListener("change", async () => {
      const card = select.closest(".order-card");
      const orderId = card?.getAttribute("data-order-id");
      const newStatus = select.value;
  
      try {
        await updateDoc(doc(db, "orders", orderId), {
          status: newStatus,
          updatedAt: serverTimestamp(),
        });
        const orderIndex = allOrders.findIndex((o) => o.id === orderId);
        if (orderIndex > -1) allOrders[orderIndex].status = newStatus;
        showToast("Order status updated", "success");
        renderOrderGrid(allOrders); // Re-render to reflect changes
      } catch (err) {
        console.error("Error updating status:", err);
        showToast("Failed to update order status", "error");
      }
    });
  });
  
  document.querySelectorAll(".update-status-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = btn.dataset.id;
      const input = document.querySelector(`.trackingInput[data-id='${orderId}']`);
      const newTracking = input?.value.trim();
      if (!newTracking) return showToast("Tracking number required", "error");

      try {
        await updateDoc(doc(db, "orders", orderId), {
          tracking: newTracking,
          status: "Shipped",
        });
        const orderIndex = allOrders.findIndex((o) => o.id === orderId);
        if (orderIndex > -1) allOrders[orderIndex].status = "Shipped";
        renderOrderGrid(allOrders);
        showToast("Order updated", "success");
      } catch {
        showToast("Error updating order", "error");
      }
    });
  });

  document.querySelectorAll(".save-note-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = btn.dataset.id;
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
    });
  });
}

export function updateStatusFilter(filter) {
  showToast(`Filtering by: ${filter}`, "info");
  const filteredOrders = filter === "All" ? allOrders : allOrders.filter((order) => order.status === filter);
  renderOrderGrid(filteredOrders);
}
