import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { CONTENT_BUILDER_OPTIONS } from "./contentBuilderOptions.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const COLLECTIONS = {
  item: "items",
  blueprint: "blueprints",
  plan: "plans",
  campaign: "campaigns",
};

function asIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return null;
}

function cleanStatus(value, fallback = "") {
  return String(value || fallback || "").toLowerCase().trim();
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function normalizeRecord(type, doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    recordType: type,
    name: data.name || data.title || data.itemName || doc.id,
    type: data.itemType || data.blueprintType || data.planType || data.campaignType || data.type || "",
    firebaseType: data.type || "",
    itemType: data.itemType || "",
    itemKind: data.itemKind || "",
    categoryId: data.categoryId || data.conditionId || "",
    blueprintType: data.blueprintType || "",
    planType: data.planType || "",
    campaignType: data.campaignType || "",
    template: data.template || data.templateType || "",
    status: data.status || data.displayStatus || (data.visible ? "active" : "draft"),
    publishStatus: data.publishStatus || data.displayStatus || "",
    approvalStatus: data.approvalStatus || data.approvedStatus || "",
    visibility: data.visibility || (data.visible ? "Public" : "Private"),
    marketplaceVisibility: data.marketplaceVisibility || data.shopStatus || "",
    owner: data.ownerType || data.owner || "",
    tags: Array.isArray(data.tags) ? data.tags : [],
    shortDescription: data.shortDescription || data.description || data.summary || "",
    longDescription: data.longDescription || data.notes || "",
    itemId: data.itemId || null,
    blueprintId: data.blueprintId || null,
    planId: data.planId || null,
    campaignId: data.campaignId || null,
    linkedItemIds: Array.isArray(data.linkedItemIds) ? data.linkedItemIds : [],
    linkedBlueprintIds: Array.isArray(data.linkedBlueprintIds) ? data.linkedBlueprintIds : [],
    linkedPlanIds: Array.isArray(data.linkedPlanIds) ? data.linkedPlanIds : [],
    audience: data.audience || "",
    goal: data.goal || "",
    updatedAt: asIso(data.updatedAt),
    createdAt: asIso(data.createdAt),
  };
}

