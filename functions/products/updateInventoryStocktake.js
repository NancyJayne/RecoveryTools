import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export const updateInventoryStocktake = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (request.auth?.token?.admin !== true) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }
    const rows = (Array.isArray(request.data?.rows) ? request.data.rows : [])
      .map((row) => ({
        inventoryId: clean(row.inventoryId),
        entityType: clean(row.entityType),
        entityId: clean(row.entityId),
        itemVariantId: clean(row.itemVariantId),
        productId: clean(row.productId),
        stock: Number(row.stock),
      }))
      .filter((row) => row.inventoryId && row.entityId && Number.isFinite(row.stock) && row.stock >= 0);
    if (!rows.length) throw new HttpsError("invalid-argument", "Enter at least one valid stock quantity.");

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const itemVariantRows = rows.filter((row) =>
      row.entityType === "ItemVariant" && row.itemVariantId);
    const itemIds = [...new Set(itemVariantRows.map((row) => row.entityId))];
    const itemSnapshots = await Promise.all(itemIds.map((itemId) =>
      db.collection("items").doc(itemId).get()));
    const itemUpdates = new Map();
    itemSnapshots.forEach((snapshot) => {
      if (!snapshot.exists) return;
      const changes = new Map(itemVariantRows
        .filter((row) => row.entityId === snapshot.id)
        .map((row) => [row.itemVariantId, row.stock]));
      const entityVariants = (snapshot.data()?.entityVariants || []).map((variant) =>
        changes.has(clean(variant.entityVariantId))
          ? { ...variant, stockQty: changes.get(clean(variant.entityVariantId)) }
          : variant);
      itemUpdates.set(snapshot.id, entityVariants);
    });
    const batch = db.batch();
    rows.forEach((row) => {
      batch.set(db.collection("inventory").doc(row.inventoryId), {
        inventoryId: row.inventoryId,
        itemId: ["Item", "ItemVariant"].includes(row.entityType) ? row.entityId : "",
        entityVariantId: row.entityType === "ItemVariant" ? row.itemVariantId : "",
        productId: row.productId || (row.entityType === "Product" ? row.entityId : ""),
        variantId: row.entityType === "ProductVariant" ? row.entityId : "",
        stockQty: row.stock,
        updatedAt: now,
        updatedByUid: request.auth.uid,
        adjustmentType: "stocktake",
      }, { merge: true });
      if (row.entityType === "Item") {
        batch.set(db.collection("items").doc(row.entityId), {
          stockQty: row.stock,
          updatedAt: now,
          updatedByUid: request.auth.uid,
        }, { merge: true });
      } else if (row.entityType === "ItemVariant") {
        // The embedded Item variant array is updated once per Item below.
      } else if (row.entityType === "ProductVariant") {
        batch.set(db.collection("productVariants").doc(row.entityId), {
          stockQuantity: row.stock,
          stockStatus: row.stock > 0 ? "in-stock" : "out-of-stock",
          updatedAt: now,
        }, { merge: true });
      } else {
        batch.set(db.collection("products").doc(row.entityId), {
          stock: row.stock,
          updatedAt: now,
        }, { merge: true });
      }
    });
    itemUpdates.forEach((entityVariants, itemId) => {
      batch.set(db.collection("items").doc(itemId), {
        entityVariants,
        updatedAt: now,
        updatedByUid: request.auth.uid,
      }, { merge: true });
    });
    await batch.commit();
    return { success: true, updated: rows.length };
  },
);
