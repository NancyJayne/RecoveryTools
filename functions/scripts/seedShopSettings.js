// Ensure environment variables are set (for emulator)
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "recovery-tools";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";

import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp(); // ✅ No credentials needed for emulator
}

const db = admin.firestore();

async function seedShopSettings() {
  const shopDoc = db.collection("settings").doc("shop");

  const data = {
    gstRate: 0.1,
    includeGST: true,
    freeShippingMin: 150,
    handlingDays: 3,
    returnDays: 30,
    allowReturns: true,
    returnInstructions: "Please contact us via email for returns.",
    shippingPolicy: "Free shipping on orders over $150.",
    shippingZones: [
      {
        region: "AU",
        label: "Standard AU Shipping",
        rate: 12,
        currency: "AUD",
        default: true,
      },
    ],
  };

  try {
    await shopDoc.set(data, { merge: true });
    console.log("✅ Shop settings seeded successfully.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed to seed shop settings:", err);
    process.exit(1);
  }
}

seedShopSettings();
