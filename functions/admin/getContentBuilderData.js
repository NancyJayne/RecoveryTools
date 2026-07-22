import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { CONTENT_BUILDER_OPTIONS } from "./contentBuilderOptions.js";
import { loadContentTemplateDefinitions } from "./contentTemplateDefinitions.js";
import {
  accessGrantsForProduct,
  activePriceForProduct,
  loadProductArchitecture,
  variantsForProduct,
} from "../utils/productArchitecture.js";

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

function storedNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function normalizeRecord(type, doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    recordType: type,
    name: data.name || data.title || data.itemName || doc.id,
    type: data.type || data.itemType || data.blueprintType || data.planType || data.campaignType || "",
    firebaseType: data.type || data.firebaseType || "",
    itemType: data.itemType || data.type || "",
    itemKind: data.itemKind || "",
    categoryId: data.categoryId || data.conditionId || "",
    blueprintType: data.blueprintType || "",
    planType: data.planType || "",
    campaignType: data.campaignType || "",
    template: data.template || data.templateType || "",
    templateId: data.templateId || data.templateVariantId || "",
    templateFieldValues: data.templateFieldValues &&
      typeof data.templateFieldValues === "object" &&
      !Array.isArray(data.templateFieldValues)
      ? data.templateFieldValues
      : {},
    entityVariants: Array.isArray(data.entityVariants) ? data.entityVariants : [],
    templateContent: data.templateContent &&
      typeof data.templateContent === "object" &&
      !Array.isArray(data.templateContent)
      ? data.templateContent
      : {
        warmupBlueprintIds: data.blueprintGroups?.warmup || [],
        mainBlueprintIds: data.blueprintGroups?.main || [],
        cooldownBlueprintIds: data.blueprintGroups?.cooldown || [],
        blueprintItemIds: [],
      },
    intendedOutput: data.intendedOutput || "",
    durationMinutes: storedNumber(data.durationMinutes),
    sizeLabel: data.sizeLabel || "",
    startDate: data.startDate || "",
    endDate: data.endDate || "",
    status: data.status || data.displayStatus || (data.visible ? "active" : "draft"),
    visibility: cleanStatus(data.visibility || (data.visible ? "users" : "private")),
    amendmentComments: data.amendmentComments || "",
    scheduledActiveAt: asIso(data.scheduledActiveAt) || data.scheduledActiveAt || "",
    scheduledPauseAt: asIso(data.scheduledPauseAt) || data.scheduledPauseAt || "",
    marketplaceVisibility: data.marketplaceVisibility || data.shopStatus || "",
    owner: data.owner || data.ownerName || data.ownerType || "",
    ownerType: data.ownerType || "",
    createdByUid: data.createdByUid || "",
    createdByEmail: data.createdByEmail || "",
    updatedByUid: data.updatedByUid || "",
    updatedByEmail: data.updatedByEmail || "",
    approvalStatus: data.approvalStatus || "",
    publishRequested: data.publishRequested === true,
    tags: Array.isArray(data.tags) ? data.tags : [],
    shortDescription: data.shortDescription || data.description || data.summary || "",
    longDescription: data.longDescription || data.notes || "",
    itemId: data.itemId || null,
    blueprintId: data.blueprintId || null,
    planId: data.planId || null,
    campaignId: data.campaignId || null,
    linkedItemIds: Array.isArray(data.linkedItemIds) ? data.linkedItemIds : [],
    linkedItemComponents: Array.isArray(data.linkedItemComponents) ? data.linkedItemComponents : [],
    estimatedUnitCost: Number(data.estimatedUnitCost ?? 0),
    linkedBlueprintIds: Array.isArray(data.linkedBlueprintIds) ? data.linkedBlueprintIds : [],
    linkedPlanIds: Array.isArray(data.linkedPlanIds) ? data.linkedPlanIds : [],
    createsProduct: data.createsProduct === true || data.isShopProduct === true,
    websiteVisible: data.websiteVisible === true || data.visible === true,
    requestedWebsiteVisible: data.requestedWebsiteVisible === true,
    audience: data.audience || "",
    goal: data.goal || "",
    instructor: data.instructor || "",
    updatedAt: asIso(data.updatedAt),
    createdAt: asIso(data.createdAt),
  };
}

