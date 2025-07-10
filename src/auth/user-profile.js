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

export async function getUserProfile(uid) {
  const userRef = doc(db, "users", uid);
  const snapshot = await getDoc(userRef);
  return snapshot.exists() ? snapshot.data() : null;
}

export async function updateUserProfile({ name, phone, address }) {
  const uid = auth?.currentUser?.uid;
  if (!uid) throw new Error("Not logged in");

  const ref = doc(db, "users", uid);
  await updateDoc(ref, { name, phone, address });
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

      const row = document.createElement("div");
      row.className = "flex justify-between items-center";
      row.append(left, downloadBtn);

      card.appendChild(row);
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
    const q = query(
      collection(db, "workshops"),
      where("purchasedBy", "array-contains", auth?.currentUser?.uid),
    );
    const snapshot = await getDocs(q);
    grid.textContent = "";

    if (snapshot.empty) {
      grid.textContent = "No workshops found.";
      return;
    }

    snapshot.forEach((doc) => {
      const ws = doc.data();
      const card = document.createElement("div");
      card.className = "bg-gray-800 p-4 rounded shadow";

      const title = document.createElement("h4");
      title.className = "text-white font-semibold";
      title.textContent = ws.name;

      const desc = document.createElement("p");
      desc.className = "text-sm text-gray-400";
      desc.textContent = ws.description;

      card.append(title, desc);
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
