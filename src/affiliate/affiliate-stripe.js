// affiliate-stripe.js – Handles Stripe connect/login logic
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";
import { doc, getDoc } from "firebase/firestore";

export async function createStripeConnectLink() {
  const call = httpsCallable(functions, "createStripeConnectLink");
  try {
    const res = await call();
    return res.data.url;
  } catch (err) {
    console.error("Stripe connect error:", err);
    return null;
  }
}

export async function createStripeLoginLink() {
  const call = httpsCallable(functions, "createStripeLoginLink");
  try {
    const res = await call();
    return res.data.url;
  } catch (err) {
    console.error("Stripe login error:", err);
    return null;
  }
}

export async function setupStripeButtons() {
  const stripeBtn = document.getElementById("connectStripeBtn");
  const manageBtn = document.getElementById("manageStripeBtn");

  try {
    const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
    const stripeAccountId = userDoc.data()?.stripeAccountId;

    if (stripeAccountId) {
      stripeBtn?.classList.add("hidden");
      document.getElementById("stripeConnectedMsg")?.classList.remove("hidden");
      manageBtn?.classList.remove("hidden");

      manageBtn?.addEventListener("click", async () => {
        try {
          const result = await createStripeLoginLink();
          if (result) window.location.href = result;
        } catch (err) {
          console.error("Login link error:", err);
          showToast("Unable to open Stripe dashboard.", "error");
        }
      });
    } else {
      stripeBtn?.addEventListener("click", async () => {
        try {
          const result = await createStripeConnectLink();
          if (result) window.location.href = result;
        } catch (err) {
          console.error("Stripe Connect Error:", err);
          showToast("Could not initiate onboarding.", "error");
        }
      });
    }
  } catch (err) {
    console.error("Error checking Stripe status:", err);
    showToast("Error loading Stripe settings.", "error");
  }
}
