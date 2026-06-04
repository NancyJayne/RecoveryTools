import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const defaultShopSettings = {
  gstRate: 0.1,
  includeGST: true,
  shippingZones: [],
  freeShippingMin: 0,
  handlingDays: 1,
  returnDays: 30,
  allowReturns: true,
  returnInstructions: "",
  shippingPolicy: "",
};

export const getShippingTaxSettings = onCall(
  {
    region: "australia-southeast1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://recoverytools.au",
      "https://www.recoverytools.au",
    ],
  },
  async () => {
    try {
      const snapshot = await admin
        .firestore()
        .collection("settings")
        .doc("shop")
        .get();

      if (!snapshot.exists) {
        console.warn("⚠️ settings/shop document not found. Returning defaults.");
        return defaultShopSettings;
      }

      const data = snapshot.data() || {};

      return {
        gstRate: data.gstRate ?? defaultShopSettings.gstRate,
        includeGST: data.includeGST ?? defaultShopSettings.includeGST,
        shippingZones: data.shippingZones ?? defaultShopSettings.shippingZones,
        freeShippingMin: data.freeShippingMin ?? defaultShopSettings.freeShippingMin,
        handlingDays: data.handlingDays ?? defaultShopSettings.handlingDays,
        returnDays: data.returnDays ?? defaultShopSettings.returnDays,
        allowReturns: data.allowReturns ?? defaultShopSettings.allowReturns,
        returnInstructions:
          data.returnInstructions ?? defaultShopSettings.returnInstructions,
        shippingPolicy: data.shippingPolicy ?? defaultShopSettings.shippingPolicy,
      };
    } catch (err) {
      console.error("Failed to load shop settings:", err);

      if (err instanceof HttpsError) {
        throw err;
      }

      throw new HttpsError("internal", "Could not load shop configuration.");
    }
  },
);
