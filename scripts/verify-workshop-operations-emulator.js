/* global process, console */
import assert from "node:assert/strict";
import admin from "../functions/node_modules/firebase-admin/lib/index.js";
import { getContentBuilderData } from "../functions/admin/getContentBuilderData.js";
import { getInventoryOperationsData } from "../functions/products/getInventoryOperationsData.js";
import { recordWorkshopOperationsIssue } from "../functions/products/recordWorkshopOperationsIssue.js";
import {
  activeWorkshopHolds,
  syncWorkshopInventoryAllocations,
} from "../functions/utils/workshopInventoryAllocations.js";
import { createInventoryReservation } from "../functions/orders/inventoryReservations.js";
import { recordManufacturingRun } from "../functions/products/recordManufacturingRun.js";

assert(process.env.FIRESTORE_EMULATOR_HOST, "Run this check through the Firestore emulator.");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "recovery-tools" });
const db = admin.firestore();
const suffix = Date.now();
const ids = {
  item: `TEST-OPS-ITEM-${suffix}`,
  reusable: `TEST-OPS-REUSABLE-${suffix}`,
  giveawayProduct: `TEST-OPS-GIVEAWAY-PRODUCT-${suffix}`,
  giveawayVariant: `TEST-OPS-GIVEAWAY-VARIANT-${suffix}`,
  blueprint: `TEST-OPS-BLUEPRINT-${suffix}`,
  plan: `TEST-OPS-PLAN-${suffix}`,
  grant: `TEST-OPS-GRANT-${suffix}`,
  product: `TEST-OPS-PRODUCT-${suffix}`,
  variant: `TEST-OPS-VARIANT-${suffix}`,
  link: `TEST-OPS-LINK-${suffix}`,
  order: `TEST-OPS-ORDER-${suffix}`,
  manufacturedProduct: `TEST-OPS-MANUFACTURED-${suffix}`,
  manufacturingBlueprint: `TEST-OPS-MANUFACTURING-BLUEPRINT-${suffix}`,
};
const request = { auth: { uid: `TEST-ADMIN-${suffix}`, token: { admin: true, email: "test@example.test" } } };
const cleanup = [];
const set = async (collection, id, data) => {
  await db.collection(collection).doc(id).set(data);
  cleanup.push([collection, id]);
};

