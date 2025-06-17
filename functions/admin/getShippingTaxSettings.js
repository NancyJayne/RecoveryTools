import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const getShippingTaxSettings = onCall(
  { region: "australia-southeast1" },
  async () => {
    try {
      const doc = await admin.firestore().collection("settings").doc("shop").get();

      if (!doc.exists) {
        console.error("❌ settings/shop document not found.");
        throw new HttpsError("not-found", "Shop settings not configured.");
      }

      const data = doc.data();
      console.log("✅ Shop settings loaded:", data);

      return {
        gstRate: data.gstRate ?? 0.1,
        includeGST: data.includeGST ?? true,
        shippingZones: data.shippingZones || [],
        freeShippingMin: data.freeShippingMin || 0,
        handlingDays: data.handlingDays || 1,
        returnDays: data.returnDays || 30,
        allowReturns: data.allowReturns ?? true,
        returnInstructions: data.returnInstructions || "",
        shippingPolicy: data.shippingPolicy || "",
      };
    } catch (err) {
      console.error("Failed to load shop settings:", err);
      throw new HttpsError("internal", "Could not load shop configuration.");
    }
  },
);
