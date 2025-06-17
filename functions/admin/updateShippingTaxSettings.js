
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
  async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can update settings.");
    }

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

    if (Object.keys(updateData).length === 0) {
      throw new HttpsError("invalid-argument", "No valid settings provided.");
    }

    try {
      await admin.firestore().collection("settings").doc("shop").set(updateData, { merge: true });
      return { success: true, updated: updateData };
    } catch (err) {
      console.error("Failed to update shop settings:", err);
      throw new HttpsError("internal", "Settings update failed.");
    }
  },
);
