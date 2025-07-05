// affiliate-workshops.js – Handles workshop submission and loading
import {
  collection,
  query,
  addDoc,
  where,
  getDocs,
  updateDoc,
  doc,
  Timestamp,
  serverTimestamp,
  deleteDoc,
} from "firebase/firestore";
import { auth, db } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";
import { generateSlug, validateSlug as isSlugValid } from "./affiliate-utils.js";
import { detectUserTimezone, convertToUTC, formatLocalTime } from "../utils/date-utils.js";

export function initAffiliateWorkshopSubmission() {
  setupWorkshopForm();
  renderSubmittedWorkshops();
  setupWorkshopModals();
}

export async function renderSubmittedWorkshops() {
  const container = document.getElementById("submittedWorkshops");
  container.innerHTML = "<p class='text-gray-400'>Loading...</p>";

  try {
    const q = query(
      collection(db, "products"),
      where("type", "==", "Workshop"),
      where("creatorId", "==", auth?.currentUser?.uid),
      orderBy("createdAt", "desc"),
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      container.innerHTML = "<p class='text-gray-400'>No workshops submitted yet.</p>";
      return;
    }

    container.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const id = docSnap.id;
      const formattedDate = formatLocalTime(data.dateUTC, data.timezone);

      const card = document.createElement("div");
      card.className = "p-4 border border-gray-700 rounded mb-4";
      card.innerHTML = `
        <div class="flex justify-between items-center">
          <div>
            <h3 class="text-white font-semibold text-lg">${data.title}</h3>
            <p class="text-sm text-gray-400">${formattedDate} (${data.timezone})</p>
            <p class="text-sm text-gray-500">${data.location || "No location"}</p>
          </div>
          <div class="flex gap-2">
            <button
  class="editWorkshopBtn bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded"
  data-id="${id}"
>
  Edit
</button>

<button
  class="deleteWorkshopBtn bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded"
  data-id="${id}"
>
  Delete
</button>
          </div>
        </div>
      `;

      container.appendChild(card);
    });

    // Attach button listeners
    container.querySelectorAll(".editWorkshopBtn").forEach((btn) => {
      btn.addEventListener("click", () => openEditWorkshopModal(btn.dataset.id));
    });
    container.querySelectorAll(".deleteWorkshopBtn").forEach((btn) => {
      btn.addEventListener("click", () => deleteWorkshop(btn.dataset.id));
    });
  } catch (error) {
    console.error("Error loading workshops:", error);
    container.innerHTML = "<p class='text-red-500'>Failed to load workshops.</p>";
  }
}

export async function setupWorkshopForm() {
  const form = document.getElementById("workshopForm");
  if (!form) return;

  const timezoneInput = form.querySelector("#workshopTimezone");
  if (timezoneInput) {
    timezoneInput.value = detectUserTimezone();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const title = formData.get("title").trim();
    const dateInput = formData.get("date").trim();
    const timezone = formData.get("timezone");
    const location = formData.get("location").trim();

    const dateUTC = convertToUTC(dateInput, timezone);

    const newWorkshop = {
      title,
      location,
      dateLocal: dateInput,
      dateUTC,
      timezone,
      createdBy: auth?.currentUser?.uid,
      createdAt: serverTimestamp(),
      visible: false,
    };

    await addDoc(collection(db, "products"), newWorkshop);
    showToast("Workshop submitted for review.", "success");
    form.reset();
    document.getElementById("addWorkshopModal").classList.add("hidden");
    renderSubmittedWorkshops();
  });
}

function setupWorkshopModals() {
  const modal = document.getElementById("editWorkshopModal");
  const cancelBtn = document.getElementById("cancelEditWorkshopBtn");
  const deleteBtn = document.getElementById("deleteEditWorkshopBtn");

  cancelBtn?.addEventListener("click", () => {
    modal.classList.add("hidden");
    modal.classList.remove("opacity-100");
  });

  deleteBtn?.addEventListener("click", async () => {
    const workshopId = document.getElementById("editWorkshopId").value;
    if (workshopId && confirm("Are you sure you want to delete this workshop?")) {
      await deleteWorkshop(workshopId);
      modal.classList.add("hidden");
      renderSubmittedWorkshops();
    }
  });
}

