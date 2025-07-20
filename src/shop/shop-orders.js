// Store orders, create receipts
import { functions } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";

export async function confirmOrderFromStripeRedirect() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("success") !== "true") return;

  try {
    const confirmPurchase = functions.httpsCallable("confirmStripePurchase");
    const res = await confirmPurchase();

    if (res.data && res.data.orderId) {
      showToast("✅ Order confirmed. A receipt has been emailed to you.", "success");
      localStorage.removeItem("recovery_cart");

      // Optionally redirect to confirmation screen
      document.getElementById("orderConfirmationSection")?.classList.remove("hidden");
      document.getElementById("mainContent")?.classList.add("hidden");

      // You can also populate confirmation UI with res.data.order if needed
      return res.data;
    } else {
      throw new Error("Order confirmation failed.");
    }
  } catch (err) {
    console.error("Order confirmation error:", err);
    showToast("⚠ Something went wrong confirming your order.", "error");
  }
}

export default function () {
  confirmOrderFromStripeRedirect();
}