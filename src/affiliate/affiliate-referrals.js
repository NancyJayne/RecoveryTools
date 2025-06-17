// affiliate-referrals.js – Handles referral logging and analytics
import { httpsCallable } from "firebase/functions";
import { functions } from "../utils/firebase-config.js";

const logReferral = httpsCallable(functions, "logReferralEvent");

export async function logReferralEvent({ referrerUid, type, targetId, event }) {
  try {
    const res = await logReferral({ referrerUid, type, targetId, event });
    return res.data;
  } catch (err) {
    console.error("Referral log failed:", err);
    return { success: false };
  }
}

export async function fetchReferralStats() {
  const getStats = httpsCallable(functions, "getReferralStats");
  try {
    const res = await getStats();
    return res.data.stats;
  } catch (err) {
    console.error("Error fetching referral stats:", err);
    return null;
  }
}

export function handleReferralFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  const referrerId = urlParams.get("ref");
  const event = urlParams.get("event");

  if (referrerId) {
    localStorage.setItem("referrer_uid", referrerId);
  }
  if (event) {
    localStorage.setItem("ref_event", event);
  }
}
