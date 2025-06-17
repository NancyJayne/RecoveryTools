// Stripe payouts for affiliates
import { httpsCallable } from "firebase/functions";
import { functions } from "../utils/firebase-config.js";

const getPayouts = httpsCallable(functions, "getAffiliatePayouts");

/**
 * Load recent affiliate payouts (last 25)
 */
export async function loadAffiliatePayouts() {
  try {
    const res = await getPayouts();
    return res.data.payouts || [];
  } catch (err) {
    console.error("Failed to load payouts:", err);
    return [];
  }
}
