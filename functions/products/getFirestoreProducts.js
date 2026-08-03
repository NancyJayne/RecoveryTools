import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import {
  activePriceForProduct,
  loadProductArchitecture,
  mediaForProduct,
  mediaForProductVariant,
  primaryContentForProduct,
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

function blueprintIdsFromContent(content, architecture) {
  const ids = [];
  const add = (value) => {
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(add);
      return;
    }
    const id = typeof value === "string" ? value.trim() : "";
    if (id && architecture.blueprintsById?.has(id)) ids.push(id);
  };
  add(content?.linkedBlueprintIds);
  add(content?.templateFieldValues);
  add((content?.entityVariants || []).map((variant) => variant?.templateFieldValues));
  return [...new Set(ids)];
}

function courseModules(content, architecture) {
  return blueprintIdsFromContent(content, architecture)
    .map((id, index) => {
      const blueprint = architecture.blueprintsById.get(id);
      if (!blueprint) return null;
      const moduleStatus = normalizeStatus(blueprint.status || blueprint.approvalStatus);
      if (blueprint.archived === true || ["archived", "paused"].includes(moduleStatus)) return null;
      return {
        id,
        name: blueprint.name || blueprint.title || id,
        type: blueprint.type || blueprint.blueprintType || "",
        shortDescription: blueprint.shortDescription || blueprint.description || "",
        durationMinutes: Number(blueprint.durationMinutes || 0) || null,
        sortOrder: index + 1,
      };
    })
    .filter(Boolean);
}

function coursePreviewVideo(content, architecture) {
  const assetIds = [];
  const add = (value) => {
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(add);
      return;
    }
    const id = typeof value === "string" ? value.trim() : "";
    if (id && architecture.assetsById?.has(id)) assetIds.push(id);
  };
  add(content?.templateFieldValues);
  add((content?.entityVariants || []).map((variant) => variant?.templateFieldValues));
  for (const assetId of [...new Set(assetIds)]) {
    const asset = architecture.assetsById.get(assetId);
    const type = normalizeStatus(asset?.assetType || asset?.type);
    if (type !== "video" || normalizeStatus(asset?.status) === "archived") continue;
    return {
      assetId,
      type: "video",
      title: asset.title || asset.assetName || asset.name || "",
      url: asset.fileUrl || asset.url || "",
      embedUrl: asset.embedUrl || "",
    };
  }
  return null;
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function paidOrder(order) {
  const states = [order.paymentStatus, order.orderStatus, order.status].map(normalizeStatus);
  return states.includes("paid") &&
    !states.some((value) => ["cancelled", "canceled", "refunded", "failed", "void"].includes(value));
}

function ticketSalesFromOrders(snapshot) {
  const sales = new Map();
  snapshot.docs.forEach((doc) => {
    const order = doc.data() || {};
    if (!paidOrder(order)) return;
    const lines = Array.isArray(order.orderLines) && order.orderLines.length
      ? order.orderLines
      : Array.isArray(order.products) ? order.products : [];
    lines.forEach((line) => {
      const productId = String(line.productId || "").trim();
      const variantId = String(line.productVariantId || line.variantId || "").trim();
      if (!productId) return;
      const key = `${productId}:${variantId}`;
      sales.set(key, (sales.get(key) || 0) + Math.max(Number(line.quantity || 1), 1));
    });
  });
  return sales;
}

