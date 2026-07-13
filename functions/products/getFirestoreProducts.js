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

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function normalizeProduct(doc, variants = [], activePrice = null) {
  const data = doc.data() || {};
  const images = Array.isArray(data.images) ? data.images.filter(Boolean) : [];
  const mediaImage = firstImageFromMedia(data.media);
  const image = images[0] || mediaImage || data.image || data.imageUrl || "";
  const price = positiveNumber(
    activePrice?.effectiveShopPrice,
    data.price,
    data.priceFrom,
    activePrice?.retailPrice,
    data.retailPrice,
  );
  const searchTags = normalizeTags(data);
  const requiresShipping = data.requiresShipping !== false;
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
    title: data.title || data.name || "",
    name: data.name || data.title || "",
    price,
    priceFrom: positiveNumber(data.priceFrom, price),
    retailPrice: positiveNumber(activePrice?.retailPrice, data.retailPrice, price),
    salePrice: data.salePrice ?? activePrice?.salePrice ?? null,
    onSale: data.onSale === true || activePrice?.salePrice !== null && activePrice?.salePrice !== undefined,
    stock: Number(data.stock ?? 0),
    requiresShipping,
    inventoryTracked,
    type: normalizeStatus(data.type || "tool"),
    shopStatus: normalizeStatus(data.shopStatus || (visible ? "active" : "draft")),
    visible,
    archived: data.archived === true,
    image,
    images: images.length ? images : image ? [image] : [],
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

      const [snapshot, variantsSnapshot] = await Promise.all([
        query.get(),
        admin.firestore().collection("itemVariants").get(),
      ]);
      const pricesSnapshot = await admin.firestore().collection("productPrices").get();
      const activePricesByProductId = new Map();
      pricesSnapshot.docs.forEach((priceDoc) => {
        const data = priceDoc.data() || {};
        if (normalizeStatus(data.status) !== "active" || data.variantId || !data.productId) return;
        activePricesByProductId.set(data.productId, { id: priceDoc.id, ...data });
      });
      const variantsByProductId = new Map();
      variantsSnapshot.docs.forEach((variantDoc) => {
        const data = variantDoc.data() || {};
        if (normalizeStatus(data.status || "active") !== "active") return;
        const productId = data.productId || "";
        if (!productId) return;
        if (!variantsByProductId.has(productId)) variantsByProductId.set(productId, []);
        variantsByProductId.get(productId).push({
          id: variantDoc.id,
          variantId: data.variantId || variantDoc.id,
          name: data.name || "",
          colour: data.colour || "",
          size: data.size || "",
          sku: data.sku || "",
          priceOverride: data.priceOverride ?? null,
          stock: Number(data.stock ?? 0),
        });
      });

      const products = snapshot.docs
        .map((doc) => normalizeProduct(
          doc,
          variantsByProductId.get(doc.id) || [],
          activePricesByProductId.get(doc.id) || null,
        ))
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
