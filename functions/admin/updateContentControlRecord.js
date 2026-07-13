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
  items: "itemType",
  blueprints: "blueprintType",
  plans: "planType",
  campaigns: "campaignType",
};

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
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

function cleanTags(value) {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter(Boolean).slice(0, 50);
  }

  return cleanString(value)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 50);
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
  if (collection !== "items" || !updates.productRelation || typeof updates.productRelation !== "object") return;

  const relation = updates.productRelation;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const itemRef = db.collection("items").doc(recordId);
  const itemSnap = await transaction.get(itemRef);
  const itemData = itemSnap.exists ? itemSnap.data() || {} : {};
  const productId = cleanString(relation.productId) ||
    cleanString(updates.productId) ||
    `PROD-${slugify(recordId).replace(/^ITEM-/, "")}`;
  const productRef = db.collection("products").doc(productId);
  const productSnap = await transaction.get(productRef);
  const productData = productSnap.exists ? productSnap.data() || {} : {};
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
  const effectivePrice = asNumber(relation.effectiveShopPrice ?? relation.price) ?? existingEffectivePrice;
  const retailPrice = asNumber(priceData.retailPrice) ??
    asNumber(productData.retailPrice) ??
    effectivePrice;
  const salePrice = asNumber(priceData.salePrice) ?? asNumber(productData.salePrice);
  const onSale = priceData.onSale === true || productData.onSale === true;
  const stock = asNumber(relation.stock) ?? asNumber(productData.stock) ?? 0;
  const variants = Array.isArray(relation.variants)
    ? relation.variants
      .map((variant, index) => normalizeVariant(variant, index, recordId, productId))
      .filter(Boolean)
    : [];

  transaction.set(productRef, {
    productId,
    itemId: recordId,
    name,
    title: name,
    type: productTypeValue(relation.productType || itemUpdate.type || itemData.type, "tool"),
    itemType: itemUpdate.itemType || itemData.itemType || "",
    itemKind: itemUpdate.itemKind || itemData.itemKind || "",
    categoryId: itemUpdate.categoryId || itemData.categoryId || "",
    sku: cleanString(relation.sku),
    shopStatus: cleanString(relation.shopStatus || "draft").toLowerCase(),
    visible: asBoolean(relation.visible),
    websiteVisible: asBoolean(relation.visible),
    archived: asBoolean(relation.archived),
    featured: asBoolean(relation.featured),
    requiresShipping: asBoolean(relation.requiresShipping),
    inventoryTracked: asBoolean(relation.inventoryTracked),
    price: effectivePrice,
    priceFrom: variants
      .map((variant) => variant.priceOverride)
      .filter((price) => price !== null)
      .concat([effectivePrice])
      .sort((a, b) => a - b)[0],
    retailPrice,
    salePrice,
    onSale,
    stock: variants.length
      ? variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0)
      : stock,
    hasVariants: variants.length > 0,
    updatedAt: now,
    updatedByUid: request.auth.uid,
    updatedByEmail: request.auth.token.email || "",
    createdAt: productData.createdAt || now,
  }, { merge: true });

  transaction.set(priceRef, {
    priceId,
    productId,
    variantId: "",
    currency: "AUD",
    retailPrice,
    salePrice,
    onSale,
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
      itemId: recordId,
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
        itemId: recordId,
        productId,
        variantId: variant.variantId,
        stockQty: variant.stock,
        updatedAt: now,
        updatedByUid: request.auth.uid,
      }, { merge: true });
    }
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

    const update = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: request.auth.uid,
      updatedByEmail: request.auth.token.email || "",
    };

    applyString(update, updates, "name");
    if (update.name) update.title = update.name;
    applyString(update, updates, "status");
    applyString(update, updates, "publishStatus");
    applyString(update, updates, "approvalStatus");
    applyString(update, updates, "visibility");
    applyString(update, updates, "owner", "ownerType");
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
    applyArray(update, updates, "linkedItemIds");
    applyArray(update, updates, "linkedBlueprintIds");
    applyArray(update, updates, "linkedPlanIds");

    if (collection === "items") {
      applyString(update, updates, "firebaseType", "type");
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
      applyNumber(update, updates, "seatCapacity");
    }

    if (updates.tags !== undefined) {
      update.tags = cleanTags(updates.tags);
    }

    const db = admin.firestore();
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
      transaction.set(db.collection(collection).doc(recordId), update, { merge: true });
    });

    return { success: true, recordId, recordType: collection };
  },
);