function normalizeItemRecord(doc, related = {}) {
  const record = normalizeRecord("item", doc);
  const product = related.productsByItemId.get(doc.id);
  const itemInventory = related.architecture?.inventoryByItemId?.get(doc.id) || [];
  const itemStock = itemInventory.reduce((sum, entry) => sum + Number(entry.stockQty ?? entry.stock ?? 0), 0);
  const standaloneInventory = itemInventory.find((entry) => !entry.productId && !entry.variantId) ||
    itemInventory[0] || {};
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
    isShopProduct: doc.data()?.isShopProduct === true || product?.isShopProduct === true ||
      product?.shopStatus === "active" || product?.visible === true,
    isAsset: ["asset", "document", "policy", "image", "video", "audio"].includes(cleanStatus(record.type)),
    assetType: primaryAsset?.assetType || "",
    inventoryTracked: product?.inventoryTracked === true || doc.data()?.inventoryTracked === true,
    itemReorderLevel: Number(standaloneInventory.reorderLevel ?? doc.data()?.reorderLevel ?? 0),
    itemInventoryUnit: standaloneInventory.unit || doc.data()?.inventoryUnit || "",
    itemInventoryLocation: standaloneInventory.location || doc.data()?.inventoryLocation || "",
    itemUnitCost: Number(standaloneInventory.unitCost ?? doc.data()?.unitCost ?? 0),
    itemCostReference: standaloneInventory.costReference || doc.data()?.costReference || "",
    websiteVisible: doc.data()?.websiteVisible === true || doc.data()?.visible === true,
    requestedWebsiteVisible: doc.data()?.requestedWebsiteVisible === true,
    requestedProductVisible: doc.data()?.requestedProductVisible === true,
    soldByRecoveryTools: doc.data()?.soldByRecoveryTools !== false,
    requiresShipping: product?.requiresShipping === true || doc.data()?.requiresShipping === true,
    requiresCalendar: doc.data()?.requiresCalendar === true,
    requiresSessionTime: doc.data()?.requiresSessionTime === true,
    tracksSeats: doc.data()?.tracksSeats === true,
    requiresLocation: doc.data()?.requiresLocation === true,
    requiresInstructor: doc.data()?.requiresInstructor === true,
    issuesCertificate: doc.data()?.issuesCertificate === true,
    seatCapacity: Number(doc.data()?.seatCapacity || 0) || null,
    unlocksAccess: product?.unlocksAccess === true || doc.data()?.unlocksAccess === true,
    accessType: doc.data()?.accessType || "",
    deliveryMode: doc.data()?.deliveryMode || "",
    eventStartAt: doc.data()?.eventStartAt || "",
    eventEndAt: doc.data()?.eventEndAt || "",
    eventLocation: doc.data()?.eventLocation || "",
    instructor: doc.data()?.instructor || "",
    certificateName: doc.data()?.certificateName || "",
    hasVariants: variants.length > 0,
    variantCount: variants.length,
    hasActivePrice: !!activePrice,
    hasPrimaryAsset: !!primaryAsset,
    itemProductId: product?.id || "",
    productId: product?.id || "",
    productName: product?.name || product?.title || "",
    productSku: product?.sku || "",
    productCategoryId: product?.productCategoryId || product?.categoryId || "",
    productType: product?.type || "",
    productShopStatus: product?.shopStatus || "",
    productVisible: product?.visible === true,
    productArchived: product?.archived === true,
    productFeatured: product?.featured === true,
    productRequiresShipping: product?.requiresShipping === true,
    productInventoryTracked: product?.inventoryTracked === true,
    productRequiresCalendar: product?.requiresCalendar === true,
    productRequiresSessionTime: product?.requiresSessionTime === true,
    productTracksSeats: product?.tracksSeats === true,
    productRequiresLocation: product?.requiresLocation === true,
    productRequiresInstructor: product?.requiresInstructor === true,
    productInstructor: product?.instructor || "",
    itemStock,
    productStock: Number(product?.stock ?? itemStock),
    manufacturingBlueprintId: product?.manufacturingBlueprintId || "",
    productVariantContentLinks: Array.isArray(product?.variantContentLinks) ? product.variantContentLinks : [],
    productAccessGrants: product
      ? accessGrantsForProduct(product.id, product, related.architecture)
      : [],
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
    productRetailPrice: storedNumber(
      activePrice?.retailPrice,
      product?.retailPrice,
      product?.price,
      product?.priceFrom,
      activePrice?.effectiveShopPrice,
    ),
    productSalePrice: product?.salePrice ?? activePrice?.salePrice ?? null,
    saleStartsAt: asIso(product?.saleStartsAt) || product?.saleStartsAt || "",
    saleEndsAt: asIso(product?.saleEndsAt) || product?.saleEndsAt || "",
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
      priceOverride: Number(variant.priceOverride) > 0 ? Number(variant.priceOverride) : null,
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

function addLinkedProducts(records, entityType, productsById, links, architecture) {
  const linksByEntityId = new Map();
  links
    .filter((link) => link.linkedEntityType === entityType && cleanStatus(link.status || "active") === "active")
    .forEach((link) => {
      const values = linksByEntityId.get(link.linkedEntityId) || [];
      values.push(link);
      linksByEntityId.set(link.linkedEntityId, values);
    });

  return records.map((record) => {
    const recordLinks = linksByEntityId.get(record.id) || [];
    const primaryLink = recordLinks.find((link) => link.isPrimary === true) || recordLinks[0];
    const product = primaryLink ? productsById.get(primaryLink.productId) : null;
    if (!product) return { ...record, createsProduct: record.createsProduct === true };
    const activePrice = activePriceForProduct(product.id, architecture);
    const variants = variantsForProduct(product.id, product.itemId || "", architecture, true);
    return {
      ...record,
      createsProduct: true,
      linkedProductIds: recordLinks.map((link) => link.productId),
      productId: product.id,
      productLinkRole: primaryLink.linkRole || "Represents",
      productName: product.productName || product.name || product.title || "",
      productSku: product.sku || "",
      productCategoryId: product.productCategoryId || product.categoryId || "",
      productType: product.productType || product.type || "",
      productShopStatus: product.shopStatus || product.status || "draft",
      productVisible: product.websiteVisible === true || product.visible === true,
      productFeatured: product.featured === true,
      productArchived: !!product.archivedAt || product.archived === true,
      productStock: Number(product.stock ?? 0),
      productRequiresShipping: product.requiresShipping === true,
      productInventoryTracked: product.inventoryTracked === true,
      productRequiresCalendar: product.requiresCalendar === true,
      productRequiresSessionTime: product.requiresSessionTime === true,
      productTracksSeats: product.tracksSeats === true,
      productRequiresLocation: product.requiresLocation === true,
      productRequiresInstructor: product.requiresInstructor === true,
      productInstructor: product.instructor || "",
      manufacturingBlueprintId: product.manufacturingBlueprintId || "",
      productVariantContentLinks: Array.isArray(product.variantContentLinks) ? product.variantContentLinks : [],
      productAccessGrants: accessGrantsForProduct(product.id, product, architecture),
      productEffectiveShopPrice: positiveNumber(activePrice?.effectiveShopPrice, product.basePrice, product.price),
      activePriceId: activePrice?.id || "",
      variants,
    };
  });
}

function categoryDisplayName(id, data = {}) {
  const stored = data.name || data.categoryName || data.label || data.title || "";
  if (stored && cleanStatus(stored) !== cleanStatus(id)) return stored;
  const builtIn = CONTENT_BUILDER_OPTIONS.categoryOptions
    ?.find((category) => category.id === id)?.name;
  if (builtIn) return builtIn;
  return String(id || "")
    .replace(/^CAT[-_]/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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

function mergeOptions(
  savedOptions = {},
  workbookTypes = {},
  workbookCategories = [],
  workbookTemplates = {},
) {
  const inputTemplates = {
    ...CONTENT_BUILDER_OPTIONS.templateDefinitions,
    item: workbookTemplates.item || [],
    blueprint: workbookTemplates.blueprint || [],
    plan: workbookTemplates.plan || [],
  };
  return {
    ...CONTENT_BUILDER_OPTIONS,
    ...savedOptions,
    itemTypes: workbookTypes.item?.length
      ? mergeUnique([], workbookTypes.item)
      : CONTENT_BUILDER_OPTIONS.itemTypes,
    itemKinds: mergeUnique(CONTENT_BUILDER_OPTIONS.itemKinds, savedOptions.itemKinds),
    categoryOptions: workbookCategories.length ? workbookCategories : mergeUnique(
      CONTENT_BUILDER_OPTIONS.categoryOptions?.map((option) => option.id),
      savedOptions.categoryOptions?.map((option) => option.id),
    ).map((id) => {
      const allOptions = [
        ...(CONTENT_BUILDER_OPTIONS.categoryOptions || []),
        ...(savedOptions.categoryOptions || []),
      ];
      return allOptions.find((option) => option.id === id) || { id, name: id };
    }),
    blueprintTypes: workbookTypes.blueprint?.length
      ? mergeUnique([], workbookTypes.blueprint)
      : CONTENT_BUILDER_OPTIONS.blueprintTypes,
    planTypes: workbookTypes.plan?.length
      ? mergeUnique([], workbookTypes.plan)
      : CONTENT_BUILDER_OPTIONS.planTypes,
    campaignTypes: mergeUnique(CONTENT_BUILDER_OPTIONS.campaignTypes, savedOptions.campaignTypes),
    templateDefinitions: mergeTemplateDefinitions(
      inputTemplates,
      savedOptions.templateDefinitions,
    ),
  };
}

async function getRecords(db, type) {
  const collection = COLLECTIONS[type];
  const snapshot = await db.collection(collection).limit(500).get();
  return snapshot.docs.map((doc) => normalizeRecord(type, doc));
}

async function getAssetRecords(db) {
  const snapshot = await db.collection("assets").limit(500).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      recordType: "asset",
      name: data.title || data.name || doc.id,
      type: data.type || data.assetType || "",
      status: data.status || data.displayStatus || "",
      url: data.fileUrl || data.url || "",
      thumbnailUrl: data.thumbnailUrl || "",
      altText: data.altText || "",
    };
  });
}

