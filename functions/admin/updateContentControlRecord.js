import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const COLLECTION_BY_TYPE = {
  item: "items",
  items: "items",
  blueprint: "blueprints",
  blueprints: "blueprints",
  plan: "plans",
  plans: "plans",
  campaign: "campaigns",
  campaigns: "campaigns",
};

const TYPE_FIELD_BY_COLLECTION = {
  items: "type",
  blueprints: "type",
  plans: "type",
  campaigns: "type",
};

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function actorOwnership(request) {
  const token = request.auth?.token || {};
  if (token.therapist === true) {
    return { owner: cleanString(token.businessName || token.email) || request.auth.uid, ownerType: "therapist" };
  }
  if (token.affiliate === true) {
    return { owner: cleanString(token.businessName || token.email) || request.auth.uid, ownerType: "affiliate" };
  }
  return { owner: "Recovery Tools", ownerType: "admin" };
}

function slugify(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

function generatedProductSku(productId) {
  const token = slugify(productId).replace(/^(PROD|PRODUCT|ITEM|BLUEPRINT|PLAN)-/, "");
  return `RT-${token || "PRODUCT"}`;
}

function cleanAccessGrants(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map((grant) => ({
    accessEntityType: ["Item", "Blueprint", "Plan"].includes(cleanString(grant?.accessEntityType))
      ? cleanString(grant.accessEntityType)
      : "",
    accessEntityId: cleanString(grant?.accessEntityId),
    accessEntityVariantId: cleanString(grant?.accessEntityVariantId || grant?.entityVariantId),
    productVariantId: cleanString(grant?.productVariantId),
  })).filter((grant) => {
    const key = `${grant.productVariantId}:${grant.accessEntityType}:${grant.accessEntityId}:` +
      grant.accessEntityVariantId;
    if (!grant.accessEntityType || !grant.accessEntityId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanVariantContentLinks(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).slice(0, 200).map((link) => ({
    productVariantId: cleanString(link?.productVariantId),
    entityType: ["Item", "Blueprint", "Plan"].includes(cleanString(link?.entityType))
      ? cleanString(link.entityType)
      : "",
    entityId: cleanString(link?.entityId),
    entityVariantId: cleanString(link?.entityVariantId),
    linkRole: ["Represents", "ManufacturedFrom", "Unlocks"].includes(cleanString(link?.linkRole))
      ? cleanString(link.linkRole)
      : "Represents",
    status: "active",
  })).filter((link) => {
    const key = `${link.productVariantId}:${link.entityType}:${link.entityId}:${link.entityVariantId}:${link.linkRole}`;
    if (!link.productVariantId || !link.entityType || !link.entityId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value) {
  return value === true;
}

function productTypeValue(value, fallback = "tool") {
  const cleanValue = cleanString(value).toLowerCase();
  if (["physical product", "shop product", "tool", "tools"].includes(cleanValue)) return "tool";
  if (["digital product", "digital", "course", "courses"].includes(cleanValue)) return "course";
  if (["session", "workshop", "webinar", "workshops"].includes(cleanValue)) return "workshop";
  if (["program", "plan", "programs"].includes(cleanValue)) return "program";
  return cleanValue || fallback;
}

function canonicalProductTypeValue(value) {
  const cleanValue = cleanString(value).toLowerCase();
  if (["digital download", "download"].includes(cleanValue)) return "Digital Download";
  if (["course access", "course", "digital product"].includes(cleanValue)) return "Course Access";
  if (["workshop registration", "workshop", "session", "event", "webinar"].includes(cleanValue)) {
    return "Workshop Registration";
  }
  if (["plan access", "plan"].includes(cleanValue)) return "Plan Access";
  if (["program access", "program"].includes(cleanValue)) return "Program Access";
  if (cleanValue === "hybrid") return "Hybrid";
  if (["service", "bundle", "membership", "mixed"].includes(cleanValue)) {
    return cleanValue.charAt(0).toUpperCase() + cleanValue.slice(1);
  }
  return "Physical";
}

function cleanTags(value) {
  const tags = Array.isArray(value)
    ? value.map(cleanString).filter(Boolean)
    : cleanString(value)
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  const seen = new Set();
  return tags.filter((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 50);
}

function cleanArray(value) {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter(Boolean).slice(0, 100);
  }

  return cleanString(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function cleanTemplateFieldValues(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  Object.entries(value).slice(0, 50).forEach(([rawKey, rawValue]) => {
    const key = cleanString(rawKey)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60);
    if (!key) return;
    if (Array.isArray(rawValue)) {
      output[key] = rawValue
        .map((item) => cleanString(item).slice(0, 2000))
        .filter(Boolean)
        .slice(0, 100);
    } else if (typeof rawValue === "boolean") {
      output[key] = rawValue;
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      output[key] = rawValue;
    } else if (rawValue === null) {
      output[key] = null;
    } else {
      output[key] = cleanString(rawValue).slice(0, 10000);
    }
  });
  return output;
}

function cleanEntityVariants(value) {
  return (Array.isArray(value) ? value : []).map((variant, index) => ({
    entityVariantId: cleanString(variant?.entityVariantId) || `VARIANT-${index + 1}`,
    name: cleanString(variant?.name) || `Variant ${index + 1}`,
    templateId: cleanString(variant?.templateId),
    templateVariantId: cleanString(variant?.templateVariantId),
    durationMinutes: asNumber(variant?.durationMinutes),
    sizeLabel: cleanString(variant?.sizeLabel),
    intendedOutput: cleanString(variant?.intendedOutput),
    reference: cleanString(variant?.reference),
    references: [...new Set(cleanArray(variant?.references))],
    owner: cleanString(variant?.owner),
    ownerType: cleanString(variant?.ownerType),
    templateFieldValues: cleanTemplateFieldValues(variant?.templateFieldValues),
    behaviourDefaults: Object.fromEntries(Object.entries(variant?.behaviourDefaults || {})
      .filter(([, enabled]) => typeof enabled === "boolean")),
    shopEnabled: variant?.shopEnabled === true,
    libraryVisible: variant?.libraryVisible === true,
    stockQty: asNumber(variant?.stockQty),
    reorderLevel: asNumber(variant?.reorderLevel),
    inventoryUnit: cleanString(variant?.inventoryUnit),
    inventoryLocation: cleanString(variant?.inventoryLocation),
    unitCost: asNumber(variant?.unitCost),
    supplierId: cleanString(variant?.supplierId),
    costReference: cleanString(variant?.costReference),
    purchaseUrl: cleanString(variant?.purchaseUrl),
    linkedItemComponents: cleanItemComponents(variant?.linkedItemComponents),
    estimatedUnitCost: asNumber(variant?.estimatedUnitCost) ?? 0,
    status: cleanString(variant?.status) || "draft",
    scheduledActiveAt: cleanString(variant?.scheduledActiveAt),
    scheduledPauseAt: cleanString(variant?.scheduledPauseAt),
    sortOrder: asNumber(variant?.sortOrder) ?? index + 1,
  }));
}

function cleanItemComponents(value) {
  return (Array.isArray(value) ? value : []).slice(0, 200).map((component) => ({
    itemId: cleanString(component?.itemId),
    quantity: asNumber(component?.quantity) ?? 0,
    unitCost: asNumber(component?.unitCost) ?? 0,
    estimatedCost: asNumber(component?.estimatedCost) ?? 0,
  })).filter((component) => component.itemId && component.quantity > 0);
}

function cleanTemplateAssetLinks(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map((link) => ({
    assetId: cleanString(link?.assetId).slice(0, 200),
    fieldKey: cleanString(link?.fieldKey)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60),
    fieldName: cleanString(link?.fieldName).slice(0, 120) || "Template Asset",
  })).filter((link) => {
    if (!link.assetId || seen.has(link.assetId)) return false;
    seen.add(link.assetId);
    return true;
  }).slice(0, 100);
}

function cleanTemplateContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return {
    warmupBlueprintIds: cleanArray(value.warmupBlueprintIds),
    mainBlueprintIds: cleanArray(value.mainBlueprintIds),
    cooldownBlueprintIds: cleanArray(value.cooldownBlueprintIds),
    blueprintItemIds: cleanArray(value.blueprintItemIds),
  };
}

function applyBoolean(update, source, sourceField, targetField = sourceField) {
  if (source[sourceField] === undefined) return;
  update[targetField] = source[sourceField] === true;
}

function applyNumber(update, source, sourceField, targetField = sourceField) {
  if (source[sourceField] === undefined) return;
  update[targetField] = asNumber(source[sourceField]);
}

function applyArray(update, source, sourceField, targetField = sourceField) {
  if (source[sourceField] === undefined) return;
  update[targetField] = cleanArray(source[sourceField]);
}

function applyString(update, source, sourceField, targetField = sourceField) {
  if (source[sourceField] === undefined) return;
  update[targetField] = cleanString(source[sourceField]);
}

function normalizeVariant(value, index, itemId, productId) {
  if (!value || typeof value !== "object") return null;
  const variantId = cleanString(value.variantId || value.id) ||
    `VAR-${slugify(itemId)}-${index + 1}`;
  const name = cleanString(value.name) ||
    [cleanString(value.colour), cleanString(value.size)].filter(Boolean).join(" / ") ||
    `Variant ${index + 1}`;

  return {
    variantId,
    productId,
    itemId,
    name,
    colour: cleanString(value.colour),
    size: cleanString(value.size),
    sku: cleanString(value.sku),
    priceOverride: (asNumber(value.priceOverride) ?? 0) > 0 ? asNumber(value.priceOverride) : null,
    stock: asNumber(value.stock) ?? 0,
    status: cleanString(value.status || "active").toLowerCase(),
    contentVariantId: cleanString(value.contentVariantId),
    deliveryMode: cleanString(value.deliveryMode),
    physicalFulfilment: cleanString(value.physicalFulfilment || "none").toLowerCase(),
    calendarBookingReference: cleanString(value.calendarBookingReference),
    seatCapacity: asNumber(value.seatCapacity),
    eventStartAt: cleanString(value.eventStartAt),
    eventEndAt: cleanString(value.eventEndAt),
    eventLocation: cleanString(value.eventLocation),
    instructor: cleanString(value.instructor),
  };
}

async function updateProductRelation({
  db,
  transaction,
  collection,
  recordId,
  updates,
  itemUpdate,
  request,
  existingAccessGrantDocs = [],
  existingVariantLinkDocs = [],
}) {
  if (!["items", "blueprints", "plans"].includes(collection) ||
      !updates.productRelation || typeof updates.productRelation !== "object") return;

  const relation = updates.productRelation;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const itemRef = db.collection(collection).doc(recordId);
  const itemSnap = await transaction.get(itemRef);
  const itemData = itemSnap.exists ? itemSnap.data() || {} : {};
  const productId = cleanString(relation.productId) ||
    cleanString(updates.productId) ||
    `PROD-${slugify(recordId).replace(/^ITEM-/, "")}`;
  const productRef = db.collection("products").doc(productId);
  const productSnap = await transaction.get(productRef);
  const productData = productSnap.exists ? productSnap.data() || {} : {};
  const linkedEntityType = {
    items: "Item",
    blueprints: "Blueprint",
    plans: "Plan",
  }[collection];
  const linkRole = cleanString(relation.linkRole) || "Represents";
  const isManufacturingLink = collection === "blueprints" && linkRole === "ManufacturedFrom";
  const accessTargets = cleanAccessGrants(relation.accessGrants);
  const variantContentLinks = cleanVariantContentLinks(relation.variantContentLinks);
  const desiredAccessGrantIds = new Set();
  const desiredVariantLinkIds = new Set();
  variantContentLinks.filter((link) => link.linkRole === "Unlocks").forEach((link) => {
    accessTargets.push({
      accessEntityType: link.entityType,
      accessEntityId: link.entityId,
      accessEntityVariantId: link.entityVariantId,
      productVariantId: link.productVariantId,
    });
  });
  const productLinkId = `PRODUCTLINK-${slugify(productId)}-${linkedEntityType.toUpperCase()}-${slugify(recordId)}`;
  const manufacturingBlueprintId = isManufacturingLink
    ? recordId
    : cleanString(relation.manufacturingBlueprintId);
  const blueprintLinkId = manufacturingBlueprintId
    ? `PRODUCTLINK-${slugify(productId)}-BLUEPRINT-${slugify(manufacturingBlueprintId)}`
    : "";
  if (cleanString(relation.existingProductId) && productSnap.exists) {
    if (!cleanString(productData.sku)) {
      transaction.set(productRef, {
        sku: cleanString(relation.sku) || generatedProductSku(productId),
        updatedAt: now,
        updatedByUid: request.auth.uid,
      }, { merge: true });
    }
    transaction.set(db.collection("productLinks").doc(productLinkId), {
      productLinkId,
      productId,
      linkedEntityType,
      linkedEntityId: recordId,
      linkRole,
      quantity: 1,
      isPrimary: !isManufacturingLink,
      sortOrder: isManufacturingLink ? 2 : 1,
      required: true,
      variantSpecific: false,
      productVariantId: "",
      status: "active",
      contentOrigin: "app",
      managedByWorkbook: false,
      updatedAt: now,
      updatedByUid: request.auth.uid,
      createdAt: now,
    }, { merge: true });
    transaction.set(productRef, {
      manufacturingBlueprintId,
      estimatedUnitCost: asNumber(relation.estimatedUnitCost) ?? 0,
      variantContentLinks,
      updatedAt: now,
      updatedByUid: request.auth.uid,
    }, { merge: true });
    if (isManufacturingLink) {
      transaction.set(db.collection("productLinks").doc(blueprintLinkId), {
        productLinkId: blueprintLinkId,
        productId,
        linkedEntityType: "Blueprint",
        linkedEntityId: manufacturingBlueprintId,
        linkRole: "ManufacturedFrom",
        quantity: 1,
        isPrimary: false,
        sortOrder: 2,
        required: true,
        status: "active",
        contentOrigin: "app",
        managedByWorkbook: false,
        updatedAt: now,
        updatedByUid: request.auth.uid,
        createdAt: now,
      }, { merge: true });
    }
    accessTargets.forEach((grant) => {
      const { accessEntityType, accessEntityId, accessEntityVariantId, productVariantId } = grant;
      const grantId = `ACCESSGRANT-${slugify(productId)}-${slugify(productVariantId || "ALL")}-` +
        `${slugify(accessEntityType)}-${slugify(accessEntityId)}-${slugify(accessEntityVariantId || "ALL")}`;
      desiredAccessGrantIds.add(grantId);
      transaction.set(db.collection("productAccessGrants").doc(grantId), {
        productAccessGrantId: grantId,
        productId,
        productVariantId: productVariantId || "",
        accessEntityType,
        accessEntityId,
        accessEntityVariantId: accessEntityVariantId || "",
        grantTiming: "on-payment-confirmed",
        durationType: "permanent",
        durationValue: null,
        revocable: true,
        status: "active",
        contentOrigin: "app",
        managedByWorkbook: false,
        updatedAt: now,
        updatedByUid: request.auth.uid,
        createdAt: now,
      }, { merge: true });
    });
    variantContentLinks.forEach((link) => {
      const linkId = `PRODUCTVARIANTLINK-${slugify(productId)}-${slugify(link.productVariantId)}-` +
        `${slugify(link.entityType)}-${slugify(link.entityId)}-${slugify(link.entityVariantId || "ALL")}`;
      desiredVariantLinkIds.add(linkId);
      transaction.set(db.collection("productVariantContentLinks").doc(linkId), {
        productVariantContentLinkId: linkId,
        productId,
        ...link,
        contentOrigin: "app",
        managedByWorkbook: false,
        updatedAt: now,
        updatedByUid: request.auth.uid,
        createdAt: now,
      }, { merge: true });
    });
    existingAccessGrantDocs.filter((doc) => !desiredAccessGrantIds.has(doc.id)).forEach((doc) => {
      transaction.set(doc.ref, { status: "archived", updatedAt: now }, { merge: true });
    });
    existingVariantLinkDocs.filter((doc) => !desiredVariantLinkIds.has(doc.id)).forEach((doc) => {
      transaction.set(doc.ref, { status: "archived", updatedAt: now }, { merge: true });
    });
    return;
  }
  if (isManufacturingLink) {
    throw new HttpsError(
      "failed-precondition",
      "Choose an existing Product for a manufacturing/cost Blueprint.",
    );
  }
  const priceId = cleanString(relation.activePriceId) ||
    cleanString(productData.activePriceId) ||
    `PRICE-${slugify(productId)}-BASE`;
  const priceRef = db.collection("productPrices").doc(priceId);
  const priceSnap = await transaction.get(priceRef);
  const priceData = priceSnap.exists ? priceSnap.data() || {} : {};
  const name = cleanString(updates.name) || cleanString(itemUpdate.name) || itemData.name || itemData.title || recordId;
  const existingEffectivePrice = asNumber(priceData.effectiveShopPrice) ??
    asNumber(productData.price) ??
    asNumber(productData.priceFrom) ??
    asNumber(priceData.retailPrice) ??
    asNumber(productData.retailPrice) ??
    0;
  const requestedRetailPrice = asNumber(relation.retailPrice ?? relation.effectiveShopPrice ?? relation.price);
  const retailPrice = requestedRetailPrice ?? asNumber(priceData.retailPrice) ??
    asNumber(productData.retailPrice) ??
    existingEffectivePrice;
  const storedSalePrice = asNumber(priceData.salePrice) ?? asNumber(productData.salePrice);
  const salePrice = relation.salePrice === null
    ? null
    : asNumber(relation.salePrice) ?? (storedSalePrice > 0 ? storedSalePrice : null);
  const saleStartsAt = cleanString(relation.saleStartsAt) || cleanString(productData.saleStartsAt);
  const saleEndsAt = cleanString(relation.saleEndsAt) || cleanString(productData.saleEndsAt);
  const nowMs = Date.now();
  const startsMs = saleStartsAt ? Date.parse(saleStartsAt) : null;
  const endsMs = saleEndsAt ? Date.parse(saleEndsAt) : null;
  const onSale = salePrice !== null && (!startsMs || startsMs <= nowMs) && (!endsMs || endsMs > nowMs);
  const effectivePrice = onSale ? salePrice : retailPrice;
  const stock = asNumber(relation.stock) ?? asNumber(productData.stock) ?? 0;
  const variants = Array.isArray(relation.variants)
    ? relation.variants
      .map((variant, index) => normalizeVariant(variant, index, recordId, productId))
      .filter(Boolean)
    : [];
  const legacyProductType = productTypeValue(relation.productType || itemUpdate.type || itemData.type, "tool");
  const canonicalProductType = canonicalProductTypeValue(relation.productType || legacyProductType);

  transaction.set(productRef, {
    productId,
    productName: name,
    productType: cleanString(relation.productType) || (collection === "plans"
      ? (cleanString(itemUpdate.type || itemData.type).toLowerCase() === "course" ? "Course Access" : "Plan Access")
      : collection === "blueprints" ? "Digital Download" : canonicalProductType),
    productCategoryId: cleanString(
      relation.productCategoryId || productData.productCategoryId || productData.categoryId,
    ),
    itemId: collection === "items" ? recordId : "",
    name,
    title: name,
    type: cleanString(relation.productType) || legacyProductType,
    itemType: itemUpdate.type || itemData.type || itemData.itemType || "",
    itemKind: itemUpdate.itemKind || itemData.itemKind || "",
    categoryId: cleanString(relation.productCategoryId || productData.productCategoryId || productData.categoryId),
    templateId: cleanString(updates.templateId || itemData.templateId),
    templateFieldValues: cleanTemplateFieldValues(
      updates.templateFieldValues || itemData.templateFieldValues,
    ),
    sku: cleanString(relation.sku) || cleanString(productData.sku) || generatedProductSku(productId),
    shopStatus: cleanString(relation.shopStatus || "draft").toLowerCase(),
    visible: asBoolean(relation.visible),
    websiteVisible: asBoolean(relation.visible),
    archived: asBoolean(relation.archived),
    featured: asBoolean(relation.featured),
    requiresShipping: asBoolean(relation.requiresShipping),
    physicalFulfilment: cleanString(
      relation.physicalFulfilment || (asBoolean(relation.requiresShipping) ? "shipping" : "none"),
    ).toLowerCase(),
    inventoryTracked: asBoolean(relation.inventoryTracked),
    manufacturingBlueprintId,
    estimatedUnitCost: asNumber(relation.estimatedUnitCost) ?? 0,
    variantContentLinks,
    unlocksAccess: updates.unlocksAccess === true,
    accessType: cleanString(updates.accessType),
    deliveryMode: cleanString(updates.deliveryMode),
    requiresCalendar: relation.requiresCalendar === true,
    requiresSessionTime: relation.requiresSessionTime === true,
    tracksSeats: relation.tracksSeats === true,
    requiresLocation: relation.requiresLocation === true,
    requiresInstructor: relation.requiresInstructor === true,
    seatCapacity: asNumber(updates.seatCapacity),
    eventStartAt: cleanString(updates.eventStartAt),
    eventEndAt: cleanString(updates.eventEndAt),
    eventLocation: cleanString(updates.eventLocation),
    instructor: cleanString(relation.instructor || updates.instructor),
    issuesCertificate: updates.issuesCertificate === true,
    certificateName: cleanString(updates.certificateName),
    price: effectivePrice,
    priceFrom: variants
      .map((variant) => variant.priceOverride)
      .filter((price) => price !== null)
      .concat([effectivePrice])
      .sort((a, b) => a - b)[0],
    retailPrice,
    salePrice,
    onSale,
    saleStartsAt,
    saleEndsAt,
    stock: asBoolean(relation.inventoryTracked)
      ? (variants.length
        ? variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0)
        : stock)
      : 0,
    hasVariants: variants.length > 0,
    updatedAt: now,
    updatedByUid: request.auth.uid,
    updatedByEmail: request.auth.token.email || "",
    createdAt: productData.createdAt || now,
  }, { merge: true });

  transaction.set(db.collection("productLinks").doc(productLinkId), {
    productLinkId,
    productId,
    linkedEntityType,
    linkedEntityId: recordId,
    linkRole,
    quantity: 1,
    isPrimary: true,
    sortOrder: 1,
    required: true,
    variantSpecific: false,
    productVariantId: "",
    status: "active",
    contentOrigin: "app",
    managedByWorkbook: false,
    updatedAt: now,
    updatedByUid: request.auth.uid,
    createdAt: productData.createdAt || now,
  }, { merge: true });
  if (isManufacturingLink) {
    transaction.set(db.collection("productLinks").doc(blueprintLinkId), {
      productLinkId: blueprintLinkId,
      productId,
      linkedEntityType: "Blueprint",
      linkedEntityId: manufacturingBlueprintId,
      linkRole: "ManufacturedFrom",
      quantity: 1,
      isPrimary: false,
      sortOrder: 2,
      required: true,
      status: "active",
      contentOrigin: "app",
      managedByWorkbook: false,
      updatedAt: now,
      updatedByUid: request.auth.uid,
      createdAt: now,
    }, { merge: true });
  }

  accessTargets.forEach((grant) => {
    const { accessEntityType, accessEntityId, accessEntityVariantId, productVariantId } = grant;
    const grantId = `ACCESSGRANT-${slugify(productId)}-${slugify(productVariantId || "ALL")}-` +
      `${slugify(accessEntityType)}-${slugify(accessEntityId)}-${slugify(accessEntityVariantId || "ALL")}`;
    desiredAccessGrantIds.add(grantId);
    transaction.set(db.collection("productAccessGrants").doc(grantId), {
      productAccessGrantId: grantId,
      productId,
      productVariantId: productVariantId || "",
      accessEntityType,
      accessEntityId,
      accessEntityVariantId: accessEntityVariantId || "",
      grantTiming: "on-payment-confirmed",
      durationType: "permanent",
      durationValue: null,
      revocable: true,
      status: "active",
      contentOrigin: "app",
      managedByWorkbook: false,
      updatedAt: now,
      updatedByUid: request.auth.uid,
      createdAt: productData.createdAt || now,
    }, { merge: true });
  });
  variantContentLinks.forEach((link) => {
    const linkId = `PRODUCTVARIANTLINK-${slugify(productId)}-${slugify(link.productVariantId)}-` +
      `${slugify(link.entityType)}-${slugify(link.entityId)}-${slugify(link.entityVariantId || "ALL")}`;
    desiredVariantLinkIds.add(linkId);
    transaction.set(db.collection("productVariantContentLinks").doc(linkId), {
      productVariantContentLinkId: linkId,
      productId,
      ...link,
      contentOrigin: "app",
      managedByWorkbook: false,
      updatedAt: now,
      updatedByUid: request.auth.uid,
      createdAt: now,
    }, { merge: true });
  });
  existingAccessGrantDocs.filter((doc) => !desiredAccessGrantIds.has(doc.id)).forEach((doc) => {
    transaction.set(doc.ref, { status: "archived", updatedAt: now }, { merge: true });
  });
  existingVariantLinkDocs.filter((doc) => !desiredVariantLinkIds.has(doc.id)).forEach((doc) => {
    transaction.set(doc.ref, { status: "archived", updatedAt: now }, { merge: true });
  });

  transaction.set(priceRef, {
    priceId,
    productId,
    variantId: "",
    currency: "AUD",
    retailPrice,
    salePrice,
    onSale,
    saleStartsAt,
    saleEndsAt,
    effectiveShopPrice: effectivePrice,
    gstIncluded: true,
    gstAmount: Number((effectivePrice / 11).toFixed(2)),
    status: "active",
    updatedAt: now,
    createdAt: productData.createdAt || now,
  }, { merge: true });

  if (asBoolean(relation.inventoryTracked) && !variants.length) {
    const inventoryId = `INV-${slugify(productId)}`;
    transaction.set(db.collection("inventory").doc(inventoryId), {
      inventoryId,
      name,
      itemId: collection === "items" ? recordId : "",
      productId,
      variantId: "",
      stockQty: stock,
      updatedAt: now,
      updatedByUid: request.auth.uid,
    }, { merge: true });
  }

  variants.forEach((variant, index) => {
    const variantRef = db.collection("itemVariants").doc(variant.variantId);
    transaction.set(variantRef, {
      ...variant,
      updatedAt: now,
      createdAt: now,
    }, { merge: true });

    transaction.set(db.collection("productVariants").doc(variant.variantId), {
      productVariantId: variant.variantId,
      productId,
      variantName: variant.name || `Variant ${index + 1}`,
      variantCode: variant.variantId,
      sku: variant.sku,
      status: variant.status || "active",
      contentVariantId: variant.contentVariantId,
      deliveryMode: variant.deliveryMode,
      physicalFulfilment: variant.physicalFulfilment,
      isDefault: index === 0,
      optionSummary: [variant.colour, variant.size].filter(Boolean).join(" / "),
      priceOverride: variant.priceOverride,
      currency: "AUD",
      requiresShippingOverride: ["shipping", "shipping-or-pickup"].includes(variant.physicalFulfilment),
      inventoryTracked: asBoolean(relation.inventoryTracked),
      stockQuantity: variant.stock,
      stockStatus: variant.stock > 0 ? "in-stock" : "out-of-stock",
      calendarBookingReference: variant.calendarBookingReference,
      seatCapacity: variant.seatCapacity,
      eventStartAt: variant.eventStartAt,
      eventEndAt: variant.eventEndAt,
      eventLocation: variant.eventLocation,
      instructor: variant.instructor,
      sortOrder: index + 1,
      contentOrigin: "app",
      managedByWorkbook: false,
      updatedAt: now,
      updatedByUid: request.auth.uid,
      createdAt: now,
    }, { merge: true });

    const variantPriceId = `PRICE-${slugify(productId)}-${index + 1}`;
    const variantPriceRef = db.collection("productPrices").doc(variantPriceId);
    if (variant.priceOverride !== null) {
      transaction.set(db.collection("productPrices").doc(variantPriceId), {
        priceId: variantPriceId,
        productId,
        variantId: variant.variantId,
        currency: "AUD",
        retailPrice: variant.priceOverride,
        salePrice: null,
        onSale: false,
        effectiveShopPrice: variant.priceOverride,
        gstIncluded: true,
        gstAmount: Number((variant.priceOverride / 11).toFixed(2)),
        status: "active",
        updatedAt: now,
        createdAt: now,
      }, { merge: true });
    } else {
      transaction.delete(variantPriceRef);
    }

    if (asBoolean(relation.inventoryTracked)) {
      const inventoryId = `INV-${slugify(variant.variantId)}`;
      transaction.set(db.collection("inventory").doc(inventoryId), {
        inventoryId,
        name: `${name} ${variant.name}`.trim(),
        itemId: collection === "items" ? recordId : "",
        productId,
        variantId: variant.variantId,
        stockQty: variant.stock,
        updatedAt: now,
        updatedByUid: request.auth.uid,
      }, { merge: true });
    }
  });
}

async function prepareTemplateAssetSync(db, collection, recordId, updates) {
  if (updates.hasAssetTemplateFields !== true) return null;
  const links = cleanTemplateAssetLinks(updates.templateAssetLinks);
  const entityType = { items: "Item", blueprints: "Blueprint", plans: "Plan" }[collection];
  if (!entityType) return null;
  const [relationsSnapshot, entityRelationsSnapshot, ...assetSnapshots] = await Promise.all([
    collection === "items"
      ? db.collection("itemAssets").where("itemId", "==", recordId).get()
      : Promise.resolve({ docs: [] }),
    db.collection("entityAssets").where("entityId", "==", recordId).get(),
    ...links.map((link) => db.collection("assets").doc(link.assetId).get()),
  ]);
  const assets = new Map();
  assetSnapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) {
      throw new HttpsError(
        "invalid-argument",
        `Selected asset ${links[index].assetId} no longer exists. Refresh the Content Builder and try again.`,
      );
    }
    assets.set(snapshot.id, snapshot.data() || {});
  });
  return {
    links,
    assets,
    originalAssetIds: new Set(cleanArray(updates.originalTemplateAssetIds)),
    relations: relationsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ref: doc.ref,
      data: doc.data() || {},
    })),
    entityRelations: entityRelationsSnapshot.docs
      .filter((doc) => doc.data()?.entityType === entityType)
      .map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} })),
    entityType,
    collection,
  };
}

