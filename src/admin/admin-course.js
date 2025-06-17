// admin-course.js // Approves affiliate-submitted courses for publishing
import { db } from "../utils/firebase-config.js";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { showToast } from "../utils/utils.js";
import { attachDeleteHandlers } from "./admin-delete.js";


const COURSE_APPROVALS_ID = "pendingCourseApprovals";

export function setupCourseApprovals() {
  if (document.getElementById(COURSE_APPROVALS_ID)) {
    loadPendingCourseApprovals();
  }
}

export async function loadPendingCourseApprovals() {
  const container = document.getElementById(COURSE_APPROVALS_ID);
  if (!container) return;
  container.innerHTML = "<p class='text-gray-400'>Loading courses...</p>";

  try {
    const snapshot = await getDocs(collection(db, "submittedCourses"));
    const rawCourses = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    const courses = await attachUserToCourses(rawCourses);
    container.innerHTML = "";
    courses.forEach((course) => {
      const div = document.createElement("div");
      div.className = "bg-gray-800 p-4 rounded shadow mb-4";
      div.innerHTML = `
        <h3 class='text-lg font-bold mb-2'>${course.title}</h3>
        <p class='text-sm text-gray-400 mb-2'>Submitted by:
          <a href="/admin/crm?uid=${course.createdBy}" class="text-blue-400 hover:underline" title="Go to user in CRM">
            ${course.userName} (${course.userEmail})
          </a>
        </p>
        <p class='mb-4'>${course.description}</p>
        <div class='flex gap-2'>
          <button class='approve-course-btn bg-green-600 text-white px-3 py-1 rounded' data-id='${
  course.id}'>Approve</button>
          <button class='reject-course-btn bg-red-600 text-white px-3 py-1 rounded' data-id='${
  course.id}'>Reject</button>
          <button class='delete-btn bg-red-600 text-white px-3 py-1 rounded' data-id='${course.id}'>Delete</button>
        </div>
      `;
      container.appendChild(div);
    });

    attachDeleteHandlers("pendingCourseList", "course");

    container.querySelectorAll(".approve-course-btn").forEach((btn) => {
      btn.addEventListener("click", () => approveCourseDraft(btn.dataset.id));
    });

    container.querySelectorAll(".reject-course-btn").forEach((btn) => {
      btn.addEventListener("click", () => rejectCourseDraft(btn.dataset.id));
    });
  } catch (err) {
    console.error("Failed to load course drafts:", err);
    container.innerHTML = "<p class='text-red-500'>Error loading courses.</p>";
  }
}

async function attachUserToCourses(courses) {
  const result = await Promise.all(
    courses.map(async (course) => {
      if (!course.createdBy) return { ...course, userName: "Unknown", userEmail: "N/A" };
      try {
        const userDoc = await getDoc(doc(db, "users", course.createdBy));
        const userData = userDoc.exists() ? userDoc.data() : {};
        return {
          ...course,
          userName: userData.name || userData.email || "Unknown",
          userEmail: userData.email || "N/A",
        };
      } catch {
        return { ...course, userName: "Unknown", userEmail: "N/A" };
      }
    }),
  );
  return result;
}

async function approveCourseDraft(id) {
  try {
    await updateDoc(doc(db, "submittedCourses", id), {
      approved: true,
      status: "Approved",
    });
    showToast("Course approved", "success");
    loadPendingCourseApprovals();
  } catch (err) {
    console.error("Approval failed:", err);
    showToast("Failed to approve course", "error");
  }
}

async function rejectCourseDraft(id) {
  try {
    await deleteDoc(doc(db, "submittedCourses", id));
    showToast("Course rejected", "info");
    loadPendingCourseApprovals();
  } catch (err) {
    console.error("Rejection failed:", err);
    showToast("Failed to reject course", "error");
  }
}
