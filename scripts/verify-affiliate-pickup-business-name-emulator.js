import assert from "node:assert/strict";
import admin from "../functions/node_modules/firebase-admin/lib/index.js";
import { updateAffiliateBusinessProfile } from "../functions/affiliates/updateAffiliateBusinessProfile.js";
import { getCheckoutAffiliates } from "../functions/affiliates/getCheckoutAffiliates.js";
import { eligiblePickupLocations } from "../functions/orders/pickupLocations.js";

assert(process.env.FIRESTORE_EMULATOR_HOST, "Run this check through the Firestore emulator.");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "recovery-tools" });

const db = admin.firestore();
const suffix = Date.now();
const uid = `TEST-PICKUP-AFFILIATE-${suffix}`;
const productId = `TEST-PICKUP-PRODUCT-${suffix}`;
const variantId = `TEST-PICKUP-VARIANT-${suffix}`;
const locationId = `affiliate-${uid}`;
const request = { auth: { uid, token: { affiliate: true } } };
const address = {
  addressLine1: "1 Test Street",
  addressLine2: "",
  suburb: "Maleny",
  state: "QLD",
  postcode: "4552",
  country: "Australia",
};

async function main() {
  try {
    await db.collection("users").doc(uid).set({
      roles: { affiliate: true },
      name: "Personal Name Must Not Display",
    });
    await db.collection("affiliates").doc(uid).set({
      userId: uid,
      status: "active",
      active: true,
      businessName: "Recovery Partner Studio",
    });
    await db.collection("products").doc(productId).set({ name: "Pickup test", status: "active" });
    await db.collection("productVariants").doc(variantId).set({ productId, status: "active" });

    await assert.rejects(
      updateAffiliateBusinessProfile.run({
        ...request,
        data: {
          businessName: "Recovery Partner Studio",
          pickupEnabled: true,
          locationName: "",
          pickupLocation: address,
        },
      }),
      (error) => error?.code === "invalid-argument",
      "Pickup was accepted without a customer-facing business name.",
    );

    await updateAffiliateBusinessProfile.run({
      ...request,
      data: {
        businessName: "Recovery Partner Studio",
        pickupEnabled: true,
        locationName: "Recovery Partner Studio",
        pickupLocation: address,
      },
    });
    await Promise.all([
      db.collection("affiliates").doc(uid).set({
        pickupEnabled: true,
        pickupApprovalStatus: "approved",
      }, { merge: true }),
      db.collection("pickupLocations").doc(locationId).set({
        active: true,
        approvalStatus: "approved",
      }, { merge: true }),
    ]);

    const checkout = await getCheckoutAffiliates.run({ data: {} });
    const affiliate = checkout.affiliates.find((entry) => entry.affiliateId === uid);
    assert.equal(affiliate?.businessName, "Recovery Partner Studio");
    assert.equal(affiliate?.pickupLocation?.businessName, "Recovery Partner Studio");
    assert(!JSON.stringify(affiliate).includes("Personal Name Must Not Display"));

    const options = await eligiblePickupLocations(db, {
      productId,
      variantId,
      referrerId: uid,
    });
    assert.equal(options[0]?.businessName, "Recovery Partner Studio");
    assert.equal(options[0]?.address, "1 Test Street, Maleny, QLD, 4552, Australia");
    console.log("Affiliate pickup business-name verification passed.");
  } finally {
    await Promise.all([
      db.collection("users").doc(uid).delete(),
      db.collection("affiliates").doc(uid).delete(),
      db.collection("pickupLocations").doc(locationId).delete(),
      db.collection("products").doc(productId).delete(),
      db.collection("productVariants").doc(variantId).delete(),
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
