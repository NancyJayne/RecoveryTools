
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const PRODUCT_TYPES = new Set([
  "Physical", "Digital Download", "Plan Access", "Course Access", "Workshop Registration",
  "Program Access", "Service", "Bundle", "Membership", "Mixed",
]);

function legacyType(productType) {
  if (productType === "Course Access") return "course";
  if (productType === "Workshop Registration") return "workshop";
  if (["Plan Access", "Program Access"].includes(productType)) return "program";
  if (productType === "Digital Download") return "digital";
  return "tool";
}

/**
 * 🛠️ Admin: Update an existing product
 */
export const updateProduct = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }

    const { id, updates } = request.data || {};

    if (!id || typeof updates !== "object") {
      throw new HttpsError("invalid-argument", "Missing product ID or updates object.");
    }

    try {
      const db = admin.firestore();
      const productRef = db.collection("products").doc(id);
      const productSnapshot = await productRef.get();
      if (!productSnapshot.exists) throw new HttpsError("not-found", "Product not found.");
      const existing = productSnapshot.data() || {};
      const next = { ...updates };
      const canonicalType = PRODUCT_TYPES.has(updates.productType) ? updates.productType :
        PRODUCT_TYPES.has(updates.type) ? updates.type : existing.productType || "Physical";
      next.productId = id;
      next.productName = String(updates.name || updates.productName || existing.productName || "").trim();
      next.name = next.productName;
      next.title = next.productName;
      next.productType = canonicalType;
      next.type = legacyType(canonicalType);
      next.status = String(updates.status || existing.status || "draft").toLowerCase();
      next.shopStatus = String(updates.shopStatus || next.status).toLowerCase();
      next.websiteVisible = updates.websiteVisible === true || updates.visible === true;
      next.visible = next.websiteVisible;
      next.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      next.updatedByUid = request.auth.uid;
      next.updatedByEmail = request.auth.token.email || "";
      delete next.priceFrom;

      const numericPrice = Number(updates.price ?? updates.basePrice);
      const batch = db.batch();
      if (Number.isFinite(numericPrice)) {
        next.basePrice = numericPrice;
        next.price = numericPrice;
        const prices = await db.collection("productPrices").where("productId", "==", id).get();
        const activePrice = prices.docs.find((doc) => {
          const data = doc.data() || {};
          return data.status === "active" && !data.variantId;
        });
        const priceRef = activePrice?.ref || db.collection("productPrices").doc(`PRICE-${id}-BASE`);
        batch.set(priceRef, {
          priceId: priceRef.id,
          productId: id,
          variantId: "",
          currency: "AUD",
          retailPrice: numericPrice,
          salePrice: null,
          onSale: false,
          effectiveShopPrice: numericPrice,
          gstIncluded: true,
          gstAmount: Number((numericPrice / 11).toFixed(2)),
          status: "active",
          contentOrigin: "app",
          managedByWorkbook: false,
          updatedAt: next.updatedAt,
          createdAt: activePrice?.data()?.createdAt || next.updatedAt,
        }, { merge: true });
      }
      batch.set(productRef, next, { merge: true });
      await batch.commit();

      return { success: true };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("Update product error:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
