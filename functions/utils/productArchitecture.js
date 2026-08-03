function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function status(value, fallback = "") {
  return cleanString(value || fallback).toLowerCase().replace(/\s+/g, "-");
}

function dateTimeValue(value) {
  if (!value) return "";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? cleanString(value) : date.toISOString().slice(0, 16);
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
    productLinks,
    items,
    blueprints,
    plans,
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
    db.collection("productLinks").get(),
    db.collection("items").get(),
    db.collection("blueprints").get(),
    db.collection("plans").get(),
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
    productLinksByProductId: groupDocs(productLinks, "productId"),
    itemsById: new Map(items.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }])),
    blueprintsById: new Map(blueprints.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }])),
    plansById: new Map(plans.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }])),
    assetsById: new Map(assets.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }])),
  };
}

export function primaryContentForProduct(productId, product, architecture) {
  const links = architecture.productLinksByProductId?.get(productId) || [];
  const preferred = links
    .filter((link) => status(link.status, "active") === "active")
    .filter((link) => status(link.linkRole) !== "manufacturedfrom")
    .sort((left, right) => {
      if (left.isPrimary === true && right.isPrimary !== true) return -1;
      if (right.isPrimary === true && left.isPrimary !== true) return 1;
      return Number(left.sortOrder ?? 999) - Number(right.sortOrder ?? 999);
    })[0];
  const entityType = cleanString(preferred?.linkedEntityType).toLowerCase();
  const entityId = cleanString(preferred?.linkedEntityId);
  if (entityType === "item") return architecture.itemsById?.get(entityId) || null;
  if (entityType === "blueprint") return architecture.blueprintsById?.get(entityId) || null;
  if (entityType === "plan") return architecture.plansById?.get(entityId) || null;

  const itemId = cleanString(product.itemId || product.legacyItemId);
  return itemId ? architecture.itemsById?.get(itemId) || null : null;
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
  const numericPriceOverride = Number(variant.priceOverride);
  return {
    id: variant.id,
    variantId: variant.productVariantId || variant.variantId || variant.id,
    productId: variant.productId || "",
    name: variant.variantName || variant.name || variant.optionSummary || "",
    colour: variant.colour || "",
    size: variant.size || "",
    sku: variant.sku || "",
    priceOverride: Number.isFinite(numericPriceOverride) && numericPriceOverride > 0
      ? numericPriceOverride
      : null,
    stock: Number(variant.stockQuantity ?? variant.stock ?? 0),
    stockStatus: variant.stockStatus || "",
    isDefault: variant.isDefault === true,
    inventoryTracked: variant.inventoryTracked === true,
    status: variant.status || "active",
    contentVariantId: variant.contentVariantId || "",
    deliveryMode: variant.deliveryMode || "",
    physicalFulfilment: variant.physicalFulfilment || "",
    calendarBookingReference: variant.calendarBookingReference || "",
    seatCapacity: Number.isFinite(Number(variant.seatCapacity)) ? Number(variant.seatCapacity) : null,
    nearCapacityWarning: Number.isFinite(Number(variant.nearCapacityWarning))
      ? Number(variant.nearCapacityWarning)
      : null,
    eventStartAt: dateTimeValue(variant.eventStartAt),
    eventEndAt: dateTimeValue(variant.eventEndAt),
    eventLocation: variant.eventLocation || "",
    instructor: variant.instructor || "",
    shortDescription: variant.shortDescription || "",
    longDescription: variant.longDescription || "",
    inclusions: variant.inclusions || "",
    primaryAssetId: variant.primaryAssetId || "",
    sourceCollection,
  };
}

