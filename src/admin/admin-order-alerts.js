import { functions } from "../utils/firebase-config.js";
import { httpsCallable } from "firebase/functions";

function setBadge(count) {
  const badge = document.getElementById("adminOrderAlertBadge");
  if (!badge) return;

  if (!count) {
    badge.classList.add("hidden");
    badge.textContent = "0";
    return;
  }

  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.remove("hidden");
}

export async function refreshAdminOrderAlertBadge() {
  const badge = document.getElementById("adminOrderAlertBadge");
  if (!badge) return;

  try {
    const getAlerts = httpsCallable(functions, "getAdminOrderAlerts");
    const result = await getAlerts();
    setBadge(Number(result.data?.unassignedCount || 0));
  } catch (err) {
    console.warn("Failed to refresh admin order alerts:", err);
    setBadge(0);
  }
}

export function clearAdminOrderAlertBadge() {
  setBadge(0);
}
