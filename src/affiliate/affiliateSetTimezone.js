// affiliateSetTimezone.js
import { auth, db } from "../utils/firebase-config.js";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { showToast } from "../utils/utils.js";
import { populateTimezoneDropdown, detectUserTimezone } from "../utils/date-utils.js";

export async function setupAffiliateTimezoneSettings() {
  const selectEl = document.getElementById("affiliateTimezone");
  const displayEl = document.getElementById("currentTimezoneDisplay");

  if (!selectEl || !displayEl) return;

  // Populate timezone options
  populateTimezoneDropdown(selectEl);

  const user = auth.currentUser;
  if (!user) return;

  const docRef = doc(db, "affiliates", user.uid);
  const snapshot = await getDoc(docRef);
  const data = snapshot.exists() ? snapshot.data() : {};
  const currentTZ = data.timezone || detectUserTimezone();

  selectEl.value = currentTZ;
  displayEl.textContent = `Current timezone: ${currentTZ}`;
  displayEl.classList.remove("hidden");

  selectEl.addEventListener("change", async (e) => {
    const selectedTZ = e.target.value;
    try {
      await updateDoc(docRef, { timezone: selectedTZ });
      displayEl.textContent = `Current timezone: ${selectedTZ}`;
      showToast("Timezone updated successfully.", "success");
    } catch (err) {
      console.error("Failed to update timezone:", err);
      showToast("Error updating timezone.", "error");
    }
  });
}