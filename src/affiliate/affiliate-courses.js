// affiliate-courses.js – Handles course proposal submissions and loading
import { db, auth } from "../utils/firebase-config.js";
import { collection, 
  addDoc, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  updateDoc, 
  deleteDoc } from "firebase/firestore";
import { showToast } from "../utils/utils.js";
import { generateSlug, validateSlug as isSlugValid } from "./affiliate-utils.js";

export function initAffiliateCourseSubmission() {
  setupCourseProposalForm();
  renderSubmittedCourses();
  setupCourseModals();
}

function setupCourseModals() {
  const modal = document.getElementById("editCourseModal");
  const cancelBtn = document.getElementById("cancelEditCourseBtn");
  const deleteBtn = document.getElementById("deleteEditCourseBtn");

  cancelBtn?.addEventListener("click", () => {
    modal.classList.add("hidden");
    modal.classList.remove("opacity-100");
  });

  deleteBtn?.addEventListener("click", async () => {
    const courseId = document.getElementById("editCourseId").value;
    if (courseId && confirm("Are you sure you want to delete this course?")) {
      await deleteCourse(courseId);
      modal.classList.add("hidden");
      renderSubmittedCourses();
    }
  });
}

export async function deleteCourse(courseId) {
  if (!confirm("Are you sure you want to delete this course?")) return;

  try {
    await deleteDoc(doc(db, "products", courseId));
    showToast("Course deleted successfully.", "success");
    renderSubmittedCourses();
    document.getElementById("editCourseModal").classList.add("hidden");
  } catch (err) {
    console.error("Failed to delete course:", err);
    showToast("Failed to delete course.", "error");
  }
}

export async function submitCourseProposal(formData) {
  try {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("User not authenticated");

    await addDoc(collection(db, "courses"), {
      ...formData,
      creatorId: uid,
      createdAt: new Date(),
      type: "Course",
    });

    showToast("✅ Course proposal submitted", "success");
  } catch (err) {
    console.error("Submit course error:", err);
    showToast("Failed to submit course proposal.", "error");
  }
}

export async function loadAffiliateCourses() {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];

  const q = query(collection(db, "courses"), where("creatorId", "==", uid));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function loadMyCourses() {
  const user = auth.currentUser;
  if (!user) return;

  const grid = document.getElementById("mySubmittedCourses");
  if (!grid) return;

  grid.innerHTML = `
    <div class="flex justify-center items-center min-h-[100px]">
      <div class="w-8 h-8 border-4 border-t-transparent border-green-400 rounded-full animate-spin"></div>
    </div>
  `;

  try {
    const snapshot = await getDocs(query(
      collection(db, "courses"),
      where("createdBy", "==", user.uid),
      orderBy("createdAt", "desc"),
    ));

    const courses = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    grid.innerHTML = "";

    if (courses.length === 0) {
      grid.innerHTML = `<p class="text-gray-400">No courses submitted yet.</p>`;
      return;
    }

    courses.forEach((course) => {
      const tile = document.createElement("div");
      tile.className = "bg-gray-800 text-white rounded-lg shadow p-4";

      const img = document.createElement("img");
      img.src = course.image || "https://via.placeholder.com/600x400?text=Course";
      img.alt = `${course.title || "Course"} thumbnail`;
      img.className = "w-full h-32 object-cover rounded mb-3";

      const title = document.createElement("h3");
      title.className = "text-lg font-semibold";
      title.textContent = course.title || "Untitled Course";

      const status = document.createElement("p");
      status.className = `text-sm ${course.status === "approved" ? "text-green-400" : "text-yellow-400"}`;
      status.textContent = `Status: ${course.status || "pending"}`;

      const desc = document.createElement("p");
      desc.className = "text-sm text-gray-400";
      desc.textContent = course.shortDescription || (course.description || "").slice(0, 80) + "...";

      const duration = course.duration ? document.createElement("p") : null;
      if (duration) {
        duration.className = "text-xs text-gray-500";
        duration.textContent = `🕒 Duration: ${course.duration}`;
      }

      const btnGroup = document.createElement("div");
      btnGroup.className = "flex flex-wrap gap-2 mt-4";

      const editBtn = document.createElement("button");
      editBtn.className = "edit-course-btn bg-blue-600 px-3 py-1 rounded hover:bg-blue-700 text-sm";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", async () => {
        const docSnap = await getDoc(doc(db, "courses", course.id));
        if (docSnap.exists()) {
          openEditCourseModal({ id: docSnap.id, ...docSnap.data() });
        } else {
          showToast("Course not found.", "error");
        }
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-course-btn bg-red-600 px-3 py-1 rounded hover:bg-red-700 text-sm";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        const confirmDelete = confirm("Are you sure you want to delete this course?");
        if (!confirmDelete) return;

        try {
          await deleteDoc(doc(db, "courses", course.id));
          showToast("Course deleted.", "success");
          loadMyCourses();
        } catch (err) {
          console.error("Delete failed:", err);
          showToast("Failed to delete course.", "error");
        }
      });

      const referralBtn = document.createElement("button");
      referralBtn.className = "copy-course-link-btn bg-green-600 px-3 py-1 rounded hover:bg-green-700 text-sm";
      referralBtn.textContent = "Copy Referral Link";
      referralBtn.addEventListener("click", () => {
        copyCourseReferralLink(course.id);
      });

      btnGroup.append(editBtn, deleteBtn, referralBtn);

      tile.append(img, title, status, desc);
      if (duration) tile.appendChild(duration);
      tile.appendChild(btnGroup);
      grid.appendChild(tile);
    });
  } catch (err) {
    console.error("Error loading courses:", err);
    showToast("Failed to load your courses.", "error");
  }
}

