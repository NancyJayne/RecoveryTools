import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

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

function normalizeProduct(doc) {
  const data = doc.data() || {};
  const images = Array.isArray(data.images) ? data.images.filter(Boolean) : [];
  const mediaImage = firstImageFromMedia(data.media);
  const image = images[0] || mediaImage || data.image || data.imageUrl || "";
  const price = Number(data.price ?? data.priceFrom ?? 0);
  const searchTags = normalizeTags(data);
  const visible =
    data.visible === true ||
    (
      data.visible !== false &&
      normalizeStatus(data.shopStatus) === "active" &&
      data.websiteVisible !== false
    );

  return {
    id: doc.id,
    productId: data.productId || doc.id,
    ...data,
    title: data.title || data.name || "",
    name: data.name || data.title || "",
    price,
    priceFrom: Number(data.priceFrom ?? price),
    stock: Number(data.stock ?? 0),
    type: normalizeStatus(data.type || "tool"),
    shopStatus: normalizeStatus(data.shopStatus || (visible ? "active" : "draft")),
    visible,
    image,
    images: images.length ? images : image ? [image] : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
    tagIds: Array.isArray(data.tagIds) ? data.tagIds : [],
    searchTags,
    features: Array.isArray(data.features) ? data.features : [],
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

      const snapshot = await query.orderBy("name").get();
      const products = snapshot.docs
        .map(normalizeProduct)
        .filter((product) => includeHidden && isAdmin ? true : product.visible !== false)
        .filter((product) => tag ? product.searchTags.includes(tag) : true);

      return { products };
    } catch (error) {
      console.error("Error fetching filtered products:", error);
      throw new HttpsError("internal", "Unable to fetch product list.");
    }
  },
);
