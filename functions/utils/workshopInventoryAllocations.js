import admin from "firebase-admin";
import { resolveWorkshopOperations } from "./workshopOperations.js";

const clean = (value) => typeof value === "string" ? value.trim() : "";
const status = (value) => clean(value).toLowerCase();

function paidOrder(order = {}) {
  const states = [order.paymentStatus, order.orderStatus, order.status].map(status);
  if (states.some((value) => ["cancelled", "canceled", "refunded", "failed", "void"].includes(value))) {
    return false;
  }
  return states.includes("paid") || states.includes("partially_refunded") || states.includes("partially refunded");
}

function components(blueprint, variantId) {
  const variants = Array.isArray(blueprint?.entityVariants) ? blueprint.entityVariants : [];
  const selected = variants.find((variant) => clean(variant.entityVariantId) === clean(variantId)) ||
    variants.find((variant) => variant.isDefault === true) || variants[0] || blueprint;
  return (selected?.linkedItemComponents || []).filter((component) =>
    (component.itemId || component.productId) && Number(component.quantity || 0) > 0);
}

export async function syncWorkshopInventoryAllocations(db, orderId, order = null) {
  const orderSnap = order ? null : await db.collection("orders").doc(orderId).get();
  const data = order || orderSnap?.data() || {};
  const existing = await db.collection("workshopOperationsAllocations").where("orderId", "==", orderId).get();
  const batch = db.batch();
  existing.docs.forEach((doc) => batch.set(doc.ref, {
    status: "released", quantityHeld: 0, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }));
  if (!paidOrder(data)) {
    await batch.commit();
    return;
  }
  const lines = Array.isArray(data.orderLines) && data.orderLines.length
    ? data.orderLines : Array.isArray(data.products) ? data.products : [];
  const [grants, links, plans, blueprints, completedIssues] = await Promise.all([
    db.collection("productAccessGrants").get(), db.collection("productVariantContentLinks").get(),
    db.collection("plans").get(), db.collection("blueprints").get(),
    db.collection("workshopOperationsIssues").where("status", "==", "completed").get(),
  ]);
  const grantRows = grants.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const linkRows = links.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const planMap = new Map(plans.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
  const blueprintMap = new Map(blueprints.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
  const completedVariants = new Set(completedIssues.docs.map((doc) => clean(doc.data()?.productVariantId)));
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const productId = clean(line.productId);
    const productVariantId = clean(line.productVariantId || line.variantId);
    if (!productId || !productVariantId) continue;
    const resolution = resolveWorkshopOperations({ productId, productVariantId,
      accessGrants: grantRows, variantLinks: linkRows, plans: planMap, blueprints: blueprintMap });
    if (!resolution) continue;
    const tickets = Math.max(Number(line.quantity || 1) - Number(line.refundedQuantity || 0), 0);
    components(resolution.blueprint, resolution.blueprintVariantId).forEach((component, componentIndex) => {
      const perTicket = ["confirmed-attendees", "actual-attendees"].includes(component.quantityBasis);
      const quantityHeld = tickets > 0 ? Number(component.quantity || 0) * (perTicket ? tickets : 1) : 0;
      const componentId = clean(component.componentId) || `COMPONENT-${componentIndex + 1}`;
      const allocationId = `WORKSHOPALLOCATION-${orderId}-${lineIndex + 1}-${componentId}`
        .replace(/[^a-zA-Z0-9-]+/g, "-").toUpperCase();
      const completed = completedVariants.has(productVariantId);
      const consumed = component.deductOnIssue === true &&
        ["consumable", "take-home"].includes(clean(component.inventoryTreatment));
      batch.set(db.collection("workshopOperationsAllocations").doc(allocationId), {
        allocationId, orderId, lineNumber: Number(line.lineNumber || lineIndex + 1), productId,
        productVariantId, blueprintId: resolution.blueprint.id,
        blueprintVariantId: resolution.blueprintVariantId || "", componentId,
        itemId: clean(component.itemId), itemVariantId: clean(component.itemVariantId),
        componentProductId: clean(component.productId),
        componentProductVariantId: clean(component.productVariantId),
        inventoryTreatment: clean(component.inventoryTreatment) || "bring-return",
        deductOnIssue: component.deductOnIssue === true, unit: clean(component.unit) || "each",
        status: completed ? (consumed ? "consumed" : "released") : quantityHeld > 0 ? "active" : "released",
        quantityHeld: completed ? 0 : quantityHeld,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  }
  await batch.commit();
}

export async function activeWorkshopHolds(db) {
  const snapshot = await db.collection("workshopOperationsAllocations").where("status", "==", "active").get();
  const totals = new Map();
  snapshot.docs.forEach((doc) => {
    const row = doc.data() || {};
    const key = row.componentProductVariantId ? `productVariant:${row.componentProductVariantId}`
      : row.componentProductId ? `product:${row.componentProductId}`
        : row.itemVariantId ? `itemVariant:${row.itemId}:${row.itemVariantId}` : `item:${row.itemId}`;
    totals.set(key, (totals.get(key) || 0) + Number(row.quantityHeld || 0));
  });
  return totals;
}