export function openEditCourseModal(course) {
  document.getElementById("editCourseId").value = course.id;
  const fields = [
    ["editCourseTitle", course.title],
    ["editCourseDescription", course.description],
    ["editCourseShortDescription", course.shortDescription],
    ["editCourseSlug", course.slug],
    ["editCourseDuration", course.duration],
    ["editCoursePrice", course.price],
    ["editCourseSalePrice", course.salePrice],
  ];

  fields.forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = value || "";
      el.dataset.original = value || "";
    }
  });

  const featuresEl = document.getElementById("editCourseFeatures");
  if (featuresEl) {
    const featuresText = Array.isArray(course.features) ? course.features.join(", ") : "";
    featuresEl.value = featuresText;
    featuresEl.dataset.original = featuresText;
  }

  const maxEl = document.getElementById("editCourseMaxParticipants");
  if (maxEl) {
    maxEl.value = course.maxParticipants ?? "";
    maxEl.dataset.original = course.maxParticipants ?? "";
  }

  const tagsEl = document.getElementById("editCourseTags");
  if (tagsEl) {
    const tagText = Array.isArray(course.tags) ? course.tags.join(", ") : "";
    tagsEl.value = tagText;
    tagsEl.dataset.original = tagText;
  }

  const visibleEl = document.getElementById("editCourseVisible");
  if (visibleEl) {
    visibleEl.checked = course.visible ?? true;
    visibleEl.dataset.original = String(course.visible ?? true);
  }

  const saleEl = document.getElementById("editCourseOnSale");
  if (saleEl) {
    saleEl.checked = !!course.onSale;
    saleEl.dataset.original = String(!!course.onSale);
  }

  const previewEl = document.getElementById("editCoursePreview");
  if (previewEl && course.image) {
    previewEl.src = course.image;
  }

  const imageInput = document.getElementById("editCourseImage");
  if (imageInput) imageInput.value = "";

  const modal = document.getElementById("editCourseModal");
  modal.classList.remove("hidden", "opacity-0");
  modal.classList.add("opacity-100", "transition-opacity", "duration-300");
}

