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
      creatorId,
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
      const isVisible = visible ?? websiteVisible ?? true;

      const productRef = await admin.firestore().collection("products").add({
        name: productName,
        title: productName,
        price: numericPrice,
        priceFrom: Number(priceFrom ?? numericPrice),
        description: normalizedDescription,
        shortDescription: shortDescription || normalizedDescription,
        longDescription: longDescription || normalizedDescription,
        stock: Number(stock ?? 0),
        type: normalizeStatus(type, "tool"),
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
        shopStatus: normalizeStatus(shopStatus, isVisible ? "active" : "draft"),
        creatorId: creatorId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, id: productRef.id };
    } catch (err) {
      console.error("Create product error:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