function normalizeItemRecord(doc, related = {}) {
  const record = normalizeRecord("item", doc);
  const product = related.productsByItemId.get(doc.id);
  const activePrice = product ? related.activePricesByProductId.get(product.id) : null;
  const variants = product ? related.variantsByProductId.get(product.id) || [] : [];
  const itemAssets = (related.itemAssetsByItemId.get(doc.id) || []).map((itemAsset) => ({
    ...itemAsset,
    asset: related.assetsById.get(itemAsset.assetId) || null,
  }));
  const primaryAsset = itemAssets.find((asset) =>
    cleanStatus(asset.purpose).includes("primary") ||
    asset.sortOrder === 1,
  );

  return {
    ...record,
    hasItemProduct: !!product,
    isShopProduct: product?.isShopProduct === true || product?.shopStatus === "active" || product?.visible === true,
    isAsset: ["asset", "document", "policy", "image", "video", "audio"].includes(cleanStatus(record.firebaseType)),
    assetType: primaryAsset?.assetType || "",
    inventoryTracked: product?.inventoryTracked === true || doc.data()?.inventoryTracked === true,
    websiteVisible: doc.data()?.websiteVisible === true || doc.data()?.visible === true,
    soldByRecoveryTools: doc.data()?.soldByRecoveryTools !== false,
    requiresShipping: product?.requiresShipping === true || doc.data()?.requiresShipping === true,
    requiresCalendar: doc.data()?.requiresCalendar === true,
    requiresSessionTime: doc.data()?.requiresSessionTime === true,
    tracksSeats: doc.data()?.tracksSeats === true,
    seatCapacity: Number(doc.data()?.seatCapacity || 0) || null,
    unlocksAccess: product?.unlocksAccess === true || doc.data()?.unlocksAccess === true,
    hasVariants: variants.length > 0,
    variantCount: variants.length,
    hasActivePrice: !!activePrice,
    hasPrimaryAsset: !!primaryAsset,
    itemProductId: product?.id || "",
    productId: product?.id || "",
    productName: product?.name || product?.title || "",
    productSku: product?.sku || "",
    productType: product?.type || "",
    productShopStatus: product?.shopStatus || "",
    productVisible: product?.visible === true,
    productArchived: product?.archived === true,
    productFeatured: product?.featured === true,
    productRequiresShipping: product?.requiresShipping === true,
    productInventoryTracked: product?.inventoryTracked === true,
    productStock: Number(product?.stock ?? 0),
    productEffectiveShopPrice: positiveNumber(
      activePrice?.effectiveShopPrice,
      product?.price,
      product?.priceFrom,
    ),
    productPrice: positiveNumber(
      activePrice?.effectiveShopPrice,
      product?.price,
      product?.priceFrom,
      activePrice?.retailPrice,
      product?.retailPrice,
    ),
    productRetailPrice: positiveNumber(
      activePrice?.retailPrice,
      product?.retailPrice,
      product?.price,
      product?.priceFrom,
      activePrice?.effectiveShopPrice,
    ),
    productSalePrice: product?.salePrice ?? activePrice?.salePrice ?? null,
    activePriceId: activePrice?.id || "",
    activePrice: activePrice ? {
      id: activePrice.id,
      priceId: activePrice.priceId || activePrice.id,
      retailPrice: Number(activePrice.retailPrice ?? 0),
      salePrice: activePrice.salePrice ?? null,
      effectiveShopPrice: Number(activePrice.effectiveShopPrice ?? 0),
      status: activePrice.status || "",
    } : null,
    assets: itemAssets.map((itemAsset) => ({
      itemAssetId: itemAsset.id,
      assetId: itemAsset.assetId || "",
      title: itemAsset.contextTitle || itemAsset.asset?.title || itemAsset.asset?.name || "",
      purpose: itemAsset.purpose || "",
      type: itemAsset.asset?.type || itemAsset.assetType || "",
      url: itemAsset.asset?.fileUrl || itemAsset.asset?.url || "",
      status: itemAsset.displayStatus || itemAsset.asset?.status || "",
      sortOrder: itemAsset.sortOrder ?? null,
    })),
    variants: variants.map((variant) => ({
      id: variant.id,
      variantId: variant.variantId || variant.id,
      name: variant.name || "",
      colour: variant.colour || "",
      size: variant.size || "",
      sku: variant.sku || "",
      priceOverride: variant.priceOverride ?? null,
      stock: Number(variant.stock ?? 0),
      status: variant.status || "active",
    })),
    shopStatus: product?.shopStatus || "",
    inventorySummary: {
      status: product?.inventoryTracked ? "Tracked" : "Not tracked",
      stock: Number(product?.stock || 0),
    },
    missingData: [
      product && !activePrice ? "Missing Active Price" : "",
      product && !primaryAsset ? "Missing Primary Asset" : "",
      product && product.requiresShipping === true && !product.sku ? "Missing Product Configuration" : "",
    ].filter(Boolean),
    relationshipHealth: product && (!activePrice || !primaryAsset) ? "Needs attention" : "OK",
  };
}

function mergeUnique(left = [], right = []) {
  return [...new Set([...(left || []), ...(right || [])].filter(Boolean))];
}

function mergeTemplateDefinitions(defaults = {}, saved = {}) {
  const output = {};
  const keys = new Set([...Object.keys(defaults), ...Object.keys(saved)]);

  for (const key of keys) {
    const records = [...(defaults[key] || []), ...(saved[key] || [])];
    const byId = new Map();
    records.forEach((record) => {
      if (!record?.id) return;
      byId.set(record.id, record);
    });
    output[key] = [...byId.values()];
  }

  return output;
}