export function closeEditCourseModal() {
  const titleEl = document.getElementById("editCourseTitle");
  const descEl = document.getElementById("editCourseDescription");

  const hasChanges =
    titleEl.value !== titleEl.dataset.original ||
    descEl.value !== descEl.dataset.original;

  if (hasChanges) {
    const confirmClose = confirm("You have unsaved changes. Close without saving?");
    if (!confirmClose) return;
  }

  const modal = document.getElementById("editCourseModal");
  modal.classList.remove("opacity-100");
  modal.classList.add("opacity-0");

  setTimeout(() => {
    modal.classList.add("hidden");
  }, 300);
}

export async function saveEditedCourse() {
  const courseId = document.getElementById("editCourseId").value;
  if (!courseId) return;

  const title = document.getElementById("editCourseTitle").value.trim();
  const description = document.getElementById("editCourseDescription").value.trim();
  const price = parseFloat(document.getElementById("editCoursePrice").value.trim());
  const salePrice = parseFloat(document.getElementById("editCourseSalePrice").value.trim()) || null;
  const onSale = document.getElementById("editCourseOnSale").checked;
  const shortDescription = document.getElementById("editCourseShortDescription").value.trim();
  const duration = document.getElementById("editCourseDuration").value.trim();
  const maxParticipants = parseInt(document.getElementById("editCourseMaxParticipants").value.trim(), 10) || null;
  const tags = document.getElementById("editCourseTags").value.trim().split(",").map((tag) => tag.trim()).filter(Boolean);
  const features = document.getElementById("editCourseFeatures").value.trim().split(",").map((f) => f.trim()).filter(Boolean);
  const visible = document.getElementById("editCourseVisible").checked;

  let slug = document.getElementById("editCourseSlug").value.trim().toLowerCase();
  if (!slug) slug = generateSlug(title);

  if (!isSlugValid(slug)) {
    showToast("Slug contains invalid characters. Only lowercase letters, numbers, and hyphens allowed.", "error");
    return;
  }

  if (!title || !description || isNaN(price)) {
    showToast("Please complete all required fields correctly.", "error");
    return;
  }

  try {
    const slugQuery = query(collection(db, "products"), where("slug", "==", slug));
    const slugSnapshot = await getDocs(slugQuery);
    if (!slugSnapshot.empty && slugSnapshot.docs[0].id !== courseId) {
      showToast("A product with this slug already exists. Please choose another.", "error");
      return;
    }

    await updateDoc(doc(db, "courses", courseId), {
      title,
      description,
      price,
      salePrice,
      onSale,
      shortDescription,
      duration,
      maxParticipants,
      tags,
      features,
      visible,
      slug,
      updatedAt: serverTimestamp(),
      status: "pending",
    });

    closeEditCourseModal();
    loadMyCourses();
    showToast("✅ Course changes saved. Pending admin re-approval.", "success");
  } catch (err) {
    console.error("Error saving course:", err);
    showToast("Failed to update course.", "error");
  }
}

export function copyCourseReferralLink(courseId) {
  const user = auth.currentUser;
  if (!user) {
    showToast("Please login to generate your referral link.", "error");
    return;
  }

  const baseUrl = `${window.location.origin}/courses`;
  const refLink = `${baseUrl}?ref=${user.uid}&course=${courseId}`;
  navigator.clipboard.writeText(refLink)
    .then(() => showToast("Your referral link has been copied!", "success"))
    .catch(() => showToast("Failed to copy link.", "error"));
}

function renderSubmittedCourses() {
  loadMyCourses(); // or custom display logic if different
}

function setupCourseProposalForm() {
  const form = document.getElementById("courseProposalForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = {
      title: form["title"]?.value?.trim(),
      description: form["description"]?.value?.trim(),
      price: parseFloat(form["price"]?.value?.trim()),
    };

    if (!formData.title || !formData.description || isNaN(formData.price)) {
      showToast("Please fill in all required fields correctly.", "error");
      return;
    }

    await submitCourseProposal(formData);
    form.reset();
    loadMyCourses(); // or renderSubmittedCourses()
  });
}

export {
  renderSubmittedCourses,
  setupCourseProposalForm,
};
