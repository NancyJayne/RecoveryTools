import { HttpsError } from "firebase-functions/v2/https";
import { bundleComponentsForProduct, variantForProduct } from "./productArchitecture.js";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isWorkshopProduct(product = {}) {
  const type = clean(product.productType || product.type).toLowerCase();
  return type.includes("workshop") || type.includes("webinar") || type.includes("session");
}

export async function resolveBundleInventoryItems(db, {
  productId,
  variantId,
  quantity = 1,
  architecture,
}) {
  const components = bundleComponentsForProduct(productId, variantId, architecture);
  if (!components.length) return [];
  const productIds = [...new Set(components.map((component) => component.componentProductId))];
  const snapshots = await Promise.all(productIds.map((id) => db.collection("products").doc(id).get()));
  const products = new Map(snapshots.filter((snapshot) => snapshot.exists)
    .map((snapshot) => [snapshot.id, snapshot.data() || {}]));

  return components.map((component) => {
    const product = products.get(component.componentProductId);
    if (!product || product.archived === true) {
      throw new HttpsError("failed-precondition", "A Product included in this bundle is no longer available.");
    }
    const componentVariantId = component.componentProductVariantId;
    const variant = componentVariantId
      ? variantForProduct(
        component.componentProductId,
        product.itemId || product.legacyItemId || "",
        componentVariantId,
        architecture,
      )
      : null;
    if (componentVariantId && !variant) {
      throw new HttpsError("failed-precondition", "A Product option included in this bundle is no longer available.");
    }
    const componentQuantity = component.quantity * Math.max(Number(quantity || 1), 1);
    return {
      productId: component.componentProductId,
      variantId: componentVariantId,
      variantSourceCollection: variant?.sourceCollection || "productVariants",
      name: variant?.name ? `${product.name || component.componentProductId} - ${variant.name}` :
        product.name || component.componentProductId,
      quantity: componentQuantity,
      quantityPerBundle: component.quantity,
      inventoryTracked: variant?.inventoryTracked === true || product.inventoryTracked === true,
      isWorkshop: isWorkshopProduct(product),
      seatCapacity: Math.max(Number(variant?.seatCapacity || product.seatCapacity || 0), 0),
      bundleComponentId: component.bundleComponentId,
    };
  });
}

export function inventoryTargetsForItems(items = []) {
  return items.flatMap((item) => Array.isArray(item.bundleInventoryItems) && item.bundleInventoryItems.length
    ? item.bundleInventoryItems
    : [item]);
}