function mergeOptions(savedOptions = {}) {
  return {
    ...CONTENT_BUILDER_OPTIONS,
    ...savedOptions,
    itemTypes: mergeUnique(CONTENT_BUILDER_OPTIONS.itemTypes, savedOptions.itemTypes),
    itemKinds: mergeUnique(CONTENT_BUILDER_OPTIONS.itemKinds, savedOptions.itemKinds),
    categoryOptions: mergeUnique(
      CONTENT_BUILDER_OPTIONS.categoryOptions?.map((option) => option.id),
      savedOptions.categoryOptions?.map((option) => option.id),
    ).map((id) => {
      const allOptions = [
        ...(CONTENT_BUILDER_OPTIONS.categoryOptions || []),
        ...(savedOptions.categoryOptions || []),
      ];
      return allOptions.find((option) => option.id === id) || { id, name: id };
    }),
    firebaseTypes: mergeUnique(CONTENT_BUILDER_OPTIONS.firebaseTypes, savedOptions.firebaseTypes),
    blueprintTypes: mergeUnique(CONTENT_BUILDER_OPTIONS.blueprintTypes, savedOptions.blueprintTypes),
    planTypes: mergeUnique(CONTENT_BUILDER_OPTIONS.planTypes, savedOptions.planTypes),
    campaignTypes: mergeUnique(CONTENT_BUILDER_OPTIONS.campaignTypes, savedOptions.campaignTypes),
    templateDefinitions: mergeTemplateDefinitions(
      CONTENT_BUILDER_OPTIONS.templateDefinitions,
      savedOptions.templateDefinitions,
    ),
  };
}

async function getRecords(db, type) {
  const collection = COLLECTIONS[type];
  const snapshot = await db.collection(collection).limit(100).get();
  return snapshot.docs.map((doc) => normalizeRecord(type, doc));
}

async function getItemRecords(db) {
  const [
    itemsSnapshot,
    productsSnapshot,
    pricesSnapshot,
    variantsSnapshot,
    itemAssetsSnapshot,
    assetsSnapshot,
  ] = await Promise.all([
    db.collection("items").limit(100).get(),
    db.collection("products").limit(500).get(),
    db.collection("productPrices").limit(500).get(),
    db.collection("itemVariants").limit(500).get(),
    db.collection("itemAssets").limit(500).get(),
    db.collection("assets").limit(500).get(),
  ]);

  const productsByItemId = new Map();
  productsSnapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (data.itemId) productsByItemId.set(data.itemId, { id: doc.id, ...data });
  });

  const activePricesByProductId = new Map();
  pricesSnapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (cleanStatus(data.status) === "active" && data.productId && !data.variantId) {
      activePricesByProductId.set(data.productId, { id: doc.id, ...data });
    }
  });

  const variantsByProductId = new Map();
  variantsSnapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (!data.productId) return;
    const variants = variantsByProductId.get(data.productId) || [];
    variants.push({ id: doc.id, ...data });
    variantsByProductId.set(data.productId, variants);
  });

  const itemAssetsByItemId = new Map();
  itemAssetsSnapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (!data.itemId) return;
    const assets = itemAssetsByItemId.get(data.itemId) || [];
    assets.push({ id: doc.id, ...data });
    itemAssetsByItemId.set(data.itemId, assets);
  });

  const assetsById = new Map();
  assetsSnapshot.docs.forEach((doc) => {
    assetsById.set(doc.id, { id: doc.id, ...doc.data() });
  });

  const related = {
    productsByItemId,
    activePricesByProductId,
    variantsByProductId,
    itemAssetsByItemId,
    assetsById,
  };

  return itemsSnapshot.docs.map((doc) => normalizeItemRecord(doc, related));
}

export const getContentBuilderData = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can view content builder data.");
    }

    const db = admin.firestore();
    const [items, blueprints, plans, campaigns, settingsSnap] = await Promise.all([
      getItemRecords(db),
      getRecords(db, "blueprint"),
      getRecords(db, "plan"),
      getRecords(db, "campaign"),
      db.collection("settings").doc("contentBuilderOptions").get(),
    ]);

    const savedOptions = settingsSnap.exists ? settingsSnap.data() : {};

    return {
      options: mergeOptions(savedOptions),
      records: {
        items,
        blueprints,
        plans,
        campaigns,
      },
    };
  },
);
