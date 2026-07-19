import assert from "node:assert/strict";
import admin from "firebase-admin";
import { writeCheckoutCompleted } from "../functions/webhooks/handleStripeWebhook.js";

async function main() {
  assert(process.env.FIRESTORE_EMULATOR_HOST, "Run this check through the Firestore emulator.");
  if (!admin.apps.length) admin.initializeApp({ projectId: "recovery-tools" });
  const db = admin.firestore();
  const suffix = Date.now();
  const productId = `TEST-PHASE5-PRODUCT-${suffix}`;
  const variantId = `TEST-PHASE5-VARIANT-${suffix}`;
  const componentItemId = `TEST-PHASE5-COMPONENT-${suffix}`;
  const planId = `TEST-PHASE5-PLAN-${suffix}`;
  const orderId = `TEST-PHASE5-ORDER-${suffix}`;
  const userId = `TEST-PHASE5-USER-${suffix}`;
  const inventoryId = `CUSTOM-INVENTORY-${suffix}`;
  const componentInventoryId = `INV-${componentItemId}`;
  const cleanup = [];
  const set = async (collection, id, data) => {
    await db.collection(collection).doc(id).set(data);
    cleanup.push([collection, id]);
  };

  try {
    await set("products", productId, {
      productId,
      productName: "Phase 5 physical Product",
      productType: "Physical",
      type: "tool",
      requiresShipping: true,
      inventoryTracked: true,
      stock: 10,
      status: "active",
      shopStatus: "active",
      visible: true,
    });
    await set("productVariants", variantId, {
      productVariantId: variantId,
      productId,
      variantName: "Default",
      sku: "PHASE5-SKU",
      stockQuantity: 10,
      inventoryTracked: true,
      status: "active",
      isDefault: true,
    });
    await set("inventory", inventoryId, {
      inventoryId,
      productId,
      variantId,
      stockQty: 10,
    });
    await set("items", componentItemId, {
      itemId: componentItemId,
      name: "Packaging component",
      type: "part",
      status: "active",
    });
    await set("inventory", componentInventoryId, {
      inventoryId: componentInventoryId,
      itemId: componentItemId,
      productId: "",
      variantId: "",
      stockQty: 20,
    });
    await set("productComponents", `PC-${suffix}`, {
      productComponentId: `PC-${suffix}`,
      productId,
      productVariantId: variantId,
      itemId: componentItemId,
      quantity: 2,
      unit: "each",
      inventoryAction: "deduct",
      status: "active",
    });
    await set("plans", planId, { planId, name: "Unlocked Plan", type: "course", status: "active" });
    await set("productAccessGrants", `PAG-${suffix}`, {
      productAccessGrantId: `PAG-${suffix}`,
      productId,
      accessEntityType: "Plan",
      accessEntityId: planId,
      durationType: "days",
      durationValue: 30,
      revocable: true,
      status: "active",
    });

    const lineItem = {
      id: `LI-${suffix}`,
      description: "Phase 5 physical Product",
      quantity: 2,
      amount_subtotal: 2200,
      amount_total: 2200,
      price: {
        metadata: {},
        product: {
          id: `STRIPE-PRODUCT-${suffix}`,
          metadata: { firebaseProductId: productId, variantId },
        },
      },
    };
    const stripe = {
      checkout: { sessions: { listLineItems: async () => ({ data: [lineItem] }) } },
    };
    const session = {
      id: orderId,
      created: Math.floor(Date.now() / 1000),
      currency: "aud",
      amount_subtotal: 2200,
      amount_total: 2200,
      total_details: { amount_shipping: 0 },
      payment_status: "paid",
      customer: `CUS-${suffix}`,
      payment_intent: `PI-${suffix}`,
      metadata: { firebaseUID: userId },
      customer_details: {
        name: "Phase Five Customer",
        email: "phase5@example.test",
        address: { line1: "1 Test St", city: "Brisbane", postal_code: "4000", country: "AU" },
      },
      shipping_details: {
        name: "Phase Five Customer",
        address: { line1: "1 Test St", city: "Brisbane", postal_code: "4000", country: "AU" },
      },
    };
    const firstEvent = { id: `EVT-${suffix}-1`, type: "checkout.session.completed", created: session.created };
    const secondEvent = { id: `EVT-${suffix}-2`, type: "checkout.session.completed", created: session.created };

    await writeCheckoutCompleted({ stripe, session, event: firstEvent });
    cleanup.push(
      ["orders", orderId],
      ["orderItems", `${orderId}_1`],
      ["stripeEvents", firstEvent.id],
      ["stripeEvents", secondEvent.id],
      ["customerAddresses", `${orderId}_billing`],
      ["customerAddresses", `${orderId}_shipping`],
      ["userAccess", `${userId}_Plan_${planId}`],
    );

    const firstOrder = await db.collection("orders").doc(orderId).get();
    assert.equal(firstOrder.data()?.orderLineSchemaVersion, 2);
    assert.equal(firstOrder.data()?.orderLines?.[0]?.productName, "Phase 5 physical Product");
    assert.equal(firstOrder.data()?.orderLines?.[0]?.unitPrice, 11);
    assert.equal(firstOrder.data()?.orderLines?.[0]?.componentInventory?.[0]?.totalQuantity, 4);
    assert.equal(firstOrder.data()?.products?.[0]?.productTitle, "Phase 5 physical Product");
    assert.equal((await db.collection("products").doc(productId).get()).data()?.stock, 8);
    assert.equal((await db.collection("productVariants").doc(variantId).get()).data()?.stockQuantity, 8);
    assert.equal((await db.collection("inventory").doc(inventoryId).get()).data()?.stockQty, 8);
    assert.equal((await db.collection("inventory").doc(componentInventoryId).get()).data()?.stockQty, 16);
    const accessRef = db.collection("userAccess").doc(`${userId}_Plan_${planId}`);
    const orderItemRef = db.collection("orderItems").doc(`${orderId}_1`);
    const firstAccess = await accessRef.get();
    assert(firstAccess.exists);
    assert(firstAccess.data()?.expiresAt?.toDate() > new Date());

    // Simulate a crash after the root order and inventory transaction but before
    // the idempotent order-item and access side effects were committed.
    await Promise.all([accessRef.delete(), orderItemRef.delete()]);
    await writeCheckoutCompleted({ stripe, session, event: secondEvent });
    assert.equal((await db.collection("products").doc(productId).get()).data()?.stock, 8);
    assert.equal((await db.collection("productVariants").doc(variantId).get()).data()?.stockQuantity, 8);
    assert.equal((await db.collection("inventory").doc(inventoryId).get()).data()?.stockQty, 8);
    assert.equal((await db.collection("inventory").doc(componentInventoryId).get()).data()?.stockQty, 16);
    assert.equal((await db.collection("orderItems").where("orderId", "==", orderId).get()).size, 1);
    assert((await accessRef.get()).exists);

    console.log("Phase 5 order and inventory parity verification passed.");
  } finally {
    await Promise.all(cleanup.map(([collection, id]) =>
      db.collection(collection).doc(id).delete().catch(() => {})));
    await db.collection("users").doc(userId).collection("orders").doc(orderId).delete().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
