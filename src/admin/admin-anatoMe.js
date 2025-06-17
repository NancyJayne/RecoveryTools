// admin-anatoMe.js // Controls Anato-Me episode creation, editing, and deletion
import { db } from "../utils/firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { showToast } from "../utils/utils.js";

export function setupAnatoMeEpisodeAdminForm() {
  const form = document.getElementById("episodeForm");
  const select = document.getElementById("episodeSelect");
  const deleteBtn = document.getElementById("deleteEpisodeBtn");
  if (!form || !select || !deleteBtn) return;

  populateEpisodeDropdown();

  select.addEventListener("change", async () => {
    const docSnap = await getDoc(doc(db, "episodes", select.value));
    if (!docSnap.exists()) return;
    const data = docSnap.data();
    document.getElementById("slug").value = select.value;
    document.getElementById("title").value = data.title || "";
    document.getElementById("videoUrl").value = data.videoUrl || "";
    document.getElementById("thumbnail").value = data.thumbnail || "";
    document.getElementById("tags").value = data.tags || "";
    document.getElementById("category").value = data.category || "";
    document.getElementById("storyClean").value = data.storyClean || "";
    document.getElementById("storyRated").value = data.storyRated || "";
    document.getElementById("reflectionPrompts").value = data.reflectionPrompts || "";
    document.getElementById("relatedProducts").value = data.relatedProducts || "";
    document.getElementById("condition").value = data.clinicalCompanion?.condition || "";
    document.getElementById("clinicalTips").value = data.clinicalCompanion?.clinicalTips || "";
    document.getElementById("treatmentSuggestions").value = data.clinicalCompanion?.treatmentSuggestions || "";
    document.getElementById("educationalUse").value = data.clinicalCompanion?.educationalUse || "";
    document.getElementById("publicVisible").checked = !!data.publicVisible;
    document.getElementById("therapistVisible").checked = !!data.therapistVisible;
    document.getElementById("isPublished").checked = !!data.isPublished;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const slug = document.getElementById("slug").value.trim(
      
    ) || document.getElementById("title").value.trim(

    ).toLowerCase().replace(/\s+/g, "-");
    const payload = {
      title: document.getElementById("title").value,
      videoUrl: document.getElementById("videoUrl").value,
      thumbnail: document.getElementById("thumbnail").value,
      tags: document.getElementById("tags").value,
      category: document.getElementById("category").value,
      storyClean: document.getElementById("storyClean").value,
      storyRated: document.getElementById("storyRated").value,
      reflectionPrompts: document.getElementById("reflectionPrompts").value,
      relatedProducts: document.getElementById("relatedProducts").value,
      clinicalCompanion: {
        condition: document.getElementById("condition").value,
        clinicalTips: document.getElementById("clinicalTips").value,
        treatmentSuggestions: document.getElementById("treatmentSuggestions").value,
        educationalUse: document.getElementById("educationalUse").value,
      },
      publicVisible: document.getElementById("publicVisible").checked,
      therapistVisible: document.getElementById("therapistVisible").checked,
      isPublished: document.getElementById("isPublished").checked,
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, "episodes", slug), payload);
      showToast("Episode saved", "success");
      populateEpisodeDropdown();
    } catch (err) {
      console.error("Error saving episode:", err);
      showToast("Failed to save episode", "error");
    }
  });

  deleteBtn.addEventListener("click", async () => {
    const slug = document.getElementById("slug").value;
    if (!slug) return showToast("No episode selected", "error");
    try {
      await deleteDoc(doc(db, "episodes", slug));
      showToast("Episode deleted", "success");
      populateEpisodeDropdown();
    } catch (err) {
      console.error("Error deleting episode:", err);
      showToast("Failed to delete episode", "error");
    }
  });
}

export async function populateEpisodeDropdown() {
  const select = document.getElementById("episodeSelect");
  if (!select) return;
  select.innerHTML = "";
  const snapshot = await getDocs(collection(db, "episodes"));
  snapshot.forEach((doc) => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.data().title;
    select.appendChild(opt);
  });
}