function syncTemplateAssets({ transaction, db, recordId, sync, request }) {
  if (!sync) return;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const selectedIds = new Set(sync.links.map((link) => link.assetId));
  const existingByAssetId = new Map();
  const canonicalByAssetId = new Map(
    sync.entityRelations.map((relation) => [cleanString(relation.data.assetId), relation]),
  );
  sync.relations.forEach((relation) => {
    const assetId = cleanString(relation.data.assetId);
    if (existingByAssetId.has(assetId)) {
      transaction.delete(relation.ref);
      return;
    }
    if (!selectedIds.has(assetId)) {
      if (sync.originalAssetIds.has(assetId)) {
        transaction.delete(relation.ref);
        const canonical = canonicalByAssetId.get(assetId);
        if (canonical) transaction.delete(canonical.ref);
      }
      return;
    }
    existingByAssetId.set(assetId, relation);
  });

  sync.links.forEach((link, index) => {
    const existing = existingByAssetId.get(link.assetId);
    const relationId = existing?.id || [
      "ITEMASSET",
      slugify(recordId),
      slugify(link.fieldKey),
      slugify(link.assetId),
    ].join("-");
    const asset = sync.assets.get(link.assetId) || {};
    if (sync.collection === "items") transaction.set(existing?.ref || db.collection("itemAssets").doc(relationId), {
      itemAssetId: relationId,
      itemId: recordId,
      assetId: link.assetId,
      purpose: link.fieldName,
      sortOrder: index + 1,
      displayStatus: "active",
      contextTitle: cleanString(asset.title || asset.name) || link.assetId,
      contextAltText: cleanString(asset.altText),
      notes: "Linked from a template field in Content Builder.",
      contentOrigin: "app",
      managedByWorkbook: false,
      updatedAt: now,
      updatedByUid: request.auth.uid,
      updatedByEmail: request.auth.token.email || "",
      createdAt: existing?.data.createdAt || now,
    }, { merge: true });

    const canonical = canonicalByAssetId.get(link.assetId);
    const entityAssetId = canonical?.id ||
      `ENTITYASSET-${sync.entityType.toUpperCase()}-${slugify(recordId)}-${slugify(link.assetId)}`;
    transaction.set(canonical?.ref || db.collection("entityAssets").doc(entityAssetId), {
      entityAssetId,
      assetId: link.assetId,
      entityType: sync.entityType,
      entityId: recordId,
      assetRole: link.fieldName,
      fieldKey: link.fieldKey,
      productVariantId: "",
      isPrimary: index === 0,
      sortOrder: index + 1,
      displayStatus: "active",
      visibility: "private",
      status: "active",
      contentOrigin: "app",
      managedByWorkbook: false,
      updatedAt: now,
      updatedByUid: request.auth.uid,
      updatedByEmail: request.auth.token.email || "",
      createdAt: canonical?.data.createdAt || now,
    }, { merge: true });
  });
}

