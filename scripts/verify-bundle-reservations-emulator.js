/* global process, console */
import assert from "node:assert/strict";
import admin from "../functions/node_modules/firebase-admin/lib/index.js";
import {
  createInventoryReservation,
  releaseInventoryReservation,
} from "../functions/orders/inventoryReservations.js";
import { loadProductArchitecture } from "../functions/utils/productArchitecture.js";
import { resolveBundleInventoryItems } from "../functions/utils/bundleInventory.js";

assert(process.env.FIRESTORE_EMULATOR_HOST, "Run this check through the Firestore emulator.");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "recovery-tools" });
const db = admin.firestore();
const suffix = Date.now();
const physicalProductId = `TEST-BUNDLE-PHYSICAL-${suffix}`;
const physicalVariantId = `TEST-BUNDLE-PV-${suffix}`;
const workshopProductId = `TEST-BUNDLE-WORKSHOP-${suffix}`;
const workshopVariantId = `TEST-BUNDLE-SESSION-${suffix}`;
const bundleProductId = `TEST-BUNDLE-${suffix}`;
const bundleVariantId = `TEST-BUNDLE-VARIANT-${suffix}`;
const reservationIds = [];

async function main() {
  try {
    await db.collection("products").doc(physicalProductId).set({ inventoryTracked: true });
    await db.collection("productVariants").doc(physicalVariantId).set({
      productId: physicalProductId,
      stockQuantity: 4,
      inventoryTracked: true,
    });
    await db.collection("products").doc(workshopProductId).set({
      productType: "Workshop Registration",
      inventoryTracked: false,
    });
    await db.collection("productVariants").doc(workshopVariantId).set({
      productId: workshopProductId,
      seatCapacity: 3,
      inventoryTracked: false,
    });
    await db.collection("products").doc(bundleProductId).set({ productType: "Bundle" });
    await db.collection("productVariants").doc(bundleVariantId).set({
      productId: bundleProductId,
      bundleComponents: [{
        bundleComponentId: `BC-PHYSICAL-${suffix}`,
        componentProductId: physicalProductId,
        componentProductVariantId: physicalVariantId,
        quantity: 2,
      }, {
        bundleComponentId: `BC-WORKSHOP-${suffix}`,
        componentProductId: workshopProductId,
        componentProductVariantId: workshopVariantId,
        quantity: 2,
      }],
    });

    const architecture = await loadProductArchitecture(db);
    const resolvedComponents = await resolveBundleInventoryItems(db, {
      productId: bundleProductId,
      variantId: bundleVariantId,
      quantity: 1,
      architecture,
    });
    assert.equal(resolvedComponents.length, 2, "Stored bundle components did not resolve.");

    const bundleItems = [{
      id: bundleProductId,
      variantId: bundleVariantId,
      quantity: 1,
      inventoryTracked: false,
      bundleInventoryItems: resolvedComponents,
    }];

    const first = await createInventoryReservation(db, {
      uid: `TEST-USER-${suffix}`,
      items: bundleItems,
      stripeExpiresAt: Date.now() + 600000,
      reservationExpiresAt: Date.now() + 600000,
    });
    reservationIds.push(first);
    const stored = await db.collection("inventoryReservations").doc(first).get();
    assert.equal(stored.data()?.items?.length, 2, "Bundle parent was reserved instead of its components.");
    assert.equal(stored.data()?.items?.[0]?.variantId, physicalVariantId);
    assert.equal(stored.data()?.items?.[1]?.variantId, workshopVariantId);

    await assert.rejects(() => createInventoryReservation(db, {
      uid: `TEST-USER-2-${suffix}`,
      items: bundleItems,
      stripeExpiresAt: Date.now() + 600000,
      reservationExpiresAt: Date.now() + 600000,
    }), /enough places/, "A competing bundle should not exceed the shared Workshop capacity.");

    await releaseInventoryReservation(db, first);
    const second = await createInventoryReservation(db, {
      uid: `TEST-USER-2-${suffix}`,
      items: bundleItems,
      stripeExpiresAt: Date.now() + 600000,
      reservationExpiresAt: Date.now() + 600000,
    });
    reservationIds.push(second);
    console.log("Bundle inventory and Workshop reservation verification passed.");
  } finally {
    await Promise.all(reservationIds.map((id) => id
      ? db.collection("inventoryReservations").doc(id).delete()
      : Promise.resolve()));
    await Promise.all([
      db.collection("products").doc(physicalProductId).delete(),
      db.collection("productVariants").doc(physicalVariantId).delete(),
      db.collection("products").doc(workshopProductId).delete(),
      db.collection("productVariants").doc(workshopVariantId).delete(),
      db.collection("products").doc(bundleProductId).delete(),
      db.collection("productVariants").doc(bundleVariantId).delete(),
    ]);
  }
}

main();
