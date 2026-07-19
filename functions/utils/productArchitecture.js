function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function status(value, fallback = "") {
  return cleanString(value || fallback).toLowerCase().replace(/\s+/g, "-");
}

function groupDocs(snapshot, key) {
  const grouped = new Map();
  snapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    const groupId = cleanString(data[key]);
    if (!groupId) return;
    const values = grouped.get(groupId) || [];
    values.push({ id: doc.id, ...data });
    grouped.set(groupId, values);
  });
  return grouped;
}

export async function loadProductArchitecture(db) {
  const [
    prices,
    canonicalVariants,
    legacyVariants,
    entityAssets,
    assets,
    renditions,
    accessGrants,
    productComponents,
    inventory,
  ] = await Promise.all([
    db.collection("productPrices").get(),
    db.collection("productVariants").get(),
    db.collection("itemVariants").get(),
    db.collection("entityAssets").get(),
    db.collection("assets").get(),
    db.collection("assetRenditions").get(),
    db.collection("productAccessGrants").get(),
    db.collection("productComponents").get(),
    db.collection("inventory").get(),
  ]);

  return {
    pricesByProductId: groupDocs(prices, "productId"),
    canonicalVariantsByProductId: groupDocs(canonicalVariants, "productId"),
    legacyVariantsByProductId: groupDocs(legacyVariants, "productId"),
    legacyVariantsByItemId: groupDocs(legacyVariants, "itemId"),
    entityAssetsByEntityId: groupDocs(entityAssets, "entityId"),
    renditionsByAssetId: groupDocs(renditions, "assetId"),
    accessGrantsByProductId: groupDocs(accessGrants, "productId"),
    componentsByProductId: groupDocs(productComponents, "productId"),
    inventoryByProductId: groupDocs(inventory, "productId"),
    inventoryByVariantId: groupDocs(inventory, "variantId"),
    inventoryByItemId: groupDocs(inventory, "itemId"),
    assetsById: new Map(assets.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }])),
  };
}

export function componentsForProduct(productId, variantId, architecture) {
  return (architecture.componentsByProductId.get(productId) || [])
    .filter((component) => status(component.status, "active") === "active")
    .filter((component) => !component.productVariantId || component.productVariantId === variantId)
    .map((component) => ({
      id: component.id,
      productComponentId: component.productComponentId || component.id,
      itemId: component.itemId || "",
      quantity: Number(component.quantity || 1),
      unit: component.unit || "each",
      inventoryAction: component.inventoryAction || "deduct",
      optional: component.isOptional === true,
    }))
    .filter((component) => component.itemId);
}

export function activePriceForProduct(productId, architecture) {
  return (architecture.pricesByProductId.get(productId) || [])
    .find((price) => status(price.status, "active") === "active" && !price.variantId) || null;
}

function normalizedVariant(variant, sourceCollection) {
  return {
    id: variant.id,
    variantId: variant.productVariantId || variant.variantId || variant.id,
    productId: variant.productId || "",
    name: variant.variantName || variant.name || variant.optionSummary || "",
    colour: variant.colour || "",
    size: variant.size || "",
    sku: variant.sku || "",
    priceOverride: variant.priceOverride ?? null,
    stock: Number(variant.stockQuantity ?? variant.stock ?? 0),
    stockStatus: variant.stockStatus || "",
    isDefault: variant.isDefault === true,
    inventoryTracked: variant.inventoryTracked === true,
    sourceCollection,
  };
}

export function variantsForProduct(productId, itemId, architecture) {
  const canonical = (architecture.canonicalVariantsByProductId.get(productId) || [])
    .filter((variant) => status(variant.status, "active") === "active")
    .map((variant) => normalizedVariant(variant, "productVariants"));
  if (canonical.length) return canonical;

  const legacy = [
    ...(architecture.legacyVariantsByProductId.get(productId) || []),
    ...(architecture.legacyVariantsByItemId.get(itemId) || []),
  ];
  const seen = new Set();
  return legacy
    .filter((variant) => status(variant.status, "active") === "active")
    .filter((variant) => {
      if (seen.has(variant.id)) return false;
      seen.add(variant.id);
      return true;
    })
    .map((variant) => normalizedVariant(variant, "itemVariants"));
}

