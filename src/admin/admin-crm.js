// admin-crm.js – Unified User CRM Panel with Role Assignment, Password Reset, and Links
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../utils/firebase-config.js";
import {
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { showToast } from "../utils/utils.js";

const CRM_FORM_ID = "roleForm";
const SEARCH_INPUT_ID = "userSearchInput";
const SEARCH_RESULTS_ID = "userSearchResults";
const SELECTED_USER_PANEL_ID = "selectedUserPanel";

export function setupRoleManager() {
  if (!document.getElementById(CRM_FORM_ID)) return;

  const form = document.getElementById(CRM_FORM_ID);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const uid = document.getElementById("roleUid").value;
    const roles = {
      admin: document.getElementById("roleAdmin").checked,
      affiliate: document.getElementById("roleAffiliate").checked,
      therapist: document.getElementById("roleTherapist").checked,
    };
    if (!uid) return showToast("Select a user first.", "error");

    try {
      const functions = getFunctions();
      const setUserRoles = httpsCallable(functions, "setUserRoles");
      await setUserRoles({ uid, roles });
      showToast("Roles updated", "success");
    } catch (err) {
      console.error("Failed to update roles:", err);
      showToast("Error assigning roles", "error");
    }
  });

  const uidFromURL = new URLSearchParams(window.location.search).get("uid");
  if (uidFromURL) {
    selectUser(uidFromURL);
  }

  document.getElementById("resetPasswordBtn")?.addEventListener("click", resetUserPasswordAsAdmin);

  document.getElementById(SEARCH_INPUT_ID)?.addEventListener("input", async (e) => {
    const term = e.target.value.trim().toLowerCase();
    if (!term) return;
    const resultsContainer = document.getElementById(SEARCH_RESULTS_ID);
    resultsContainer.innerHTML = "<p class='text-sm text-gray-400'>Searching...</p>";
    const users = await searchUsers(term);
    resultsContainer.innerHTML = users.length
      ? users.map((user) =>
        `<li data-uid="${user.id}" class="cursor-pointer hover:underline">
        ${user.name || user.email}
      </li>`,
      ).join("")
      : "<li class='text-gray-400'>No results found</li>";

    document.querySelectorAll(`#${SEARCH_RESULTS_ID} li[data-uid]`).forEach((li) => {
      li.addEventListener("click", () => selectUser(li.dataset.uid));
    });
  });
}

async function resetUserPasswordAsAdmin() {
  const uid = document.getElementById("roleUid").value;
  const newPassword = document.getElementById("newPassword").value;

  if (!uid || !newPassword) {
    return showToast("Enter a UID and new password", "error");
  }

  try {
    const functions = getFunctions();
    const resetPassword = httpsCallable(functions, "adminResetUserPassword");
    await resetPassword({ uid, newPassword });
    showToast("Password reset successfully", "success");
  } catch (err) {
    console.error("Error resetting password:", err);
    showToast(err.message, "error");
  }
}

async function searchUsers(term) {
  const usersRef = collection(db, "users");
  const q = query(usersRef, where("searchIndex", "array-contains", term));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function selectUser(uid) {
  const userDoc = await getDocs(query(collection(db, "users"), where("uid", "==", uid)));
  const docSnap = userDoc.docs[0];
  if (!docSnap) return showToast("User not found", "error");
  const user = docSnap.data();

  document.getElementById("roleUid").value = uid;
  document.getElementById("roleAdmin").checked = user.roles?.admin || false;
  document.getElementById("roleAffiliate").checked = user.roles?.affiliate || false;
  document.getElementById("roleTherapist").checked = user.roles?.therapist || false;
  document.getElementById(SELECTED_USER_PANEL_ID).classList.remove("hidden");
  document.getElementById("selectedUserName").textContent = user.name || user.email;

  renderUserOrders(uid);
  renderUserWorkshops(uid);
  renderUserCourses(uid);
  renderUserCRMNotes(uid);
}

async function renderUserOrders(uid) {
  const ordersRef = collection(db, "orders");
  const q = query(ordersRef, where("uid", "==", uid));
  const snapshot = await getDocs(q);
  const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const container = document.getElementById("userOrdersGrid");
  if (!container) return;
  container.innerHTML = "";

  orders.forEach((order) => {
    const div = document.createElement("div");
    div.className = "bg-gray-800 p-3 rounded mb-2 cursor-pointer hover:bg-gray-700";
    div.innerHTML = `
      <div><strong>Invoice:</strong> ${order.id}</div>
      <div><strong>Status:</strong> ${order.status}</div>
    `;
    div.addEventListener("click", () => {
      window.location.href = `/admin/orders?filter=${order.id}`;
    });
    container.appendChild(div);
  });
}

async function renderUserWorkshops(uid) {
  const q = query(collection(db, "workshops"), where("createdBy", "==", uid));
  const snapshot = await getDocs(q);
  const container = document.getElementById("userWorkshopList");
  if (!container) return;
  container.innerHTML = snapshot.docs.map((doc) => {
    const data = doc.data();
    return `<div class="bg-gray-700 p-2 rounded mb-2">
      <strong>${data.name}</strong> (${data.status})
    </div>`;
  }).join("");
}

async function renderUserCourses(uid) {
  const q = query(collection(db, "courses"), where("createdBy", "==", uid));
  const snapshot = await getDocs(q);
  const container = document.getElementById("userCourseList");
  if (!container) return;
  container.innerHTML = snapshot.docs.map((doc) => {
    const data = doc.data();
    return `<div class="bg-gray-700 p-2 rounded mb-2">
      <strong>${data.title}</strong> (${data.status})
    </div>`;
  }).join("");
}

async function renderUserCRMNotes(uid) {
  const q = query(collection(db, `users/${uid}/notes`));
  const snapshot = await getDocs(q);
  const container = document.getElementById("userNotesList");
  if (!container) return;
  const now = new Date();

  const notes = snapshot.docs.map((doc) => {
    const data = doc.data();
    const isUrgent = data.dueDate && new Date(data.dueDate) <= new Date(now.getTime() + 3 * 86400000);
    return `<li class="${isUrgent ? "text-yellow-400" : "text-white"}">
      ${data.text} - Due: ${data.dueDate || "N/A"}
    </li>`;
  });
  container.innerHTML = notes.join("");
}
