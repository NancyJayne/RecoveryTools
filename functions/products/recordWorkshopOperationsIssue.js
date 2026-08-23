import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { resolveWorkshopOperations } from "../utils/workshopOperations.js";

if (!admin.apps.length) admin.initializeApp();

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function status(value) {
  return clean(value).toLowerCase();
}

function paidOrder(order = {}) {
  const states = [order.paymentStatus, order.orderStatus, order.status].map(status);
  return states.includes("paid") &&
    !states.some((value) => ["cancelled", "canceled", "refunded", "failed", "void"].includes(value));
}

function itemVariantInventoryId(itemId, itemVariantId) {
  return `INV-ITEMVARIANT-${itemId}-${itemVariantId}`
    .replace(/[^a-zA-Z0-9-]+/g, "-").toUpperCase();
}

function operationsComponents(blueprint, blueprintVariantId) {
  const variants = Array.isArray(blueprint?.entityVariants) ? blueprint.entityVariants : [];
  const selected = variants.find((variant) => clean(variant.entityVariantId) === blueprintVariantId) ||
    variants.find((variant) => variant.isDefault === true) || variants[0];
  return (selected?.linkedItemComponents || blueprint?.linkedItemComponents || [])
    .map((component, index) => ({
      componentId: clean(component.componentId) || `COMPONENT-${index + 1}`,
      itemId: clean(component.itemId),
      itemVariantId: clean(component.itemVariantId),
      productId: clean(component.productId),
      productVariantId: clean(component.productVariantId),
      quantity: Number(component.quantity || 0),
      unit: clean(component.unit) || "each",
      quantityBasis: clean(component.quantityBasis) || "fixed",
      inventoryTreatment: clean(component.inventoryTreatment) || "bring-return",
      deductOnIssue: component.deductOnIssue === true,
    }))
    .filter((component) => (component.itemId || component.productId) && component.quantity > 0);
}