function normalizeProduct(doc, architecture, ticketSales = new Map()) {
  const data = doc.data() || {};
  const variants = variantsForProduct(doc.id, data.itemId || data.legacyItemId || "", architecture);
  const activePrice = activePriceForProduct(doc.id, architecture);
  const media = mediaForProduct(doc.id, data, architecture);
  const linkedContent = primaryContentForProduct(doc.id, data, architecture);
  const primaryLink = (architecture.productLinksByProductId?.get(doc.id) || [])
    .filter((link) => normalizeStatus(link.status || "active") === "active")
    .filter((link) => normalizeStatus(link.linkRole) !== "manufacturedfrom")
    .sort((left, right) => {
      if (left.isPrimary === true && right.isPrimary !== true) return -1;
      if (right.isPrimary === true && left.isPrimary !== true) return 1;
      return Number(left.sortOrder ?? 999) - Number(right.sortOrder ?? 999);
    })[0];
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
  const searchTags = [...new Set([
    ...normalizeTags(data),
    ...normalizeTags(linkedContent || {}),
  ])];
  const physicalFulfilment = data.physicalFulfilment ||
    (data.requiresShipping === true ? "shipping" : "none");
  const requiresShipping = ["shipping", "shipping-or-pickup"].includes(physicalFulfilment);
  const inventoryTracked = data.inventoryTracked ?? requiresShipping;
  const linkedContentStatus = normalizeStatus(linkedContent?.status);
  const linkedContentUnavailable = linkedContent?.archived === true ||
    ["paused", "archived"].includes(linkedContentStatus);
  const visible =
    data.archived !== true &&
    !linkedContentUnavailable &&
    (data.visible === true ||
      (
        data.visible !== false &&
        normalizeStatus(data.shopStatus) === "active" &&
        data.websiteVisible !== false
      ));

  const normalizedVariants = variants.map((variant) => {
    const variantMedia = mediaForProductVariant(doc.id, data, variant, architecture, media);
    const sold = ticketSales.get(`${doc.id}:${variant.variantId || variant.id || ""}`) || 0;
    const capacity = Number(variant.seatCapacity || 0);
    return {
      ...variant,
      ticketsSold: sold,
      ticketsRemaining: capacity > 0 ? Math.max(capacity - sold, 0) : null,
      media: variantMedia,
      images: variantMedia
        .filter((asset) => normalizeStatus(asset.type) === "image")
        .map((asset) => asset.url),
    };
  });
  const shortDescription = data.shortDescription || data.description ||
    linkedContent?.shortDescription || linkedContent?.description || "";
  const longDescription = data.longDescription ||
    linkedContent?.longDescription || linkedContent?.notes ||
    data.description || linkedContent?.description || shortDescription;
  const displayType = productDisplayType(data, linkedContent?.type || "tool");
  const isCourse = normalizeStatus(displayType).includes("course") ||
    normalizeStatus(data.type).includes("course") ||
    normalizeStatus(linkedContent?.type).includes("course");

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
    productType: displayType,
    shopStatus: normalizeStatus(data.shopStatus || (visible ? "active" : "draft")),
    visible,
    archived: data.archived === true,
    image: canonicalImages[0] || image,
    images: canonicalImages.length ? canonicalImages : images.length ? images : image ? [image] : [],
    media,
    tags: [...new Set([
      ...(Array.isArray(data.tags) ? data.tags : []),
      ...(Array.isArray(linkedContent?.tags) ? linkedContent.tags : []),
    ])],
    tagIds: [...new Set([
      ...(Array.isArray(data.tagIds) ? data.tagIds : []),
      ...(Array.isArray(linkedContent?.tagIds) ? linkedContent.tagIds : []),
    ])],
    searchTags,
    features: Array.isArray(data.features) ? data.features : [],
    variants: normalizedVariants,
    shortDescription,
    longDescription,
    courseModules: isCourse ? courseModules(linkedContent, architecture) : [],
    coursePreviewVideo: isCourse ? coursePreviewVideo(linkedContent, architecture) : null,
    connectedEntityType: primaryLink?.linkedEntityType || "",
    connectedEntityId: primaryLink?.linkedEntityId || data.itemId || data.legacyItemId || "",
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

      const [snapshot, architecture, ordersSnapshot] = await Promise.all([
        query.get(),
        loadProductArchitecture(admin.firestore()),
        admin.firestore().collection("orders").get(),
      ]);
      const ticketSales = ticketSalesFromOrders(ordersSnapshot);

      const products = snapshot.docs
        .map((doc) => normalizeProduct(doc, architecture, ticketSales))
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
