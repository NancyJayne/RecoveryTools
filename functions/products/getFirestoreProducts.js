import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import {
  activePriceForProduct,
  activePriceForVariant,
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

function dateMillis(value) {
  if (!value) return null;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function normalizeProduct(
  doc,
  architecture,
  ticketSales = new Map(),
  approvedAffiliate = false,
  instructorsById = new Map(),
) {
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
  const regularPrice = positiveNumber(
    activePrice?.retailPrice,
    data.retailPrice,
    data.basePrice,
    data.price,
    data.priceFrom,
  );
  const salePrice = data.salePrice ?? activePrice?.salePrice ?? null;
  const saleStartsAt = data.saleStartsAt || activePrice?.saleStartsAt || "";
  const saleEndsAt = data.saleEndsAt || activePrice?.saleEndsAt || "";
  const nowMs = Date.now();
  const saleStartsMs = dateMillis(saleStartsAt);
  const saleEndsMs = dateMillis(saleEndsAt);
  const onSale = Number(salePrice) >= 0 && salePrice !== null && salePrice !== "" &&
    (!saleStartsMs || saleStartsMs <= nowMs) && (!saleEndsMs || saleEndsMs > nowMs);
  const productWholesalePrice = data.wholesalePrice ?? activePrice?.wholesalePrice ?? activePrice?.affiliatePrice;
  const wholesalePrice = approvedAffiliate && Number(productWholesalePrice) > 0
    ? Number(productWholesalePrice)
    : null;
  const price = wholesalePrice ?? (onSale ? Number(salePrice) : regularPrice);
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
  const marketplaceMode = normalizeStatus(data.marketplaceMode ||
    (data.visible === true || data.websiteVisible === true ? "active" : "hidden"));
  const marketplaceStartsAt = data.marketplaceStartsAt || "";
  const marketplaceEndsAt = data.marketplaceEndsAt || "";
  const marketplaceStartsMs = dateMillis(marketplaceStartsAt);
  const marketplaceEndsMs = dateMillis(marketplaceEndsAt);
  const marketplaceEnded = marketplaceEndsMs && marketplaceEndsMs <= nowMs;
  const marketplaceStarted = !marketplaceStartsMs || marketplaceStartsMs <= nowMs;
  const comingSoon = marketplaceMode === "coming-soon" && !marketplaceStarted && !marketplaceEnded;
  const scheduledVisible = marketplaceMode === "scheduled" && marketplaceStarted;
  const modeVisible = marketplaceMode === "active" || marketplaceMode === "coming-soon" || scheduledVisible;
  let visible =
    data.archived !== true &&
    !linkedContentUnavailable &&
    !marketplaceEnded &&
    modeVisible;
  const purchasable = visible && !comingSoon;

  const normalizedVariants = variants.map((variant) => {
    const variantPrice = activePriceForVariant(doc.id, variant.variantId || variant.id, architecture);
    const variantMedia = mediaForProductVariant(doc.id, data, variant, architecture, media);
    const sold = ticketSales.get(`${doc.id}:${variant.variantId || variant.id || ""}`) || 0;
    const capacity = Number(variant.seatCapacity || 0);
    const variantMode = normalizeStatus(variant.marketplaceMode || "inherit");
    const variantStartsMs = dateMillis(variant.marketplaceStartsAt);
    const variantEndsMs = dateMillis(variant.marketplaceEndsAt);
    const variantStarted = !variantStartsMs || variantStartsMs <= nowMs;
    const variantEnded = variantEndsMs && variantEndsMs <= nowMs;
    const variantComingSoon = variantMode === "inherit"
      ? comingSoon
      : variantMode === "coming-soon" && !variantStarted && !variantEnded;
    const variantVisible = !variantEnded && (variantMode === "inherit"
      ? visible
      : variantMode === "active" || variantMode === "coming-soon" ||
        variantMode === "scheduled" && variantStarted);
    const variantSaleStartsMs = dateMillis(variant.saleStartsAt);
    const variantSaleEndsMs = dateMillis(variant.saleEndsAt);
    const variantOnSale = variant.salePrice !== null && variant.salePrice !== undefined &&
      variant.salePrice !== "" && (!variantSaleStartsMs || variantSaleStartsMs <= nowMs) &&
      (!variantSaleEndsMs || variantSaleEndsMs > nowMs);
    const variantRetailPrice = Number(variant.priceOverride) > 0
      ? Number(variant.priceOverride)
      : regularPrice;
    const variantWholesaleValue = variant.wholesalePrice ?? variantPrice?.wholesalePrice ??
      variantPrice?.affiliatePrice;
    const variantWholesalePrice = approvedAffiliate && Number(variantWholesaleValue) > 0
      ? Number(variantWholesaleValue)
      : wholesalePrice;
    const instructorId = variant.instructorId || variant.instructor || "";
    return {
      ...variant,
      instructorId,
      instructor: instructorsById.get(instructorId) || variant.instructor || "",
      visible: variantVisible,
      purchasable: variantVisible && !variantComingSoon,
      comingSoon: variantComingSoon,
      retailPriceOverride: variantRetailPrice,
      priceOverride: variantWholesalePrice ?? (variantOnSale ? Number(variant.salePrice) : variantRetailPrice),
      onSale: !variantWholesalePrice && variantOnSale,
      wholesalePrice: variantWholesalePrice,
      pricingTier: variantWholesalePrice ? "affiliate-wholesale" : "retail",
      wholesaleMinQuantity: Math.max(Number(
        variant.wholesaleMinQuantity || variantPrice?.wholesaleMinQuantity ||
          data.wholesaleMinQuantity || activePrice?.wholesaleMinQuantity || 1,
      ), 1),
      ticketsSold: sold,
      ticketsRemaining: capacity > 0 ? Math.max(capacity - sold, 0) : null,
      media: variantMedia,
      images: variantMedia
        .filter((asset) => normalizeStatus(asset.type) === "image")
        .map((asset) => asset.url),
    };
  }).filter((variant) => variant.visible !== false);
  if (variants.length && !normalizedVariants.length) visible = false;
  const shortDescription = data.shortDescription || data.description ||
    linkedContent?.shortDescription || linkedContent?.description || "";
  const longDescription = data.longDescription ||
    linkedContent?.longDescription || linkedContent?.notes ||
    data.description || linkedContent?.description || shortDescription;
  const displayType = productDisplayType(data, linkedContent?.type || "tool");
  const isCourse = normalizeStatus(displayType).includes("course") ||
    normalizeStatus(data.type).includes("course") ||
    normalizeStatus(linkedContent?.type).includes("course");
  const instructorId = data.instructorId || data.instructor || "";

  return {
    id: doc.id,
    productId: data.productId || doc.id,
    ...data,
    title: productDisplayName(data),
    name: productDisplayName(data),
    price,
    priceFrom: positiveNumber(data.priceFrom, price),
    retailPrice: regularPrice,
    salePrice,
    saleStartsAt,
    saleEndsAt,
    onSale: !wholesalePrice && onSale,
    wholesalePrice,
    wholesaleMinQuantity: Math.max(Number(
      data.wholesaleMinQuantity || activePrice?.wholesaleMinQuantity || 1,
    ), 1),
    pricingTier: wholesalePrice ? "affiliate-wholesale" : "retail",
    stock: Number(data.stock ?? 0),
    requiresShipping,
    physicalFulfilment,
    inventoryTracked,
    type: normalizeStatus(data.type || productDisplayType(data, "tool")),
    productType: displayType,
    instructorId,
    instructor: instructorsById.get(instructorId) || data.instructor || "",
    shopStatus: normalizeStatus(data.shopStatus || (visible ? "active" : "draft")),
    visible,
    purchasable,
    comingSoon,
    marketplaceMode,
    marketplaceStartsAt,
    marketplaceEndsAt,
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
      let approvedAffiliate = false;
      if (request.auth?.uid && request.auth.token?.affiliate === true) {
        const userSnap = await admin.firestore().collection("users").doc(request.auth.uid).get();
        const user = userSnap.exists ? userSnap.data() || {} : {};
        const affiliateStatus = normalizeStatus(user.affiliateApplicationStatus || user.status);
        approvedAffiliate = user.roles?.affiliate === true &&
          !["pending", "rejected", "inactive", "archived"].includes(affiliateStatus);
      }

      let query = admin.firestore().collection("products");

      if (type) {
        query = query.where("type", "==", normalizeStatus(type));
      }

      const [snapshot, architecture, ordersSnapshot, instructorsSnapshot] = await Promise.all([
        query.get(),
        loadProductArchitecture(admin.firestore()),
        admin.firestore().collection("orders").get(),
        admin.firestore().collection("instructors").get(),
      ]);
      const ticketSales = ticketSalesFromOrders(ordersSnapshot);
      const instructorsById = new Map(instructorsSnapshot.docs.map((doc) => [
        doc.id,
        doc.data()?.name || doc.data()?.instructorName || doc.data()?.displayName || doc.id,
      ]));

      const products = snapshot.docs
        .map((doc) => normalizeProduct(
          doc,
          architecture,
          ticketSales,
          approvedAffiliate,
          instructorsById,
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
