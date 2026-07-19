import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

function normalizeStatus(value, fallback = "") {
  return String(value || fallback).trim().toLowerCase();
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
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

export const createProduct = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError(
        "permission-denied",
        "Admin access required.",
      );
    }

    const {
      name,
      price,
      priceFrom,
      description,
      shortDescription,
      longDescription,
      stock,
      type,
      image,
      imageUrl,
      images,
      media,
      tags,
      tagIds,
      features,
      slug,
      sku,
      visible,
      websiteVisible,
      shopStatus,
      requiresShipping,
      inventoryTracked,
      creatorId,
      productType,
      status,
      productId,
    } = request.data || {};

    const productName = String(name || "").trim();
    const numericPrice = Number(price ?? priceFrom);

    if (!productName || !Number.isFinite(numericPrice)) {
      throw new HttpsError("invalid-argument", "Missing or invalid product fields.");
    }

    try {
      const normalizedImages = asArray(images);
      const normalizedMedia = asArray(media);
      const fallbackImage = image || imageUrl || normalizedImages[0] || "";
      const normalizedDescription = description || shortDescription || longDescription || "";
      const canonicalType = PRODUCT_TYPES.has(productType) ? productType :
        PRODUCT_TYPES.has(type) ? type : "Physical";
      const isVisible = visible === true || websiteVisible === true;
      const normalizedType = legacyType(canonicalType);
      const defaultRequiresShipping = !["course", "workshop", "program", "digital", "session"].includes(normalizedType);
      const normalizedRequiresShipping = requiresShipping ?? defaultRequiresShipping;
      const db = admin.firestore();
      const generatedId = String(productId || `PROD-${slugify(productName)}-${Date.now()}`).toUpperCase();
      const productRef = db.collection("products").doc(generatedId);
      const priceRef = db.collection("productPrices").doc(`PRICE-${generatedId}-BASE`);
      const now = admin.firestore.FieldValue.serverTimestamp();
      const normalizedStatus = normalizeStatus(status, "draft");
      const batch = db.batch();
      batch.create(productRef, {
        productId: generatedId,
        productName,
        productType: canonicalType,
        name: productName,
        title: productName,
        price: numericPrice,
        basePrice: numericPrice,
        currency: "AUD",
        priceFrom: Number(priceFrom ?? numericPrice),
        description: normalizedDescription,
        shortDescription: shortDescription || normalizedDescription,
        longDescription: longDescription || normalizedDescription,
        stock: Number(stock ?? 0),
        type: normalizedType,
        requiresShipping: normalizedRequiresShipping,
        inventoryTracked: inventoryTracked ?? normalizedRequiresShipping,
        image: fallbackImage,
        imageUrl: fallbackImage,
        images: normalizedImages.length ? normalizedImages : fallbackImage ? [fallbackImage] : [],
        media: normalizedMedia,
        tags: asArray(tags),
        tagIds: asArray(tagIds),
        features: asArray(features),
        slug: slugify(slug || productName),
        sku: sku || null,
        visible: isVisible,
        websiteVisible: isVisible,
        status: normalizedStatus,
        shopStatus: normalizeStatus(shopStatus, normalizedStatus),
        approvalStatus: normalizedStatus === "active" ? "approved" : "draft",
        creatorId: creatorId || request.auth.uid,
        creatorUserId: creatorId || request.auth.uid,
        ownerUserId: request.auth.uid,
        soldByRecoveryTools: true,
        contentOrigin: "app",
        managedByWorkbook: false,
        createdAt: now,
        updatedAt: now,
      });
      batch.create(priceRef, {
        priceId: priceRef.id,
        productId: generatedId,
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
        createdAt: now,
        updatedAt: now,
      });
      await batch.commit();

      return { success: true, id: productRef.id };
    } catch (err) {
      console.error("Create product error:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