async function getItemRecords(db) {
  const [
    itemsSnapshot,
    productsSnapshot,
    itemAssetsSnapshot,
    architecture,
  ] = await Promise.all([
    db.collection("items").limit(500).get(),
    db.collection("products").limit(500).get(),
    db.collection("itemAssets").limit(500).get(),
    loadProductArchitecture(db),
  ]);

  const productsByItemId = new Map();
  productsSnapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (data.itemId) productsByItemId.set(data.itemId, { id: doc.id, ...data });
  });

  const activePricesByProductId = new Map();
  productsSnapshot.docs.forEach((doc) => {
    const activePrice = activePriceForProduct(doc.id, architecture);
    if (activePrice) activePricesByProductId.set(doc.id, activePrice);
  });

  const variantsByProductId = new Map();
  productsSnapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    variantsByProductId.set(
      doc.id,
      variantsForProduct(doc.id, data.itemId || data.legacyItemId || "", architecture),
    );
  });

  const itemAssetsByItemId = new Map();
  itemAssetsSnapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (!data.itemId) return;
    const assets = itemAssetsByItemId.get(data.itemId) || [];
    assets.push({ id: doc.id, ...data });
    itemAssetsByItemId.set(data.itemId, assets);
  });
  architecture.entityAssetsByEntityId.forEach((links, entityId) => {
    links
      .filter((link) => link.entityType === "Item")
      .forEach((link) => {
        const existing = itemAssetsByItemId.get(entityId) || [];
        if (existing.some((itemAsset) => itemAsset.assetId === link.assetId)) return;
        existing.push({
          id: link.id,
          assetId: link.assetId,
          itemId: entityId,
          purpose: link.assetRole || link.purpose || "",
          sortOrder: link.sortOrder ?? null,
          displayStatus: link.displayStatus || link.status || "",
        });
        itemAssetsByItemId.set(entityId, existing);
      });
  });

  const assetsById = architecture.assetsById;

  const related = {
    productsByItemId,
    activePricesByProductId,
    variantsByProductId,
    itemAssetsByItemId,
    assetsById,
    architecture,
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
    const [
      items,
      blueprints,
      plans,
      campaigns,
      assets,
      settingsSnap,
      entityTypesSnapshot,
      categoriesSnapshot,
      tagsSnapshot,
      workbookTemplates,
      productsSnapshot,
      productLinksSnapshot,
      architecture,
      instructorsSnapshot,
      usersSnapshot,
    ] = await Promise.all([
      getItemRecords(db),
      getRecords(db, "blueprint"),
      getRecords(db, "plan"),
      getRecords(db, "campaign"),
      getAssetRecords(db),
      db.collection("settings").doc("contentBuilderOptions").get(),
      db.collection("entityTypes").where("status", "==", "active").limit(200).get(),
      db.collection("categories").limit(200).get(),
      db.collection("tags").limit(500).get(),
      loadContentTemplateDefinitions(db),
      db.collection("products").limit(500).get(),
      db.collection("productLinks").limit(1000).get(),
      loadProductArchitecture(db),
      db.collection("instructors").limit(500).get(),
      db.collection("users").limit(1000).get(),
    ]);

    const productsById = new Map(productsSnapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
    const productLinks = productLinksSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const linkedItems = addLinkedProducts(items, "Item", productsById, productLinks, architecture);
    const linkedBlueprints = addLinkedProducts(blueprints, "Blueprint", productsById, productLinks, architecture);
    const linkedPlans = addLinkedProducts(plans, "Plan", productsById, productLinks, architecture);

    const instructorOptionsByName = new Map();
    const addInstructorOption = ({ id = "", name = "", email = "" } = {}) => {
      const cleanName = String(name || "").trim();
      if (!cleanName) return;
      const key = cleanName.toLowerCase();
      const current = instructorOptionsByName.get(key) || {};
      instructorOptionsByName.set(key, {
        id: id || current.id || cleanName,
        name: cleanName,
        email: email || current.email || "",
      });
    };
    instructorsSnapshot.docs.forEach((doc) => {
      const data = doc.data() || {};
      if (["archived", "inactive"].includes(cleanStatus(data.status))) return;
      addInstructorOption({
        id: doc.id,
        name: data.name || data.instructorName || data.displayName || doc.id,
        email: data.email,
      });
    });
    usersSnapshot.docs.forEach((doc) => {
      const data = doc.data() || {};
      const roles = data.roles || {};
      const isInstructor = data.instructor === true || roles.instructor === true ||
        cleanStatus(data.role) === "instructor";
      if (!isInstructor || cleanStatus(data.status) === "archived") return;
      addInstructorOption({
        id: doc.id,
        name: data.name || data.displayName || data.email || doc.id,
        email: data.email,
      });
    });
    [...linkedItems, ...linkedBlueprints, ...linkedPlans].forEach((record) => {
      addInstructorOption({ name: record.instructor });
    });
    productsById.forEach((product) => {
      addInstructorOption({ name: product.instructor });
      variantsForProduct(product.id, product.itemId || "", architecture, true)
        .forEach((variant) => addInstructorOption({ name: variant.instructor }));
    });
    const instructorOptions = [...instructorOptionsByName.values()]
      .sort((left, right) => left.name.localeCompare(right.name));

    const savedOptions = settingsSnap.exists ? settingsSnap.data() : {};
    const workbookTypes = { item: [], blueprint: [], plan: [] };
    const entityTypeDefinitions = [];
    entityTypesSnapshot.docs.forEach((doc) => {
      const data = doc.data() || {};
      const kind = cleanStatus(data.entityKind);
      const type = cleanStatus(data.type);
      if (workbookTypes[kind] && type) workbookTypes[kind].push(type);
      if (kind && type) {
        entityTypeDefinitions.push({
          id: doc.id,
          entityKind: kind,
          type,
          fieldGroupIds: Array.isArray(data.fieldGroupIds) ? data.fieldGroupIds : [],
          capabilities: {
            canUseInBlueprints: data.canUseInBlueprints === true,
            canUseInPlans: data.canUseInPlans === true,
            hasContent: data.hasContent === true,
            hasAssets: data.hasAssets === true,
            isShopProduct: data.isShopProduct === true,
            tracksInventory: data.tracksInventory === true,
            hasVariants: data.hasVariants === true,
            unlocksAccess: data.unlocksAccess === true,
            isPhysical: data.isPhysical === true,
            hasDosage: data.hasDosage === true,
          },
        });
      }
    });
    const workbookCategories = categoriesSnapshot.docs
      .map((doc) => {
        const data = doc.data() || {};
        return {
          id: doc.id,
          name: categoryDisplayName(doc.id, data),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    const tagOptions = tagsSnapshot.docs
      .map((doc) => {
        const data = doc.data() || {};
        return {
          id: doc.id,
          name: data.name || doc.id,
          categoryId: data.categoryId || data.CategoryID || "",
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      options: {
        ...mergeOptions(
          savedOptions,
          workbookTypes,
          workbookCategories,
          workbookTemplates,
        ),
        tagOptions,
        instructorOptions,
        entityTypeDefinitions,
      },
      records: {
        items: linkedItems,
        blueprints: linkedBlueprints,
        plans: linkedPlans,
        campaigns,
        assets,
        products: [...productsById.values()].map((product) => ({
          id: product.id,
          name: product.productName || product.name || product.title || product.id,
          productType: product.productType || product.type || "",
          status: product.status || product.shopStatus || "draft",
          sku: product.sku || "",
          productCategoryId: product.productCategoryId || product.categoryId || "",
          visible: product.visible === true || product.websiteVisible === true,
          featured: product.featured === true,
          archived: product.archived === true || !!product.archivedAt,
          stock: Number(product.stock ?? 0),
          requiresShipping: product.requiresShipping === true,
          inventoryTracked: product.inventoryTracked === true,
          requiresCalendar: product.requiresCalendar === true,
          requiresSessionTime: product.requiresSessionTime === true,
          tracksSeats: product.tracksSeats === true,
          requiresLocation: product.requiresLocation === true,
          requiresInstructor: product.requiresInstructor === true,
          instructor: product.instructor || "",
          manufacturingBlueprintId: product.manufacturingBlueprintId || "",
          variantContentLinks: Array.isArray(product.variantContentLinks) ? product.variantContentLinks : [],
          variants: variantsForProduct(product.id, product.itemId || "", architecture, true),
          accessGrants: accessGrantsForProduct(product.id, product, architecture),
        })),
      },
    };
  },
);
