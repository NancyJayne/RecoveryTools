// admin-delete.js – Enable delete buttons for admin panels

import { httpsCallable } from "firebase/functions";
import { functions } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";

const deleteProduct = httpsCallable(functions, "deleteProduct");
const deleteWorkshop = httpsCallable(functions, "deleteWorkshop");
const deleteCourse = httpsCallable(functions, "deleteCourse");

export function attachDeleteHandlers(containerId, type = "product") {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!id) return;

      const confirmed = confirm(`Are you sure you want to delete this ${type}? This cannot be undone.`);
      if (!confirmed) return;

      try {
        if (type === "product") {
          await deleteProduct({ id });
        } else if (type === "workshop") {
          await deleteWorkshop({ id });
        } else if (type === "course") {
          await deleteCourse({ id });
        }
        showToast(`✅ ${type.charAt(0).toUpperCase() + type.slice(1)} deleted`, "success");
        btn.closest(".card, .workshop-card, .bg-gray-800")?.remove();
      } catch (err) {
        console.error(`❌ Failed to delete ${type}:`, err);
        showToast(`❌ Failed to delete ${type}`, "error");
      }
    });
  });
}