export const recordWorkshopOperationsIssue = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (request.auth?.token?.admin !== true) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }
    const productId = clean(request.data?.productId);
    const productVariantId = clean(request.data?.productVariantId);
    const confirmation = clean(request.data?.confirmation);
    if (!productId || !productVariantId || confirmation !== "ISSUE") {
      throw new HttpsError("invalid-argument", "Choose a Workshop session and confirm ISSUE.");
    }
    const db = admin.firestore();
    const [productSnap, variantSnap, linksSnap, grantsSnap, plansSnap, blueprintsSnap,
      ordersSnap, attendanceSnap] = await Promise.all([
      db.collection("products").doc(productId).get(),
      db.collection("productVariants").doc(productVariantId).get(),
      db.collection("productVariantContentLinks").where("productId", "==", productId).get(),
      db.collection("productAccessGrants").where("productId", "==", productId).get(),
      db.collection("plans").get(),
      db.collection("blueprints").get(),
      db.collection("orders").get(),
      db.collection("workshopAttendance").where("productVariantId", "==", productVariantId).get(),
    ]);
    if (!productSnap.exists || !variantSnap.exists || clean(variantSnap.data()?.productId) !== productId) {
      throw new HttpsError("not-found", "Workshop session not found.");
    }
    const resolution = resolveWorkshopOperations({
      productId,
      productVariantId,
      accessGrants: grantsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      variantLinks: linksSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      plans: new Map(plansSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }])),
      blueprints: new Map(blueprintsSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }])),
    });
    if (!resolution) {
      throw new HttpsError(
        "failed-precondition",
        "Attach a Workshop Operations Blueprint to the exact Workshop Plan variant first.",
      );
    }
    const blueprintId = resolution.blueprint.id;
    const blueprintVariantId = resolution.blueprintVariantId;

    const variant = variantSnap.data() || {};
    const capacity = Math.max(Number(variant.seatCapacity || 0), 0);
    let confirmedAttendees = 0;
    ordersSnap.docs.forEach((doc) => {
      const order = doc.data() || {};
      if (!paidOrder(order)) return;
      const lines = Array.isArray(order.orderLines) && order.orderLines.length
        ? order.orderLines : Array.isArray(order.products) ? order.products : [];
      lines.forEach((line) => {
        if (clean(line.productId) !== productId ||
            clean(line.productVariantId || line.variantId) !== productVariantId) return;
        confirmedAttendees += Math.max(
          Number(line.quantity || 1) - Number(line.refundedQuantity || 0), 0,
        );
      });
    });
    const actualAttendees = attendanceSnap.docs.reduce((sum, doc) => {
      const row = doc.data() || {};
      return row.checkedIn === true && row.removed !== true ? sum + Math.max(Number(row.quantity || 1), 1) : sum;
    }, 0);
    const components = operationsComponents(resolution.blueprint, blueprintVariantId);
    const deductions = components.filter((component) =>
      component.deductOnIssue && ["consumable", "take-home"].includes(component.inventoryTreatment));
    const sourceSnapshots = await Promise.all(deductions.map((component) => {
      if (component.productVariantId) return db.collection("productVariants").doc(component.productVariantId).get();
      if (component.productId) return db.collection("products").doc(component.productId).get();
      return db.collection("items").doc(component.itemId).get();
    }));
    const inventory = deductions.map((component, index) => {
      const source = sourceSnapshots[index].data() || {};
      if (!sourceSnapshots[index].exists) {
        throw new HttpsError("failed-precondition", "A Workshop Operations stock source no longer exists.");
      }
      if (component.productVariantId && clean(source.productId) !== component.productId) {
        throw new HttpsError("failed-precondition", "A selected Product variant does not belong to its Product.");
      }
      const item = component.itemId ? source : {};
      const variants = Array.isArray(item.entityVariants) ? item.entityVariants : [];
      const itemVariant = variants.find((candidate) =>
        clean(candidate.entityVariantId) === component.itemVariantId);
      const inventoryId = component.productVariantId ? `INV-${component.productVariantId}`
        : component.productId ? `INV-${component.productId}`
          : component.itemVariantId ? itemVariantInventoryId(component.itemId, component.itemVariantId)
            : `INV-${component.itemId}`;
      const multiplier = {
        capacity,
        "confirmed-attendees": confirmedAttendees,
        "actual-attendees": actualAttendees,
        fixed: 1,
      }[component.quantityBasis] ?? 1;
      return {
        ...component,
        requiredQuantity: Number((component.quantity * multiplier).toFixed(4)),
        source,
        item,
        itemVariant,
        sourceType: component.productVariantId ? "ProductVariant" : component.productId
          ? "Product" : component.itemVariantId ? "ItemVariant" : "Item",
        ref: db.collection("inventory").doc(inventoryId),
      };
    });
    const issueId = `WORKSHOPISSUE-${productVariantId}-${blueprintVariantId || "DEFAULT"}`
      .replace(/[^a-zA-Z0-9-]+/g, "-").toUpperCase();
    const issueRef = db.collection("workshopOperationsIssues").doc(issueId);
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(issueRef);
      if (existing.exists && existing.data()?.status === "completed") return;
      const inventorySnaps = await Promise.all(inventory.map((entry) => transaction.get(entry.ref)));
      const movements = inventory.map((entry, index) => {
        const before = Number(inventorySnaps[index].data()?.stockQty ??
          (entry.productVariantId ? entry.source.stockQuantity
            : entry.productId ? entry.source.stock
              : entry.itemVariant?.stockQty ?? entry.item.stockQty) ?? 0);
        if (before < entry.requiredQuantity) {
          throw new HttpsError(
            "failed-precondition",
            `${entry.source.variantName || entry.source.productName || entry.source.name || entry.productVariantId || entry.productId || entry.itemId} needs ${entry.requiredQuantity}; only ${before} is available.`,
          );
        }
        const after = before - entry.requiredQuantity;
        transaction.set(entry.ref, {
          inventoryId: entry.ref.id,
          itemId: entry.itemId,
          entityVariantId: entry.itemVariantId,
          productId: entry.productId,
          variantId: entry.productVariantId,
          stockQty: after,
          adjustmentType: "workshop-issue",
          workshopProductId: productId,
          workshopProductVariantId: productVariantId,
          updatedAt: now,
          updatedByUid: request.auth.uid,
        }, { merge: true });
        if (entry.productVariantId) {
          transaction.set(db.collection("productVariants").doc(entry.productVariantId), {
            stockQuantity: after,
            updatedAt: now,
          }, { merge: true });
        } else if (entry.productId) {
          transaction.set(db.collection("products").doc(entry.productId), {
            stock: after,
            updatedAt: now,
          }, { merge: true });
        } else if (entry.itemVariantId) {
          transaction.set(db.collection("items").doc(entry.itemId), {
            entityVariants: (entry.item.entityVariants || []).map((candidate) =>
              clean(candidate.entityVariantId) === entry.itemVariantId
                ? { ...candidate, stockQty: after } : candidate),
            updatedAt: now,
          }, { merge: true });
        } else {
          transaction.set(db.collection("items").doc(entry.itemId), { stockQty: after, updatedAt: now }, { merge: true });
        }
        return { entityType: entry.sourceType, itemId: entry.itemId, itemVariantId: entry.itemVariantId,
          productId: entry.productId, productVariantId: entry.productVariantId,
          inventoryTreatment: entry.inventoryTreatment, quantity: entry.requiredQuantity,
          unit: entry.unit, before, after };
      });
      transaction.set(issueRef, {
        workshopOperationsIssueId: issueId,
        productId,
        productVariantId,
        blueprintId,
        blueprintVariantId,
        capacity,
        confirmedAttendees,
        actualAttendees,
        movements,
        status: "completed",
        issuedAt: now,
        issuedByUid: request.auth.uid,
        issuedByEmail: request.auth.token.email || "",
        createdAt: now,
        updatedAt: now,
      });
    });
    return { success: true, workshopOperationsIssueId: issueId };
  },
);
