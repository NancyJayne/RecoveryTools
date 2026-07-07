// Store orders, create receipts
import { functions } from "../utils/firebase-config.js";
import { httpsCallable } from "firebase/functions";
import { showToast } from "../utils/utils.js";

export async function confirmOrderFromStripeRedirect() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");

  if (params.get("success") !== "true") return null;
  if (!sessionId) {
    throw new Error("Missing Stripe checkout session ID.");
  }

  try {
    const confirmPurchase = httpsCallable(functions, "confirmStripePurchase");
    const res = await confirmPurchase({ sessionId });
    const order = res.data?.order || res.data;

    if (order?.orderId || order?.invoiceId || order?.stripeCheckoutSessionId) {
      showToast("Order confirmed. A receipt has been emailed to you.", "success");
      localStorage.removeItem("recovery_cart");
      sessionStorage.removeItem("cartBackup");

      document.getElementById("orderConfirmationSection")?.classList.remove("hidden");
      document.getElementById("mainContent")?.classList.add("hidden");

      return order;
    }

    throw new Error("Order confirmation failed.");
  } catch (err) {
    console.error("Order confirmation error:", err);
    showToast("Something went wrong confirming your order.", "error");
    throw err;
  }
}

export default function () {
  confirmOrderFromStripeRedirect();
}
