import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";
import { doc, getDoc } from "firebase/firestore";

function stripeErrorMessage(error, fallback) {
  const message = String(error?.message || "").replace(/^Firebase:\s*/i, "").trim();
  return message || fallback;
}

function setStripeStatus(message, tone = "neutral") {
  const status = document.getElementById("stripeConnectionStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `mt-2 text-sm ${
    tone === "error"
      ? "text-red-400"
      : tone === "success" ? "text-green-400" : "text-gray-400"
  }`;
}

export async function createStripeConnectLink() {
  const call = httpsCallable(functions, "createStripeConnectLink");
  const response = await call();
  if (!response.data?.url) throw new Error("Stripe did not return an onboarding link.");
  return response.data.url;
}

export async function createStripeLoginLink() {
  const call = httpsCallable(functions, "createStripeLoginLink");
  const response = await call();
  if (!response.data?.url) throw new Error("Stripe did not return a dashboard link.");
  return response.data.url;
}

export async function setupStripeButtons() {
  const stripeBtn = document.getElementById("connectStripeBtn");
  const manageBtn = document.getElementById("manageStripeBtn");
  const connectedMessage = document.getElementById("stripeConnectedMsg");
  const user = auth?.currentUser;
  if (!stripeBtn || !manageBtn || !user) return;

  stripeBtn.onclick = null;
  manageBtn.onclick = null;
  stripeBtn.disabled = false;
  manageBtn.disabled = false;

  try {
    const [userDoc, affiliateDoc] = await Promise.all([
      getDoc(doc(db, "users", user.uid)),
      getDoc(doc(db, "affiliates", user.uid)),
    ]);
    const stripeAccountId =
      userDoc.data()?.stripeAccountId || affiliateDoc.data()?.stripeAccountId;

    stripeBtn.classList.toggle("hidden", Boolean(stripeAccountId));
    connectedMessage?.classList.toggle("hidden", !stripeAccountId);
    manageBtn.classList.toggle("hidden", !stripeAccountId);
    setStripeStatus(
      stripeAccountId
        ? "Stripe account created. Use Manage Stripe to review your payout account."
        : "Connect Stripe to receive affiliate payouts.",
      stripeAccountId ? "success" : "neutral",
    );

    stripeBtn.onclick = async () => {
      stripeBtn.disabled = true;
      const originalText = stripeBtn.textContent;
      stripeBtn.textContent = "Opening Stripe...";
      setStripeStatus("Creating your secure Stripe onboarding link...");
      try {
        window.location.assign(await createStripeConnectLink());
      } catch (error) {
        console.error("Stripe Connect error:", error);
        const message = stripeErrorMessage(error, "Could not initiate Stripe onboarding.");
        setStripeStatus(message, "error");
        showToast(message, "error");
        stripeBtn.disabled = false;
        stripeBtn.textContent = originalText;
      }
    };

    manageBtn.onclick = async () => {
      manageBtn.disabled = true;
      const originalText = manageBtn.textContent;
      manageBtn.textContent = "Opening Stripe...";
      try {
        window.location.assign(await createStripeLoginLink());
      } catch (error) {
        console.error("Stripe login link error:", error);
        const message = stripeErrorMessage(error, "Unable to open the Stripe dashboard.");
        setStripeStatus(message, "error");
        showToast(message, "error");
        manageBtn.disabled = false;
        manageBtn.textContent = originalText;
      }
    };
  } catch (error) {
    console.error("Error checking Stripe status:", error);
    setStripeStatus("Stripe settings could not be loaded. Please refresh and try again.", "error");
  }
}