export const updateContentControlRecord = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can update content records.");
    }

    const data = request.data || {};
    const collection = COLLECTION_BY_TYPE[cleanString(data.recordType).toLowerCase()];
    const recordId = cleanString(data.recordId);
    const updates = data.updates || {};

    if (!collection || !recordId) {
      throw new HttpsError("invalid-argument", "Record type and record ID are required.");
    }

    const db = admin.firestore();
    const existingSnapshot = await db.collection(collection).doc(recordId).get();
    const existing = existingSnapshot.data() || {};
    const actor = actorOwnership(request);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const update = {
      updatedAt: now,
      updatedByUid: request.auth.uid,
      updatedByEmail: request.auth.token.email || "",
      owner: cleanString(existing.owner) || actor.owner,
      ownerType: cleanString(existing.ownerType) || actor.ownerType,
      createdAt: existing.createdAt || now,
      createdByUid: existing.createdByUid || request.auth.uid,
      createdByEmail: existing.createdByEmail || request.auth.token.email || "",
    };

    applyString(update, updates, "name");
    if (update.name) update.title = update.name;
    applyString(update, updates, "status");
    applyString(update, updates, "visibility");
    applyString(update, updates, "amendmentComments");
    applyString(update, updates, "scheduledActiveAt");
    applyString(update, updates, "scheduledPauseAt");
    applyString(update, updates, "owner");
    applyString(update, updates, "ownerType");
    applyString(update, updates, "type", TYPE_FIELD_BY_COLLECTION[collection]);
    applyString(update, updates, "template");
    applyString(update, updates, "templateId");
    applyString(update, updates, "shortDescription");
    applyString(update, updates, "longDescription");
    applyString(update, updates, "longDescription", "notes");
    applyString(update, updates, "audience");
    applyString(update, updates, "goal");
    applyString(update, updates, "intendedOutput");
    applyString(update, updates, "sizeLabel");
    applyString(update, updates, "startDate");
    applyString(update, updates, "endDate");
    applyNumber(update, updates, "durationMinutes");
    applyBoolean(update, updates, "publishRequested");
    applyBoolean(update, updates, "requestedWebsiteVisible");
    applyBoolean(update, updates, "requestedProductVisible");
    applyBoolean(update, updates, "createsProduct");
    applyBoolean(update, updates, "websiteVisible");
    applyBoolean(update, updates, "websiteVisible", "visible");
    applyString(update, updates, "approvalStatus");
    if (update.status === "review") {
      update.approvalStatus = "awaiting-approval";
      update.approvalRequestedAt = now;
      update.approvalRequestedByUid = request.auth.uid;
      update.approvalRequestedByEmail = request.auth.token.email || "";
    }
    if (update.status === "active") {
      update.approvalStatus = "approved";
      update.publishRequested = false;
      update.approvedAt = now;
      update.approvedByUid = request.auth.uid;
      update.approvedByEmail = request.auth.token.email || "";
    }
    applyArray(update, updates, "linkedItemIds");
    applyArray(update, updates, "linkedBlueprintIds");
    applyArray(update, updates, "linkedPlanIds");
    if (updates.linkedItemComponents !== undefined) {
      update.linkedItemComponents = cleanItemComponents(updates.linkedItemComponents);
    }
    applyNumber(update, updates, "estimatedUnitCost");
    if (updates.templateFieldValues !== undefined) {
      update.templateFieldValues = cleanTemplateFieldValues(updates.templateFieldValues);
    }
    if (updates.entityVariants !== undefined) {
      const existingVariants = new Map((Array.isArray(existing.entityVariants) ? existing.entityVariants : [])
        .map((variant) => [cleanString(variant.entityVariantId), variant]));
      const variantAuditTime = new Date().toISOString();
      update.entityVariants = cleanEntityVariants(updates.entityVariants).map((variant) => {
        const previous = existingVariants.get(variant.entityVariantId) || {};
        const activating = variant.status === "active" && previous.status !== "active";
        return {
          ...previous,
          ...variant,
          owner: variant.owner || previous.owner || actor.owner,
          ownerType: variant.ownerType || previous.ownerType || actor.ownerType,
          createdByUid: previous.createdByUid || request.auth.uid,
          createdByEmail: previous.createdByEmail || request.auth.token.email || "",
          createdAt: previous.createdAt || variantAuditTime,
          approvalStatus: variant.status === "review"
            ? "awaiting-approval"
            : variant.status === "active" ? "approved" : previous.approvalStatus || "draft",
          approvedByUid: activating ? request.auth.uid : previous.approvedByUid || "",
          approvedByEmail: activating
            ? request.auth.token.email || ""
            : previous.approvedByEmail || "",
          approvedAt: activating ? variantAuditTime : previous.approvedAt || "",
        };
      });
    }
    if (updates.templateContent !== undefined) {
      update.templateContent = cleanTemplateContent(updates.templateContent);
      if (collection === "plans") {
        update.blueprintGroups = {
          warmup: update.templateContent.warmupBlueprintIds,
          main: update.templateContent.mainBlueprintIds,
          cooldown: update.templateContent.cooldownBlueprintIds,
        };
      }
    }

    if (collection === "items") {
      applyString(update, updates, "itemKind");
      applyBoolean(update, updates, "isShopProduct");
      applyBoolean(update, updates, "soldByRecoveryTools");
      applyBoolean(update, updates, "requiresShipping");
      applyBoolean(update, updates, "inventoryTracked");
      applyNumber(update, updates, "stockQty");
      applyNumber(update, updates, "reorderLevel");
      applyString(update, updates, "inventoryUnit");
      applyString(update, updates, "inventoryLocation");
      applyNumber(update, updates, "unitCost");
      applyString(update, updates, "supplierId");
      applyString(update, updates, "costReference");
      applyString(update, updates, "purchaseUrl");
      applyBoolean(update, updates, "requiresCalendar");
      applyBoolean(update, updates, "requiresSessionTime");
      applyBoolean(update, updates, "tracksSeats");
      applyBoolean(update, updates, "unlocksAccess");
      applyBoolean(update, updates, "requiresLocation");
      applyBoolean(update, updates, "requiresInstructor");
      applyBoolean(update, updates, "issuesCertificate");
      applyNumber(update, updates, "seatCapacity");
      applyString(update, updates, "accessType");
      applyString(update, updates, "deliveryMode");
      applyString(update, updates, "eventStartAt");
      applyString(update, updates, "eventEndAt");
      applyString(update, updates, "eventLocation");
      applyString(update, updates, "instructor");
      applyString(update, updates, "certificateName");
    }

    if (updates.tags !== undefined) {
      update.tags = cleanTags(updates.tags);
    }

    const templateAssetSync = ["items", "blueprints", "plans"].includes(collection)
      ? await prepareTemplateAssetSync(db, collection, recordId, updates)
      : null;
    const unlinkProductIds = new Set(cleanArray(updates.unlinkProductIds));
    const productLinksToUnlink = unlinkProductIds.size
      ? (await db.collection("productLinks").where("linkedEntityId", "==", recordId).get()).docs
        .filter((doc) => unlinkProductIds.has(cleanString(doc.data()?.productId)))
      : [];
    const relationProductId = updates.productRelation
      ? cleanString(updates.productRelation.productId || updates.productRelation.existingProductId) ||
        cleanString(updates.productId) || `PROD-${slugify(recordId).replace(/^ITEM-/, "")}`
      : "";
    const [accessGrantSnapshot, variantLinkSnapshot] = relationProductId
      ? await Promise.all([
        db.collection("productAccessGrants").where("productId", "==", relationProductId).get(),
        db.collection("productVariantContentLinks").where("productId", "==", relationProductId).get(),
      ])
      : [{ docs: [] }, { docs: [] }];
    await db.runTransaction(async (transaction) => {
      if (collection === "items" && updates.createsProduct !== true &&
          updates.inventoryTracked !== undefined) {
        const inventoryRef = db.collection("inventory").doc(`INV-${slugify(recordId)}`);
        transaction.set(inventoryRef, {
          inventoryId: inventoryRef.id,
          name: cleanString(updates.name) || cleanString(existing.name) || recordId,
          itemId: recordId,
          productId: "",
          variantId: "",
          stockQty: asNumber(updates.stockQty) ?? asNumber(existing.stockQty) ?? 0,
          reorderLevel: asNumber(updates.reorderLevel),
          unit: cleanString(updates.inventoryUnit),
          location: cleanString(updates.inventoryLocation),
          unitCost: asNumber(updates.unitCost),
          supplierId: cleanString(updates.supplierId),
          costReference: cleanString(updates.costReference),
          purchaseUrl: cleanString(updates.purchaseUrl),
          status: updates.inventoryTracked === true ? "active" : "not-tracked",
          managedByWorkbook: false,
          contentOrigin: "app",
          updatedAt: now,
          updatedByUid: request.auth.uid,
          createdAt: now,
        }, { merge: true });
      }
      await updateProductRelation({
        db,
        transaction,
        collection,
        recordId,
        updates,
        itemUpdate: update,
        request,
        existingAccessGrantDocs: accessGrantSnapshot.docs,
        existingVariantLinkDocs: variantLinkSnapshot.docs,
      });
      syncTemplateAssets({
        transaction,
        db,
        recordId,
        sync: templateAssetSync,
        request,
      });
      productLinksToUnlink.forEach((link) => {
        transaction.set(link.ref, {
          status: "archived",
          updatedAt: now,
          updatedByUid: request.auth.uid,
          updatedByEmail: request.auth.token.email || "",
        }, { merge: true });
      });
      transaction.set(db.collection(collection).doc(recordId), update, { merge: true });
    });

    return { success: true, recordId, recordType: collection };
  },
);
