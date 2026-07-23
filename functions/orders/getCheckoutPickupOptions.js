import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { eligiblePickupLocations } from "./pickupLocations.js";

if (!admin.apps.length) admin.initializeApp();

export const getCheckoutPickupOptions = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    const cart = Array.isArray(request.data?.cart) ? request.data.cart : [];
    if (!cart.length || cart.length > 50) {
      throw new HttpsError("invalid-argument", "A valid cart is required.");
    }
    const referrerId = String(request.data?.referrerId || "").trim();
    const db = admin.firestore();
    const pickupItems = cart.filter((item) => item?.physicalFulfilment === "pickup");
    const results = await Promise.all(pickupItems.map(async (item) => ({
      key: `${String(item.id || "").trim()}:${String(item.variantId || "").trim()}`,
      productId: String(item.id || "").trim(),
      variantId: String(item.variantId || "").trim(),
      options: await eligiblePickupLocations(db, {
        productId: item.id,
        variantId: item.variantId,
        referrerId,
      }),
    })));
    return { items: results };
  },
);
