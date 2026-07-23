import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import {
  activePriceForProduct,
  loadProductArchitecture,
  mediaForProduct,
  productDisplayName,
  productDisplayType,
  variantsForProduct,
} from "../utils/productArchitecture.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function firstImageFromMedia(media) {
  if (!Array.isArray(media)) return "";

  const image = media
    .filter((asset) => normalizeStatus(asset?.type) === "image")
    .sort((a, b) => (a?.sortOrder ?? 999) - (b?.sortOrder ?? 999))[0];

  return image?.url || "";
}

function normalizeTags(data) {
  return [
    ...(Array.isArray(data.tags) ? data.tags : []),
    ...(Array.isArray(data.tagIds) ? data.tagIds : []),
  ];
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function normalizeProduct(doc, architecture) {
  const data = doc.data() || {};
  const variants = variantsForProduct(doc.id, data.itemId || data.legacyItemId || "", architecture);
  const activePrice = activePriceForProduct(doc.id, architecture);
  const media = mediaForProduct(doc.id, data, architecture);
  const images = Array.isArray(data.images) ? data.images.filter(Boolean) : [];
  const canonicalImages = media.filter((asset) => normalizeStatus(asset.type) === "image").map((asset) => asset.url);
  const mediaImage = firstImageFromMedia(media);
  const image = images[0] || mediaImage || data.image || data.imageUrl || "";
  const price = positiveNumber(
    activePrice?.effectiveShopPrice,
    data.price,
    data.priceFrom,
    activePrice?.retailPrice,
    data.retailPrice,
  );
  const searchTags = normalizeTags(data);
  const physicalFulfilment = data.physicalFulfilment ||
    (data.requiresShipping === true ? "shipping" : "none");
  const requiresShipping = ["shipping", "shipping-or-pickup"].includes(physicalFulfilment);
  const inventoryTracked = data.inventoryTracked ?? requiresShipping;
  const visible =
    data.archived !== true &&
    (data.visible === true ||
      (
        data.visible !== false &&
        normalizeStatus(data.shopStatus) === "active" &&
        data.websiteVisible !== false
      ));

  return {
    id: doc.id,
    productId: data.productId || doc.id,
    ...data,
    title: productDisplayName(data),
    name: productDisplayName(data),
    price,
    priceFrom: positiveNumber(data.priceFrom, price),
    retailPrice: positiveNumber(activePrice?.retailPrice, data.retailPrice, price),
    salePrice: data.salePrice ?? activePrice?.salePrice ?? null,
    onSale: data.onSale === true || activePrice?.salePrice !== null && activePrice?.salePrice !== undefined,
    stock: Number(data.stock ?? 0),
    requiresShipping,
    physicalFulfilment,
    inventoryTracked,
    type: normalizeStatus(data.type || productDisplayType(data, "tool")),
    productType: productDisplayType(data, "tool"),
    shopStatus: normalizeStatus(data.shopStatus || (visible ? "active" : "draft")),
    visible,
    archived: data.archived === true,
    image: canonicalImages[0] || image,
    images: canonicalImages.length ? canonicalImages : images.length ? images : image ? [image] : [],
    media,
    tags: Array.isArray(data.tags) ? data.tags : [],
    tagIds: Array.isArray(data.tagIds) ? data.tagIds : [],
    searchTags,
    features: Array.isArray(data.features) ? data.features : [],
    variants,
    shortDescription: data.shortDescription || data.description || "",
    longDescription: data.longDescription || data.description || "",
  };
}

export const getFirestoreProducts = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    try {
      const { type, tag, includeHidden = false } = request.data || {};
      const isAdmin = request.auth?.token?.admin === true;

      let query = admin.firestore().collection("products");

      if (type) {
        query = query.where("type", "==", normalizeStatus(type));
      }

      const [snapshot, architecture] = await Promise.all([
        query.get(),
        loadProductArchitecture(admin.firestore()),
      ]);

      const products = snapshot.docs
        .map((doc) => normalizeProduct(doc, architecture))
        .filter((product) => includeHidden && isAdmin ? true : product.visible !== false)
        .filter((product) => tag ? product.searchTags.includes(tag) : true)
        .sort((a, b) => (a.name || a.title || "").localeCompare(b.name || b.title || ""));

      return { products };
    } catch (error) {
      console.error("Error fetching filtered products:", error);
      throw new HttpsError("internal", "Unable to fetch product list.");
    }
  },
);
