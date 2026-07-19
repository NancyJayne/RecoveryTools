import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

export const updateProductInventory = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (request.auth?.token?.admin !== true) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }

    const { productId, stock, variants = [] } = request.data || {};
    const cleanProductId = cleanString(productId);
    const productStock = asNumber(stock);

    if (!cleanProductId) {
      throw new HttpsError("invalid-argument", "Missing product ID.");
    }

    const normalizedVariants = Array.isArray(variants)
      ? variants
        .map((variant) => ({
          variantId: cleanString(variant.variantId || variant.id),
          stock: asNumber(variant.stock),
        }))
        .filter((variant) => variant.variantId && variant.stock !== null)
      : [];

    try {
      const db = admin.firestore();
      const now = admin.firestore.FieldValue.serverTimestamp();
      const canonicalVariantDocs = await Promise.all(normalizedVariants.map((variant) =>
        db.collection("productVariants").doc(variant.variantId).get()));
      const canonicalVariantIds = new Set(
        canonicalVariantDocs.filter((doc) => doc.exists).map((doc) => doc.id),
      );
      await db.runTransaction(async (transaction) => {
        const productRef = db.collection("products").doc(cleanProductId);
        const productSnap = await transaction.get(productRef);

        if (!productSnap.exists) {
          throw new HttpsError("not-found", "Product not found.");
        }

        const productData = productSnap.data() || {};
        const itemId = cleanString(productData.itemId);
        const totalVariantStock = normalizedVariants.reduce((sum, variant) => sum + variant.stock, 0);
        const nextProductStock = productStock ?? totalVariantStock;

        transaction.set(productRef, {
          stock: nextProductStock,
          inventoryTracked: true,
          updatedAt: now,
        }, { merge: true });

        if (!normalizedVariants.length) {
          const inventoryId = `INV-${slugify(cleanProductId)}`;
          transaction.set(db.collection("inventory").doc(inventoryId), {
            inventoryId,
            name: productData.name || productData.title || cleanProductId,
            itemId,
            productId: cleanProductId,
            variantId: "",
            stockQty: nextProductStock,
            updatedAt: now,
          }, { merge: true });
        }

        normalizedVariants.forEach((variant) => {
          const isCanonical = canonicalVariantIds.has(variant.variantId);
          const variantRef = db
            .collection(isCanonical ? "productVariants" : "itemVariants")
            .doc(variant.variantId);
          transaction.set(variantRef, {
            [isCanonical ? "stockQuantity" : "stock"]: variant.stock,
            updatedAt: now,
          }, { merge: true });

          const inventoryId = `INV-${slugify(variant.variantId)}`;
          transaction.set(db.collection("inventory").doc(inventoryId), {
            inventoryId,
            name: productData.name || productData.title || cleanProductId,
            itemId,
            productId: cleanProductId,
            variantId: variant.variantId,
            stockQty: variant.stock,
            updatedAt: now,
          }, { merge: true });
        });
      });

      return { success: true };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("Update product inventory error:", err);
      throw new HttpsError("internal", err.message || "Unable to update inventory.");
    }
  },
);