async function main() {
  try {
    await set("items", ids.item, { name: "Giveaway", type: "tool", inventoryTracked: true, stockQty: 10 });
    await set("inventory", `INV-${ids.item}`, { inventoryId: `INV-${ids.item}`, itemId: ids.item, stockQty: 10 });
    await set("items", ids.reusable, { name: "Reusable ball", type: "tool", inventoryTracked: true, stockQty: 5 });
    await set("inventory", `INV-${ids.reusable}`, {
      inventoryId: `INV-${ids.reusable}`, itemId: ids.reusable, stockQty: 5,
    });
    await set("products", ids.giveawayProduct, {
      name: "Recovery balm samples", type: "Physical Product", inventoryTracked: true, stock: 99,
    });
    await set("productVariants", ids.giveawayVariant, {
      productId: ids.giveawayProduct, variantName: "Sample pot", inventoryTracked: true, stockQuantity: 20,
    });
    await set("inventory", `INV-${ids.giveawayVariant}`, {
      inventoryId: `INV-${ids.giveawayVariant}`, productId: ids.giveawayProduct,
      variantId: ids.giveawayVariant, stockQty: 20,
    });
    await set("blueprints", ids.blueprint, {
      name: "Workshop room setup",
      type: "workshop operations",
      status: "active",
      entityVariants: [{
        entityVariantId: "DEFAULT",
        name: "Default setup",
        linkedItemComponents: [{
          componentId: "GIVEAWAY",
          itemId: ids.item,
          quantity: 2,
          quantityBasis: "confirmed-attendees",
          inventoryTreatment: "take-home",
          deductOnIssue: true,
        }, {
          componentId: "BALM-SAMPLE",
          productId: ids.giveawayProduct,
          productVariantId: ids.giveawayVariant,
          quantity: 1,
          quantityBasis: "confirmed-attendees",
          inventoryTreatment: "take-home",
          deductOnIssue: true,
        }, {
          componentId: "BALLS",
          itemId: ids.reusable,
          quantity: 1,
          quantityBasis: "fixed",
          inventoryTreatment: "bring-return",
          deductOnIssue: false,
        }],
      }],
    });
    await set("products", ids.product, {
      name: "Workshop", productType: "Workshop Registration", type: "Workshop", status: "active",
      tracksSeats: true,
    });
    await set("productVariants", ids.variant, {
      productId: ids.product, variantName: "Session", seatCapacity: 10, status: "active",
      eventEndAt: new Date(Date.now() - 60000).toISOString(),
    });
    await set("plans", ids.plan, {
      name: "Workshop Plan",
      type: "workshop",
      status: "active",
      entityVariants: [{
        entityVariantId: "PLAN-SESSION",
        name: "Session plan",
        linkedBlueprintIds: [ids.blueprint],
      }],
    });
    await set("productAccessGrants", ids.grant, {
      productAccessGrantId: ids.grant,
      productId: ids.product,
      productVariantId: ids.variant,
      accessEntityType: "Plan",
      accessEntityId: ids.plan,
      accessEntityVariantId: "PLAN-SESSION",
      status: "active",
    });
    await set("orders", ids.order, {
      status: "Paid",
      paymentStatus: "paid",
      orderLines: [{ productId: ids.product, productVariantId: ids.variant, quantity: 3 }],
    });
    await syncWorkshopInventoryAllocations(db, ids.order);
    const allocations = await db.collection("workshopOperationsAllocations")
      .where("orderId", "==", ids.order).get();
    allocations.docs.forEach((doc) => cleanup.push(["workshopOperationsAllocations", doc.id]));
    assert.equal(allocations.docs.length, 3, "Workshop material holds were not created from the paid order.");
    assert.equal(allocations.docs.find((doc) => doc.data().componentId === "GIVEAWAY")?.data().quantityHeld, 6,
      "Per-ticket Item quantities were not held.");
    assert.equal(allocations.docs.find((doc) => doc.data().componentId === "BALLS")?.data().quantityHeld, 1,
      "Fixed reusable equipment was not held once for the session.");
    const holds = await activeWorkshopHolds(db);
    assert.equal(holds.get(`productVariant:${ids.giveawayVariant}`), 3,
      "Exact Product Variant holds were not available to stock enforcement.");
    await set("products", ids.manufacturedProduct, {
      name: "Manufactured test Product", type: "Physical Product", inventoryTracked: true, stock: 0,
    });
    await set("blueprints", ids.manufacturingBlueprint, {
      name: "Manufacturing test", type: "product manufacture", status: "active",
      entityVariants: [{ entityVariantId: "DEFAULT", linkedItemComponents: [{
        componentId: "HELD-ITEM", itemId: ids.item, quantity: 1, unit: "each",
      }] }],
    });
    await assert.rejects(() => recordManufacturingRun.run({
      ...request,
      data: { productId: ids.manufacturedProduct, blueprintId: ids.manufacturingBlueprint,
        blueprintVariantId: "DEFAULT", quantityProduced: 5 },
    }), /held for Workshops/, "Manufacturing ignored Item stock held for the Workshop.");
    await assert.rejects(() => createInventoryReservation(db, {
      uid: request.auth.uid,
      items: [{ id: ids.giveawayProduct, variantId: ids.giveawayVariant,
        name: "Recovery balm samples", quantity: 18, inventoryTracked: true }],
      stripeExpiresAt: Date.now() + 300000,
      reservationExpiresAt: Date.now() + 300000,
    }), /enough stock/, "Checkout ignored Product stock held for the Workshop.");
    await db.collection("orders").doc(ids.order).set({
      orderLines: [{ productId: ids.product, productVariantId: ids.variant, quantity: 3, refundedQuantity: 1 }],
    }, { merge: true });
    await syncWorkshopInventoryAllocations(db, ids.order);
    const refundedAllocations = await db.collection("workshopOperationsAllocations")
      .where("orderId", "==", ids.order).get();
    assert.equal(refundedAllocations.docs.find((doc) => doc.data().componentId === "GIVEAWAY")
      ?.data().quantityHeld, 4, "Partial refunds did not recalculate per-ticket material holds.");
    await db.collection("orders").doc(ids.order).set({
      orderLines: [{ productId: ids.product, productVariantId: ids.variant, quantity: 3, refundedQuantity: 0 }],
    }, { merge: true });
    await syncWorkshopInventoryAllocations(db, ids.order);

    const builder = await getContentBuilderData.run(request);
    assert(builder.options.blueprintTypes.includes("workshop operations"),
      "Workshop Operations was missing from Blueprint types.");
    const operationsData = await getInventoryOperationsData.run(request);
    const session = operationsData.workshopSessions.find((candidate) =>
      candidate.productVariantId === ids.variant);
    assert(session?.operations, "Workshop Operations Blueprint was not resolved for the session.");
    assert.equal(session.operations.source, "workshop-plan");
    assert.equal(session.operations.workshopPlanId, ids.plan);
    assert.equal(session.operations.components.find((component) => component.componentId === "GIVEAWAY")
      ?.requiredQuantity, 6, "Confirmed-attendee quantity was not calculated.");
    assert.equal(session.operations.components.find((component) => component.componentId === "BALLS")
      ?.requiredQuantity, 1, "Fixed reusable quantity was not calculated.");
    const balm = session.operations.components.find((component) => component.componentId === "BALM-SAMPLE");
    assert.equal(balm?.requiredQuantity, 3, "Product Variant attendee quantity was not calculated.");
    assert.equal(balm?.heldQuantity, 3, "Sold-ticket Workshop stock was not placed on hold.");
    assert.equal(balm?.availableAfterHold, 17, "Workshop-held stock was not removed from availability.");
    assert.equal(balm?.stock, 20, "Exact Product Variant stock was not resolved.");

    const issued = await recordWorkshopOperationsIssue.run({
      ...request,
      data: { productId: ids.product, productVariantId: ids.variant, confirmation: "ISSUE" },
    });
    assert.equal(issued.success, true);
    cleanup.push(["workshopOperationsIssues", issued.workshopOperationsIssueId]);
    assert.equal((await db.collection("inventory").doc(`INV-${ids.item}`).get()).data()?.stockQty, 4,
      "Take-home inventory was not deducted.");
    assert.equal((await db.collection("inventory").doc(`INV-${ids.reusable}`).get()).data()?.stockQty, 5,
      "Bring-and-return inventory was incorrectly deducted.");
    assert.equal((await db.collection("inventory").doc(`INV-${ids.giveawayVariant}`).get()).data()?.stockQty, 17,
      "Take-home Product Variant inventory was not deducted.");
    assert.equal((await db.collection("productVariants").doc(ids.giveawayVariant).get()).data()?.stockQuantity, 17,
      "Embedded Product Variant stock was not updated.");
    assert.equal((await db.collection("products").doc(ids.giveawayProduct).get()).data()?.stock, 99,
      "The parent Product stock was incorrectly changed for an exact Product Variant allocation.");
    const completedAllocations = await db.collection("workshopOperationsAllocations")
      .where("orderId", "==", ids.order).get();
    assert(completedAllocations.docs.every((doc) => Number(doc.data().quantityHeld || 0) === 0),
      "Completing Workshop Operations did not clear all material holds.");
    assert.equal(completedAllocations.docs.find((doc) => doc.data().componentId === "BALLS")?.data().status,
      "released", "Reusable equipment was not released after the Workshop.");
    assert.equal(completedAllocations.docs.find((doc) => doc.data().componentId === "GIVEAWAY")?.data().status,
      "consumed", "Take-home inventory hold was not marked consumed.");
    await syncWorkshopInventoryAllocations(db, ids.order);
    const resyncedAllocations = await db.collection("workshopOperationsAllocations")
      .where("orderId", "==", ids.order).get();
    assert(resyncedAllocations.docs.every((doc) => doc.data().status !== "active"),
      "Order resynchronisation reactivated holds for a completed Workshop.");

    await recordWorkshopOperationsIssue.run({
      ...request,
      data: { productId: ids.product, productVariantId: ids.variant, confirmation: "ISSUE" },
    });
    assert.equal((await db.collection("inventory").doc(`INV-${ids.item}`).get()).data()?.stockQty, 4,
      "A repeated issue deducted inventory twice.");
    assert.equal((await db.collection("inventory").doc(`INV-${ids.giveawayVariant}`).get()).data()?.stockQty, 17,
      "A repeated issue deducted Product Variant inventory twice.");
    console.log("Workshop Operations verification passed.");
  } finally {
    await Promise.all(cleanup.reverse().map(([collection, id]) => db.collection(collection).doc(id).delete()));
  }
}

main();
