
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 🛠️ Admin: Update shipping and tax settings
 */
export const updateShippingTaxSettings = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError(
        "permission-denied",
        "Only admins can update settings.",
      );
    }

    const data = request.data || {};

    const allowedFields = [
      "gstRate",
      "includeGST",
      "shippingZones",
      "freeShippingMin",
      "handlingDays",
      "returnDays",
      "allowReturns",
      "returnInstructions",
      "shippingPolicy",
    ];

    const updateData = {};

    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        updateData[key] = data[key];
      }
    }

    if (updateData.freeShippingMin !== undefined) {
      const freeShippingMin = Number(updateData.freeShippingMin);
      if (!Number.isFinite(freeShippingMin) || freeShippingMin < 0) {
        throw new HttpsError("invalid-argument", "Free shipping threshold must be zero or more.");
      }
      updateData.freeShippingMin = freeShippingMin;
    }

    if (updateData.shippingZones !== undefined) {
      if (!Array.isArray(updateData.shippingZones) || updateData.shippingZones.length !== 1) {
        throw new HttpsError("invalid-argument", "Provide one Australian shipping rate.");
      }
      const zone = updateData.shippingZones[0] || {};
      const rate = Number(zone.rate);
      if (!Number.isFinite(rate) || rate < 0) {
        throw new HttpsError("invalid-argument", "Shipping cost must be zero or more.");
      }
      updateData.shippingZones = [{
        region: "AU",
        label: String(zone.label || "Standard Australian shipping").trim(),
        rate,
        currency: "AUD",
        default: true,
      }];
    }

    if (Object.keys(updateData).length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "No valid settings provided.",
      );
    }

    try {
      await admin
        .firestore()
        .collection("settings")
        .doc("shop")
        .set(updateData, { merge: true });

      return {
        success: true,
        updated: updateData,
      };
    } catch (err) {
      console.error("Failed to update shop settings:", err);
      throw new HttpsError(
        "internal",
        "Settings update failed.",
      );
    }
  },
);
