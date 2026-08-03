import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function itemVariantInventoryId(itemId, itemVariantId) {
  return `INV-ITEMVARIANT-${itemId}-${itemVariantId}`
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .toUpperCase();
}

function dateMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function recipeComponents(blueprint, blueprintVariantId) {
  const variants = Array.isArray(blueprint?.entityVariants) ? blueprint.entityVariants : [];
  const selected = variants.find((variant) =>
    clean(variant.entityVariantId) === clean(blueprintVariantId)) ||
    variants.find((variant) => variant.isDefault === true) ||
    variants[0];
  return (selected?.linkedItemComponents || blueprint?.linkedItemComponents || [])
    .map((component, index) => ({
      componentId: clean(component.componentId) || `COMPONENT-${index + 1}`,
      itemId: clean(component.itemId),
      itemVariantId: clean(component.itemVariantId),
      quantity: Number(component.quantity || 0),
      unit: clean(component.unit) || "each",
    }))
    .filter((component) => component.itemId && component.quantity > 0);
}

export const recordManufacturingRun = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (request.auth?.token?.admin !== true) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }
    const productId = clean(request.data?.productId);
    const productVariantId = clean(request.data?.productVariantId);
    const blueprintId = clean(request.data?.blueprintId);
    const blueprintVariantId = clean(request.data?.blueprintVariantId);
    const componentSelections = new Map((Array.isArray(request.data?.componentSelections)
      ? request.data.componentSelections
      : []).map((selection) => [
      clean(selection.componentId) || clean(selection.itemId),
      clean(selection.itemVariantId),
    ]));
    const quantityProduced = Number(request.data?.quantityProduced);
    if (!productId || !blueprintId || !Number.isInteger(quantityProduced) || quantityProduced <= 0) {
      throw new HttpsError("invalid-argument", "Choose a recipe and enter a whole quantity greater than zero.");
    }

    const db = admin.firestore();
    const [productSnap, blueprintSnap, variantSnap] = await Promise.all([
      db.collection("products").doc(productId).get(),
      db.collection("blueprints").doc(blueprintId).get(),
      productVariantId
        ? db.collection("productVariants").doc(productVariantId).get()
        : Promise.resolve(null),
    ]);
    if (!productSnap.exists) throw new HttpsError("not-found", "Product not found.");
    if (!blueprintSnap.exists) throw new HttpsError("not-found", "Manufacturing Blueprint not found.");
    if (productVariantId && !variantSnap?.exists) throw new HttpsError("not-found", "Product variant not found.");
    const variantData = variantSnap?.data() || {};
    if (productVariantId && clean(variantData.productId) !== productId) {
      throw new HttpsError("invalid-argument", "The selected Product variant does not belong to this Product.");
    }

    const components = recipeComponents(blueprintSnap.data(), blueprintVariantId);
    if (!components.length) throw new HttpsError("failed-precondition", "The Blueprint recipe has no Item components.");
    const [inventoryQueries, itemSnapshots] = await Promise.all([
      Promise.all(components.map((component) =>
        db.collection("inventory").where("itemId", "==", component.itemId).get())),
      Promise.all(components.map((component) =>
        db.collection("items").doc(component.itemId).get())),
    ]);
    const componentInventory = components.map((component, index) => {
      const itemData = itemSnapshots[index].data() || {};
      const itemVariantId = component.itemVariantId ||
        componentSelections.get(component.componentId) ||
        componentSelections.get(component.itemId) || "";
      const itemOnlyDocs = inventoryQueries[index].docs.filter((doc) => !clean(doc.data()?.productId));
      const itemVariants = Array.isArray(itemData.entityVariants) ? itemData.entityVariants : [];
      const topLevelDoc = itemOnlyDocs.find((candidate) =>
        !clean(candidate.data()?.entityVariantId));
      const canonicalVariantInventoryId = itemVariantId
        ? itemVariantInventoryId(component.itemId, itemVariantId)
        : "";
      const doc = itemVariantId
        ? itemOnlyDocs.find((candidate) => candidate.id === canonicalVariantInventoryId) ||
          itemOnlyDocs.find((candidate) =>
            clean(candidate.data()?.entityVariantId) === itemVariantId) ||
          (itemVariants.length === 1 ? topLevelDoc : null)
        : topLevelDoc;
      const itemVariant = itemVariants.find((variant) =>
        clean(variant.entityVariantId) === itemVariantId);
      if (itemVariantId && !itemVariant) {
        throw new HttpsError(
          "failed-precondition",
          `The selected Item variant ${itemVariantId} no longer exists.`,
        );
      }
      if (!itemVariantId && !doc && itemVariants.length > 1) {
        throw new HttpsError(
          "failed-precondition",
          `Choose which ${itemData.name || component.itemId} variant to use.`,
        );
      }
      const ref = doc?.ref || db.collection("inventory")
        .doc(itemVariantId ? canonicalVariantInventoryId : `INV-${component.itemId}`);
      return {
        ...component,
        ref,
        itemVariantId,
        itemData,
        fallbackStock: Number(itemVariant?.stockQty ?? itemData.stockQty ?? 0),
        preferFallbackStock: Boolean(doc) &&
          dateMillis(itemVariant?.updatedAt || itemData.updatedAt) >
            dateMillis(doc.data()?.updatedAt),
      };
    });
    const finishedInventoryQuery = await db.collection("inventory")
      .where(productVariantId ? "variantId" : "productId", "==", productVariantId || productId)
      .get();
    const finishedInventoryDoc = productVariantId
      ? finishedInventoryQuery.docs[0]
      : finishedInventoryQuery.docs.find((doc) => !clean(doc.data()?.variantId));
    const finishedInventoryRef = finishedInventoryDoc?.ref ||
      db.collection("inventory").doc(`INV-${productVariantId || productId}`);
    const runRef = db.collection("manufacturingRuns").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (transaction) => {
      const componentSnaps = await Promise.all(componentInventory.map((component) =>
        transaction.get(component.ref)));
      const finishedSnap = await transaction.get(finishedInventoryRef);
      const deductions = componentInventory.map((component, index) => {
        const before = Number(component.preferFallbackStock
          ? component.fallbackStock
          : componentSnaps[index].data()?.stockQty ?? component.fallbackStock);
        const used = component.quantity * quantityProduced;
        if (before < used) {
          throw new HttpsError(
            "failed-precondition",
            `${component.itemId} needs ${used} ${component.unit}; only ${before} is available.`,
          );
        }
        transaction.set(component.ref, {
          inventoryId: component.ref.id,
          itemId: component.itemId,
          entityVariantId: component.itemVariantId,
          productId: "",
          variantId: "",
          stockQty: before - used,
          updatedAt: now,
          updatedByUid: request.auth.uid,
          adjustmentType: "manufacturing",
        }, { merge: true });
        if (component.itemVariantId) {
          transaction.set(db.collection("items").doc(component.itemId), {
            entityVariants: (component.itemData.entityVariants || []).map((variant) =>
              clean(variant.entityVariantId) === component.itemVariantId
                ? { ...variant, stockQty: before - used }
                : variant),
            updatedAt: now,
          }, { merge: true });
        } else {
          transaction.set(db.collection("items").doc(component.itemId), {
            stockQty: before - used,
            updatedAt: now,
          }, { merge: true });
        }
        return {
          itemId: component.itemId,
          itemVariantId: component.itemVariantId,
          unit: component.unit,
          perProduct: component.quantity,
          used,
          before,
          after: before - used,
        };
      });
      const finishedBefore = Number(finishedSnap.data()?.stockQty ??
        (productVariantId ? variantSnap.data()?.stockQuantity : productSnap.data()?.stock) ?? 0);
      const finishedAfter = finishedBefore + quantityProduced;
      transaction.set(finishedInventoryRef, {
        inventoryId: finishedInventoryRef.id,
        productId,
        variantId: productVariantId,
        stockQty: finishedAfter,
        updatedAt: now,
        updatedByUid: request.auth.uid,
        adjustmentType: "manufacturing",
      }, { merge: true });
      if (productVariantId) {
        transaction.set(variantSnap.ref, {
          stockQuantity: finishedAfter,
          stockStatus: "in-stock",
          updatedAt: now,
        }, { merge: true });
      } else {
        transaction.set(productSnap.ref, { stock: finishedAfter, updatedAt: now }, { merge: true });
      }
      transaction.set(runRef, {
        manufacturingRunId: runRef.id,
        productId,
        productVariantId,
        blueprintId,
        blueprintVariantId,
        quantityProduced,
        finishedStockBefore: finishedBefore,
        finishedStockAfter: finishedAfter,
        componentDeductions: deductions,
        status: "completed",
        createdAt: now,
        createdByUid: request.auth.uid,
        createdByEmail: request.auth.token.email || "",
      });
    });
    return { success: true, manufacturingRunId: runRef.id };
  },
);