export function variantsForProduct(productId, itemId, architecture, includeInactive = false) {
  const canonical = (architecture.canonicalVariantsByProductId.get(productId) || [])
    .filter((variant) => includeInactive || status(variant.status, "active") === "active")
    .map((variant) => normalizedVariant(variant, "productVariants"));
  if (canonical.length) return canonical;

  const legacy = [
    ...(architecture.legacyVariantsByProductId.get(productId) || []),
    ...(architecture.legacyVariantsByItemId.get(itemId) || []),
  ];
  const seen = new Set();
  return legacy
    .filter((variant) => includeInactive || status(variant.status, "active") === "active")
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
  const content = primaryContentForProduct(productId, product, architecture);
  const contentId = cleanString(
    content?.itemId || content?.blueprintId || content?.planId || content?.id ||
    product.itemId || product.legacyItemId,
  );
  const contentType = content?.planId
    ? "plan"
    : content?.blueprintId ? "blueprint" : "item";
  const links = (architecture.entityAssetsByEntityId.get(productId) || [])
    .filter((link) =>
      cleanString(link.entityType).toLowerCase() === "product" &&
      status(link.status, "active") === "active");
  const contentLinks = links.length ? [] : (architecture.entityAssetsByEntityId.get(contentId) || [])
    .filter((link) =>
      cleanString(link.entityType).toLowerCase() === contentType &&
      status(link.status, "active") === "active");
  const canonicalMedia = [...links, ...contentLinks]
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
        embedUrl: asset.embedUrl || "",
        thumbnailUrl: assetUrl(asset, thumbnail),
        sortOrder: Number(link.sortOrder ?? 999),
        displayStatus: link.displayStatus || link.status || "active",
      };
    })
    .filter((asset) => asset?.url)
    .sort((left, right) => left.sortOrder - right.sortOrder);

  if (canonicalMedia.length) return canonicalMedia;
  const templateAssetIds = [
    ...assetIdsFromTemplateValues(content?.templateFieldValues),
    ...(Array.isArray(content?.entityVariants) ? content.entityVariants : [])
      .flatMap((variant) => assetIdsFromTemplateValues(variant?.templateFieldValues)),
  ];
  const templateMedia = [...new Set(templateAssetIds)]
    .map((assetId, index) => assetMedia(assetId, architecture, index + 1))
    .filter(Boolean);
  if (templateMedia.length) return templateMedia;
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

function assetMedia(assetId, architecture, sortOrder = 1) {
  const asset = architecture.assetsById.get(assetId);
  if (!asset || status(asset.status, "active") === "archived") return null;
  const renditions = architecture.renditionsByAssetId.get(assetId) || [];
  const thumbnail = renditions.find((rendition) =>
    status(rendition.status, "active") === "active" &&
    cleanString(rendition.purpose).toLowerCase() === "thumbnail");
  const url = assetUrl(asset);
  if (!url) return null;
  return {
    assetId,
    type: cleanString(asset.assetType || asset.type).toLowerCase(),
    purpose: "Variant",
    title: asset.title || asset.assetName || asset.name || "",
    altText: asset.altText || "",
    url,
    embedUrl: asset.embedUrl || "",
    thumbnailUrl: assetUrl(asset, thumbnail),
    sortOrder,
    displayStatus: "active",
  };
}

function assetIdsFromTemplateValues(values) {
  const ids = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
      return;
    }
    const id = cleanString(value);
    if (id && id.toUpperCase().startsWith("ASSET-")) ids.push(id);
  };
  visit(values);
  return [...new Set(ids)];
}

export function mediaForProductVariant(productId, product, variant, architecture, fallback = []) {
  if (!variant) return fallback;
  const variantId = cleanString(variant.variantId || variant.id);
  const contentVariantId = cleanString(variant.contentVariantId);
  const directLinks = [
    ...(architecture.entityAssetsByEntityId.get(variantId) || []),
    ...(architecture.entityAssetsByEntityId.get(productId) || []),
  ].filter((link) =>
    status(link.status, "active") === "active" &&
    (
      cleanString(link.entityType).toLowerCase() === "productvariant" ||
      cleanString(link.productVariantId) === variantId ||
      cleanString(link.entityVariantId) === contentVariantId
    ));
  const directMedia = directLinks
    .map((link, index) => assetMedia(link.assetId, architecture, Number(link.sortOrder ?? index + 1)))
    .filter(Boolean)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  if (directMedia.length) return directMedia;

  const content = primaryContentForProduct(productId, product, architecture);
  const contentVariant = (content?.entityVariants || []).find((candidate) =>
    cleanString(candidate.entityVariantId) === contentVariantId);
  const assetIds = [
    cleanString(variant.primaryAssetId),
    ...assetIdsFromTemplateValues(contentVariant?.templateFieldValues),
  ].filter(Boolean);
  const inferredMedia = [...new Set(assetIds)]
    .map((assetId, index) => assetMedia(assetId, architecture, index + 1))
    .filter(Boolean);
  return inferredMedia.length ? inferredMedia : fallback;
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
  const seen = new Set();
  const canonical = (architecture.accessGrantsByProductId.get(productId) || [])
    .filter((grant) => status(grant.status, "active") === "active")
    .filter((grant) => {
      const key = `${grant.productVariantId || "ALL"}:` +
        `${grant.accessEntityType || grant.accessType}:${grant.accessEntityId || grant.accessId}:` +
        `${grant.accessEntityVariantId || "ALL"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
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
