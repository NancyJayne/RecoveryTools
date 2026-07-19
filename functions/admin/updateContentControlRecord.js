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

function asNumber(value) {
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
    priceOverride: asNumber(value.priceOverride),
    stock: asNumber(value.stock) ?? 0,
    status: cleanString(value.status || "active").toLowerCase(),
  };
}

async function updateProductRelation({ db, transaction, collection, recordId, updates, itemUpdate, request }) {
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
  const productLinkId = `PRODUCTLINK-${slugify(productId)}-${linkedEntityType.toUpperCase()}-${slugify(recordId)}`;
  if (cleanString(relation.existingProductId) && productSnap.exists) {
    transaction.set(db.collection("productLinks").doc(productLinkId), {
      productLinkId,
      productId,
      linkedEntityType,
      linkedEntityId: recordId,
      linkRole: cleanString(relation.linkRole) || "Represents",
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
      createdAt: now,
    }, { merge: true });
    if (collection === "plans" && ["Unlocks", "Delivers", "Represents"].includes(relation.linkRole)) {
      const grantId = `ACCESSGRANT-${slugify(productId)}-${slugify(recordId)}`;
      transaction.set(db.collection("productAccessGrants").doc(grantId), {
        productAccessGrantId: grantId,
        productId,
        productVariantId: "",
        accessEntityType: "Plan",
        accessEntityId: recordId,
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
    }
    return;
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
  const salePrice = relation.salePrice === null
    ? null
    : asNumber(relation.salePrice) ?? asNumber(priceData.salePrice) ?? asNumber(productData.salePrice);
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
    productType: collection === "plans"
      ? (cleanString(itemUpdate.type || itemData.type).toLowerCase() === "course" ? "Course Access" : "Plan Access")
      : collection === "blueprints" ? "Digital Download" : canonicalProductType,
    productCategoryId: itemUpdate.categoryId || itemData.categoryId || "",
    itemId: collection === "items" ? recordId : "",
    name,
    title: name,
    type: legacyProductType,
    itemType: itemUpdate.type || itemData.type || itemData.itemType || "",
    itemKind: itemUpdate.itemKind || itemData.itemKind || "",
    categoryId: itemUpdate.categoryId || itemData.categoryId || "",
    templateId: cleanString(updates.templateId || itemData.templateId),
    templateFieldValues: cleanTemplateFieldValues(
      updates.templateFieldValues || itemData.templateFieldValues,
    ),
    sku: cleanString(relation.sku),
    shopStatus: cleanString(relation.shopStatus || "draft").toLowerCase(),
    visible: asBoolean(relation.visible),
    websiteVisible: asBoolean(relation.visible),
    archived: asBoolean(relation.archived),
    featured: asBoolean(relation.featured),
    requiresShipping: asBoolean(relation.requiresShipping),
    inventoryTracked: asBoolean(relation.inventoryTracked),
    unlocksAccess: updates.unlocksAccess === true,
    accessType: cleanString(updates.accessType),
    deliveryMode: cleanString(updates.deliveryMode),
    requiresCalendar: updates.requiresCalendar === true,
    requiresSessionTime: updates.requiresSessionTime === true,
    tracksSeats: updates.tracksSeats === true,
    seatCapacity: asNumber(updates.seatCapacity),
    eventStartAt: cleanString(updates.eventStartAt),
    eventEndAt: cleanString(updates.eventEndAt),
    eventLocation: cleanString(updates.eventLocation),
    instructor: cleanString(updates.instructor),
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
    stock: variants.length
      ? variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0)
      : stock,
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
    linkRole: cleanString(relation.linkRole) || "Represents",
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

  if (collection === "plans") {
    const grantId = `ACCESSGRANT-${slugify(productId)}-${slugify(recordId)}`;
    transaction.set(db.collection("productAccessGrants").doc(grantId), {
      productAccessGrantId: grantId,
      productId,
      productVariantId: "",
      accessEntityType: "Plan",
      accessEntityId: recordId,
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
  }

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
      isDefault: index === 0,
      optionSummary: [variant.colour, variant.size].filter(Boolean).join(" / "),
      priceOverride: variant.priceOverride,
      currency: "AUD",
      requiresShippingOverride: asBoolean(relation.requiresShipping),
      inventoryTracked: asBoolean(relation.inventoryTracked),
      stockQuantity: variant.stock,
      stockStatus: variant.stock > 0 ? "in-stock" : "out-of-stock",
      sortOrder: index + 1,
      contentOrigin: "app",
      managedByWorkbook: false,
      updatedAt: now,
      updatedByUid: request.auth.uid,
      createdAt: now,
    }, { merge: true });

    if (variant.priceOverride !== null) {
      const variantPriceId = `PRICE-${slugify(productId)}-${index + 1}`;
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

async function prepareTemplateAssetSync(db, recordId, updates) {
  if (updates.hasAssetTemplateFields !== true) return null;
  const links = cleanTemplateAssetLinks(updates.templateAssetLinks);
  const [relationsSnapshot, entityRelationsSnapshot, ...assetSnapshots] = await Promise.all([
    db.collection("itemAssets").where("itemId", "==", recordId).get(),
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
      .filter((doc) => doc.data()?.entityType === "Item")
      .map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} })),
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
    transaction.set(existing?.ref || db.collection("itemAssets").doc(relationId), {
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
    const entityAssetId = canonical?.id || `ENTITYASSET-ITEM-${slugify(recordId)}-${slugify(link.assetId)}`;
    transaction.set(canonical?.ref || db.collection("entityAssets").doc(entityAssetId), {
      entityAssetId,
      assetId: link.assetId,
      entityType: "Item",
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
    applyString(update, updates, "categoryId");
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
    if (updates.templateFieldValues !== undefined) {
      update.templateFieldValues = cleanTemplateFieldValues(updates.templateFieldValues);
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
      applyBoolean(update, updates, "websiteVisible");
      applyBoolean(update, updates, "websiteVisible", "visible");
      applyBoolean(update, updates, "isShopProduct");
      applyBoolean(update, updates, "soldByRecoveryTools");
      applyBoolean(update, updates, "requiresShipping");
      applyBoolean(update, updates, "inventoryTracked");
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

    const templateAssetSync = collection === "items"
      ? await prepareTemplateAssetSync(db, recordId, updates)
      : null;
    const unlinkProductIds = new Set(cleanArray(updates.unlinkProductIds));
    const productLinksToUnlink = unlinkProductIds.size
      ? (await db.collection("productLinks").where("linkedEntityId", "==", recordId).get()).docs
        .filter((doc) => unlinkProductIds.has(cleanString(doc.data()?.productId)))
      : [];
    await db.runTransaction(async (transaction) => {
      await updateProductRelation({
        db,
        transaction,
        collection,
        recordId,
        updates,
        itemUpdate: update,
        request,
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