export function variantForProduct(productId, itemId, variantId, architecture) {
  if (!variantId) return null;
  return variantsForProduct(productId, itemId, architecture)
    .find((variant) => variant.variantId === variantId || variant.id === variantId) || null;
}

export function inventoryForProduct(productId, itemId, variantId, architecture) {
  const variantInventory = variantId
    ? architecture.inventoryByVariantId?.get(variantId) || []
    : [];
  const productInventory = architecture.inventoryByProductId?.get(productId) || [];
  const itemInventory = itemId ? architecture.inventoryByItemId?.get(itemId) || [] : [];
  return variantInventory[0] || productInventory.find((entry) => !entry.variantId) ||
    itemInventory.find((entry) => !entry.variantId) || productInventory[0] || itemInventory[0] || null;
}

function assetUrl(asset, rendition) {
  return rendition?.fileUrl || asset?.fileUrl || asset?.url || "";
}

export function mediaForProduct(productId, product, architecture) {
  const itemId = cleanString(product.itemId || product.legacyItemId);
  const links = (architecture.entityAssetsByEntityId.get(productId) || [])
    .filter((link) => link.entityType === "Product" && status(link.status, "active") === "active");
  const itemLinks = links.length ? [] : (architecture.entityAssetsByEntityId.get(itemId) || [])
    .filter((link) => link.entityType === "Item" && status(link.status, "active") === "active");
  const canonicalMedia = [...links, ...itemLinks]
    .map((link) => {
      const asset = architecture.assetsById.get(link.assetId);
      if (!asset || status(asset.status, "active") === "archived") return null;
      const renditions = architecture.renditionsByAssetId.get(link.assetId) || [];
      const thumbnail = renditions.find((rendition) =>
        status(rendition.status, "active") === "active" &&
        cleanString(rendition.purpose).toLowerCase() === "thumbnail");
      return {
        assetId: link.assetId,
        type: cleanString(asset.assetType || asset.type).toLowerCase(),
        purpose: link.assetRole || link.purpose || "",
        title: asset.title || asset.assetName || asset.name || "",
        altText: asset.altText || "",
        url: assetUrl(asset),
        thumbnailUrl: assetUrl(asset, thumbnail),
        sortOrder: Number(link.sortOrder ?? 999),
        displayStatus: link.displayStatus || link.status || "active",
      };
    })
    .filter((asset) => asset?.url)
    .sort((left, right) => left.sortOrder - right.sortOrder);

  if (canonicalMedia.length) return canonicalMedia;
  if (Array.isArray(product.media) && product.media.length) return product.media;
  const images = Array.isArray(product.images) ? product.images : [];
  return images.map((url, index) => ({
    assetId: "",
    type: "image",
    purpose: index === 0 ? "Hero" : "Gallery",
    title: product.productName || product.name || "",
    altText: product.productName || product.name || "",
    url,
    thumbnailUrl: "",
    sortOrder: index + 1,
    displayStatus: "active",
  }));
}

function legacyAccessGrants(productId, product) {
  const targets = [
    product.relatedPlanId && ["Plan", product.relatedPlanId],
    product.relatedCourseId && ["Plan", product.relatedCourseId],
    product.relatedWorkshopId && ["Plan", product.relatedWorkshopId],
  ].filter(Boolean);
  const seen = new Set();
  return targets
    .filter(([, id]) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(([accessEntityType, accessEntityId]) => ({
      id: `legacy-${productId}-${accessEntityId}`,
      productAccessGrantId: "",
      productId,
      accessEntityType,
      accessEntityId,
      grantTiming: "on-payment-confirmed",
      durationType: "permanent",
      revocable: true,
      status: "active",
      source: "legacy",
    }));
}

export function accessGrantsForProduct(productId, product, architecture) {
  const canonical = (architecture.accessGrantsByProductId.get(productId) || [])
    .filter((grant) => status(grant.status, "active") === "active")
    .map((grant) => ({ ...grant, source: "canonical" }));
  if (canonical.length) return canonical;
  return legacyAccessGrants(productId, product);
}

export function productDisplayName(product, fallback = "") {
  return product.productName || product.name || product.title || fallback;
}

export function productDisplayType(product, fallback = "item") {
  return product.productType || product.type || fallback;
}