export async function deleteWorkshop(workshopId) {
  if (!confirm("Are you sure you want to delete this workshop?")) return;

  try {
    await deleteDoc(doc(db, "products", workshopId));
    showToast("Workshop deleted successfully.", "success");
    renderSubmittedWorkshops();
    document.getElementById("editWorkshopModal").classList.add("hidden");
  } catch (err) {
    console.error("Failed to delete workshop:", err);
    showToast("Failed to delete workshop.", "error");
  }
}

// Handle workshop form submission
export async function submitAffiliateWorkshop(formData) {
  try {
    const uid = auth?.currentUser?.uid;
    if (!uid) throw new Error("User not authenticated");

    await addDoc(collection(db, "workshops"), {
      ...formData,
      creatorId: uid,
      createdAt: new Date(),
      type: "Workshop",
    });

    showToast("✅ Workshop submitted for review", "success");
  } catch (err) {
    console.error("Submit workshop error:", err);
    showToast("Error submitting workshop.", "error");
  }
}

// Load submitted workshops
export async function loadAffiliateWorkshops() {
  const uid = auth?.currentUser?.uid;
  if (!uid) return [];

  const q = query(collection(db, "workshops"), where("creatorId", "==", uid));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

// ========== Workshop Modal Controls ==========
document.getElementById("submitWorkshopForm")?.addEventListener("submit", submitWorkshop);
  
document.getElementById("cancelEditWorkshopBtn")?.addEventListener("click", closeEditWorkshopModal);
  
document.getElementById("saveEditWorkshopBtn")?.addEventListener("click", (e) => {
  e.preventDefault();
  saveEditedWorkshop();
});
  
document.getElementById("deleteEditWorkshopBtn")?.addEventListener("click", async () => {
  const confirmDelete = confirm("Are you sure you want to delete this workshop?");
  if (!confirmDelete) return;
  
  const workshopId = document.getElementById("editWorkshopId")?.value;
  if (!workshopId) return;
  
  try {
    await deleteDoc(doc(db, "workshops", workshopId));
    showToast("Workshop deleted successfully", "success");
    closeEditWorkshopModal();
    loadMyWorkshops();
  } catch (error) {
    console.error("Failed to delete workshop:", error);
    showToast("Error deleting workshop", "error");
  }
});
  
export async function submitWorkshop(e) {
  e.preventDefault();

  const user = auth?.currentUser;
  if (!user) {
    showToast("Please log in first.", "error");
    return;
  }

  const name = document.getElementById("workshopName").value.trim();
  const location = document.getElementById("workshopLocation").value.trim();
  const date = document.getElementById("workshopDate").value;
  const price = parseInt(document.getElementById("workshopPrice").value.trim(), 10);
  const description = document.getElementById("workshopDescription").value.trim();
  const maxParticipants = parseInt(document.getElementById("workshopStock")?.value || "0", 10) || null;
  const imageFile = document.getElementById("workshopImageFile").files[0];

  if (!name || !location || !date || isNaN(price) || !description || !imageFile) {
    showToast("Please complete all required fields.", "error");
    return;
  }

  const img = new Image();
  img.src = URL.createObjectURL(imageFile);

  img.onload = async function () {
    if (img.width > 600 || img.height > 400) {
      showToast("Image must be no larger than 600x400 pixels.", "error");
      return;
    }

    try {
      const filePath = `workshops/${user.uid}_${Date.now()}.jpg`;
      const imageRef = storageRef(storage, filePath);
      await uploadBytes(imageRef, imageFile);
      const imageUrl = await getDownloadURL(imageRef);

      const docRef = await addDoc(collection(db, "workshops"), {
        name,
        location,
        description,
        price,
        date: Timestamp.fromDate(new Date(date)),
        maxParticipants,
        image: imageUrl,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        status: "pending",
        approved: false,
        tags: ["submitted"],
      });

      console.log("Workshop submitted with ID:", docRef.id);
      // or optionally show it in a toast
      // showToast(`Workshop submitted! ID: ${docRef.id}`, "success");


      showToast("Workshop submitted for approval!", "success");
      document.getElementById("submitWorkshopForm").reset();
      loadMyWorkshops?.();

    } catch (error) {
      console.error("Workshop submission error:", error);
      showToast("Failed to submit workshop.", "error");
    }
  };
}

  
export async function loadMyWorkshops() {
  const user = auth?.currentUser;
  if (!user) return;

  const grid = document.getElementById("mySubmittedWorkshops");
  if (!grid) return;

  grid.innerHTML = `
    <div class="flex justify-center items-center min-h-[100px]">
      <div class="w-8 h-8 border-4 border-t-transparent border-green-400 rounded-full animate-spin"></div>
    </div>
  `;

  try {
    const snapshot = await db.collection("workshops").where("createdBy", "==", user.uid).get();
    const workshops = snapshot.docs.map((doc) => ({
      id: doc.id,
      slug: generateSlug(doc.data().name),
      ...doc.data(),
    }));

    grid.innerHTML = "";

    if (workshops.length === 0) {
      grid.innerHTML = `<p class="text-gray-400">No workshops submitted yet.</p>`;
      return;
    }

    workshops.forEach((workshop) => {
      const tile = document.createElement("div");
      tile.className = "bg-gray-800 rounded-lg p-4 shadow relative";

      const img = document.createElement("img");
      img.src = workshop.image || "https://via.placeholder.com/600x400";
      img.className = "w-full h-32 object-cover rounded mb-3";

      const name = document.createElement("h3");
      name.textContent = workshop.name;
      name.className = "text-lg font-semibold mb-2";

      if (workshop.status !== "approved") {
        const pendingBadge = document.createElement("span");
        pendingBadge.textContent = "Pending Review";
        pendingBadge.className =
          "ml-2 inline-block bg-yellow-400 text-black text-xs px-2 py-1 rounded-full " +
          "align-middle";
        name.appendChild(pendingBadge);
      }

      const date = document.createElement("p");
      date.textContent = `📅 ${new Date(workshop.date.seconds * 1000).toLocaleDateString()}`;
      date.className = "text-gray-400 text-sm";

      const status = document.createElement("p");
      status.textContent = `Status: ${workshop.status || "pending"}`;
      status.className = "text-xs text-yellow-400 mt-2";

      const slug = document.createElement("p");
      slug.textContent = `🔗 /products/${workshop.slug || generateSlug(workshop.name)}`;
      slug.className = "text-xs text-gray-500 mt-1";

      const btnGroup = document.createElement("div");
      btnGroup.className = "flex flex-wrap gap-2 mt-4";

      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit";
      editBtn.className = "bg-blue-600 px-3 py-1 rounded text-white text-sm hover:bg-blue-700";
      editBtn.addEventListener("click", () => openEditWorkshopModal(workshop));

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Delete";
      deleteBtn.className = "bg-red-600 px-3 py-1 rounded text-white text-sm hover:bg-red-700";
      deleteBtn.addEventListener("click", () => deleteWorkshop(workshop.id));

      const referralBtn = document.createElement("button");
      referralBtn.textContent = "Copy Referral Link";
      referralBtn.className = "bg-green-600 px-3 py-1 rounded text-white text-sm hover:bg-green-700";
      referralBtn.addEventListener("click", () => copyReferralLink(workshop.id));

      btnGroup.append(editBtn, deleteBtn, referralBtn);
      tile.append(img, name, date, status, slug, btnGroup);
      grid.appendChild(tile);
    });

  } catch (error) {
    console.error("Error loading submitted workshops:", error);
    showToast("Failed to load your workshops.", "error");
  }
}

export function openEditWorkshopModal(workshop) {
  document.getElementById("editWorkshopId").value = workshop.id;

  // Main fields
  document.getElementById("editWorkshopName").value = workshop.name || "";
  document.getElementById("editWorkshopName").dataset.original = workshop.name || "";

  document.getElementById("editWorkshopLocation").value = workshop.location || "";
  document.getElementById("editWorkshopLocation").dataset.original = workshop.location || "";

  const formattedDate = new Date(workshop.date.seconds * 1000).toISOString().substr(0, 10);
  document.getElementById("editWorkshopDate").value = formattedDate;
  document.getElementById("editWorkshopDate").dataset.original = formattedDate;

  document.getElementById("editWorkshopPrice").value = workshop.price || "";
  document.getElementById("editWorkshopPrice").dataset.original = workshop.price || "";

  document.getElementById("editWorkshopDescription").value = workshop.description || "";
  document.getElementById("editWorkshopDescription").dataset.original = workshop.description || "";

  // Extended fields
  document.getElementById("editWorkshopSlug").value = workshop.slug || "";
  document.getElementById("editWorkshopSlug").dataset.original = workshop.slug || "";

  document.getElementById("editWorkshopShortDescription").value = workshop.shortDescription || "";
  document.getElementById("editWorkshopShortDescription").dataset.original = workshop.shortDescription || "";

  document.getElementById("editWorkshopDuration").value = workshop.duration || "";
  document.getElementById("editWorkshopDuration").dataset.original = workshop.duration || "";

  document.getElementById("editWorkshopMaxParticipants").value = workshop.maxParticipants || "";
  document.getElementById("editWorkshopMaxParticipants").dataset.original = workshop.maxParticipants || "";

  document.getElementById("editWorkshopFeatures").value = (workshop.features || []).join(", ");
  document.getElementById("editWorkshopFeatures").dataset.original = (workshop.features || []).join(", ");

  // Image preview
  document.getElementById("editWorkshopImage").value = "";
  document.getElementById("editWorkshopPreview").src = workshop.image || "https://via.placeholder.com/600x400";

  // Show modal
  const modal = document.getElementById("editWorkshopModal");
  modal.classList.remove("hidden", "opacity-0");
  modal.classList.add("opacity-100", "transition-opacity", "duration-300");
}

  
  
export async function saveEditedWorkshop() {
  const editingWorkshopId = document.getElementById("editWorkshopId").value;
  if (!editingWorkshopId) return;

  const name = document.getElementById("editWorkshopName").value.trim();
  const location = document.getElementById("editWorkshopLocation").value.trim();
  const date = document.getElementById("editWorkshopDate").value;
  const price = parseFloat(document.getElementById("editWorkshopPrice").value.trim());
  const description = document.getElementById("editWorkshopDescription").value.trim();
  const slugInput = document.getElementById("editWorkshopSlug").value.trim().toLowerCase();
  const shortDescription = document.getElementById("editWorkshopShortDescription").value.trim();
  const duration = document.getElementById("editWorkshopDuration").value.trim();
  const maxParticipants = parseInt(document.getElementById("editWorkshopMaxParticipants").value.trim(), 10) || null;
  const featuresRaw = document.getElementById("editWorkshopFeatures").value.trim();

  if (!name || !location || !date || isNaN(price) || !description) {
    showToast("Please fill in all required fields.", "error");
    return;
  }

  // Generate or validate slug
  const slug = slugInput || generateSlug(name);
  if (!isSlugValid(slug)) {
    showToast("Slug must only contain lowercase letters, numbers, and hyphens.", "error");
    return;
  }

  // Check for slug conflicts in products (not workshops)
  const slugQuery = query(collection(db, "products"), where("slug", "==", slug));
  const slugSnapshot = await getDocs(slugQuery);
  const isDuplicate = !slugSnapshot.empty && slugSnapshot.docs[0].id !== editingWorkshopId;
  if (isDuplicate) {
    showToast("This slug is already used by another product. Please update it.", "error");
    return;
  }

  const features = featuresRaw
    ? featuresRaw.split(",").map((f) => f.trim()).filter(Boolean)
    : [];

  try {
    const workshopDocRef = doc(db, "workshops", editingWorkshopId);
    await updateDoc(workshopDocRef, {
      name,
      location,
      price,
      description,
      shortDescription,
      duration,
      maxParticipants,
      features,
      slug,
      date: Timestamp.fromDate(new Date(date)),
      updatedAt: serverTimestamp(),
    });

    showToast("Workshop updated successfully!", "success");
    closeEditWorkshopModal();
    loadMyWorkshops();
    loadWorkshops?.(); // optional: public view reload
  } catch (error) {
    console.error("Error updating workshop:", error);
    showToast("Failed to update workshop.", "error");
  }
}

  
export function copyReferralLink(workshopId) {
  const user = auth?.currentUser;
  if (!user) {
    showToast("Please login to generate your referral link.", "error");
    return;
  }
  
  const refLink = `${window.location.origin}/workshops?ref=${user.uid}&event=${workshopId}`;
  navigator.clipboard.writeText(refLink)
    .then(() => showToast("Your referral link has been copied!", "success"))
    .catch(() => showToast("Failed to copy link.", "error"));
}

export function closeEditWorkshopModal() {
  const hasChanges = [
    "editWorkshopName",
    "editWorkshopLocation",
    "editWorkshopDate",
    "editWorkshopPrice",
    "editWorkshopDescription",
  ].some((id) => {
    const el = document.getElementById(id);
    return el.value !== el.dataset.original;
  });

  if (hasChanges) {
    const confirmClose = confirm("You have unsaved changes. Close without saving?");
    if (!confirmClose) return;
  }

  const modal = document.getElementById("editWorkshopModal");
  modal.classList.remove("opacity-100");
  modal.classList.add("opacity-0");
  setTimeout(() => {
    modal.classList.add("hidden");
  }, 300);
}



