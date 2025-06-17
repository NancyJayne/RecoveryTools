// admin-workshops.js // Handles affiliate workshop approvals
import { db } from "../utils/firebase-config.js";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { showToast } from "../utils/utils.js";
import { attachDeleteHandlers } from "./admin-delete.js";


const WORKSHOP_APPROVALS_ID = "adminWorkshopApprovals";
let allWorkshops = [];

export function setupWorkshopManagement() {
  if (document.getElementById(WORKSHOP_APPROVALS_ID)) loadPendingWorkshops();
}

export async function loadPendingWorkshops() {
  const snapshot = await getDocs(collection(db, "submittedWorkshops"));
  const rawWorkshops = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  allWorkshops = await attachWorkshopUserDetails(rawWorkshops);
  renderWorkshopGrid(allWorkshops);
}

async function attachWorkshopUserDetails(workshops) {
  const results = await Promise.all(
    workshops.map(async (workshop) => {
      if (!workshop.createdBy) return { ...workshop, userName: "Unknown", userEmail: "N/A" };
      try {
        const userDoc = await getDoc(doc(db, "users", workshop.createdBy));
        const userData = userDoc.exists() ? userDoc.data() : {};
        return {
          ...workshop,
          userName: userData.name || userData.email || "Unknown",
          userEmail: userData.email || "N/A",
        };
      } catch {
        return { ...workshop, userName: "Unknown", userEmail: "N/A" };
      }
    }),
  );
  return results;
}

function renderWorkshopGrid(workshops) {
  const container = document.getElementById(WORKSHOP_APPROVALS_ID);
  if (!container) return;
  container.innerHTML = "";

  workshops.forEach((data) => {
    const div = document.createElement("div");
    const statusClass = (data.status || "pending").toLowerCase().replace(/\s+/g, "-");
    div.className = `workshop-card bg-gray-800 p-4 rounded shadow space-y-2 mb-4 status-${statusClass}`;
    div.innerHTML = `
      <h3 class="text-lg font-bold">${data.name}</h3>
      <p class="text-sm text-gray-400">${data.location} on ${data.date}</p>
      <p>${data.description}</p>
      <p class="text-sm">
        <strong>Submitted by:</strong>
        <a href="/admin/crm?uid=${data.createdBy}" class="text-blue-400 hover:underline" title="Go to user in CRM">
          ${data.userName} (${data.userEmail})
        </a>
      </p>
      <div class="flex gap-2">
        <button class="approve-btn bg-green-600 text-white px-3 py-1 rounded" data-id="${data.id}">Approve</button>
        <button class="reject-btn bg-red-600 text-white px-3 py-1 rounded" data-id="${data.id}">Reject</button>
        <button class="delete-btn bg-red-600 text-white px-3 py-1 rounded" data-id="${data.id}">Delete</button>
      </div>
    `;
    container.appendChild(div);
  });

  attachDeleteHandlers("workshopApprovalGrid", "workshop");


  container.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", () => approveWorkshop(btn.dataset.id));
  });

  container.querySelectorAll(".reject-btn").forEach((btn) => {
    btn.addEventListener("click", () => rejectWorkshop(btn.dataset.id));
  });
}

async function approveWorkshop(id) {
  await updateDoc(doc(db, "submittedWorkshops", id), { approved: true, status: "Approved" });
  showToast("Workshop approved", "success");
  loadPendingWorkshops();
}

async function rejectWorkshop(id) {
  await deleteDoc(doc(db, "submittedWorkshops", id));
  showToast("Workshop rejected", "info");
  loadPendingWorkshops();
}
