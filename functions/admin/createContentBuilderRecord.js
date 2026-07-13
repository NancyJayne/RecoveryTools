import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { CONTENT_BUILDER_OPTIONS } from "./contentBuilderOptions.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const RECORD_CONFIG = {
  item: {
    collection: "items",
    idPrefix: "ITEM",
    typeField: "itemType",
    optionsKey: "itemTypes",
  },
  blueprint: {
    collection: "blueprints",
    idPrefix: "BLUEPRINT",
    typeField: "blueprintType",
    optionsKey: "blueprintTypes",
  },
  plan: {
    collection: "plans",
    idPrefix: "PLAN",
    typeField: "planType",
    optionsKey: "planTypes",
  },
  campaign: {
    collection: "campaigns",
    idPrefix: "CAMPAIGN",
    typeField: "campaignType",
    optionsKey: "campaignTypes",
  },
};

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value) {
  return cleanString(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeStatus(value) {
  const status = cleanString(value).toLowerCase();
  return CONTENT_BUILDER_OPTIONS.statuses.includes(status) ? status : "draft";
}

function asArray(value) {
  return Array.isArray(value)
    ? value.map(cleanString).filter(Boolean).slice(0, 50)
    : [];
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanTemplateContent(value) {
  const content = asPlainObject(value);
  return {
    warmupBlueprintIds: asArray(content.warmupBlueprintIds),
    mainBlueprintIds: asArray(content.mainBlueprintIds),
    cooldownBlueprintIds: asArray(content.cooldownBlueprintIds),
    blueprintItemIds: asArray(content.blueprintItemIds),
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

async function contentOptions(db) {
  const snap = await db.collection("settings").doc("contentBuilderOptions").get();
  const saved = snap.exists ? snap.data() : {};
  return {
    ...CONTENT_BUILDER_OPTIONS,
    ...saved,
    itemTypes: mergeUnique(CONTENT_BUILDER_OPTIONS.itemTypes, saved.itemTypes),
    itemKinds: mergeUnique(CONTENT_BUILDER_OPTIONS.itemKinds, saved.itemKinds),
    blueprintTypes: mergeUnique(CONTENT_BUILDER_OPTIONS.blueprintTypes, saved.blueprintTypes),
    planTypes: mergeUnique(CONTENT_BUILDER_OPTIONS.planTypes, saved.planTypes),
    campaignTypes: mergeUnique(CONTENT_BUILDER_OPTIONS.campaignTypes, saved.campaignTypes),
    templateDefinitions: mergeTemplateDefinitions(
      CONTENT_BUILDER_OPTIONS.templateDefinitions,
      saved.templateDefinitions,
    ),
  };
}

function assetTypeFromUrl(url = "") {
  const clean = cleanString(url).toLowerCase();
  if (clean.includes(".pdf")) return "document";
  if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/.test(clean)) return "image";
  if (/\.(mp4|mov|webm)(\?|$)/.test(clean)) return "video";
  return "document";
}

function normalizeVariant(value, index) {
  if (!value || typeof value !== "object") return null;
  const name = cleanString(value.name) ||
    [cleanString(value.colour), cleanString(value.size)].filter(Boolean).join(" / ") ||
    `Variant ${index + 1}`;
  const variantId = cleanString(value.variantId);

  return {
    variantId,
    name,
    colour: cleanString(value.colour),
    size: cleanString(value.size),
    sku: cleanString(value.sku),
    priceOverride: asNumber(value.priceOverride),
    stockQty: asNumber(value.stockQty) ?? 0,
  };
}

function productTypeFromItem(doc) {
  const itemType = cleanString(doc.itemType).toLowerCase();
  const itemKind = cleanString(doc.itemKind).toLowerCase();
  const firebaseType = cleanString(doc.type).toLowerCase();

  if (itemType === "session") return "session";
  if (["course", "program", "workshop"].includes(firebaseType)) return firebaseType;
  if (itemKind === "digital product" || itemType === "digital product") return "course";
  return firebaseType || "tool";
}

function templateFor(options, recordType, templateId, typeValue) {
  const definitions = options.templateDefinitions?.[recordType] || [];
  return definitions.find((template) => template.id === templateId) ||
    definitions.find((template) => template.appliesTo === typeValue && template.isDefault) ||
    definitions.find((template) => template.appliesTo === typeValue) ||
    null;
}

function namesSimilar(a, b) {
  const left = cleanString(a).toLowerCase();
  const right = cleanString(b).toLowerCase();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

async function findSimilar(db, collection, name) {
  const snapshot = await db.collection(collection).limit(200).get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((record) => namesSimilar(record.name || record.title || record.itemName, name))
    .slice(0, 8)
    .map((record) => ({
      id: record.id,
      name: record.name || record.title || record.itemName || record.id,
      type: record.itemType || record.blueprintType || record.planType || record.campaignType || record.type || "",
      status: record.status || record.displayStatus || record.shopStatus || "",
    }));
}

export const createContentBuilderRecord = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can create content records.");
    }

    const data = request.data || {};
    const recordType = cleanString(data.recordType).toLowerCase();
    const config = RECORD_CONFIG[recordType];
    if (!config) {
      throw new HttpsError("invalid-argument", "Select a valid record type.");
    }

    const name = cleanString(data.name);
    const typeValue = cleanString(data.type);
    const templateId = cleanString(data.template);
    if (!name) {
      throw new HttpsError("invalid-argument", "Name is required.");
    }
    const db = admin.firestore();
    const options = await contentOptions(db);
    const allowedTypes = options[config.optionsKey] || [];

    if (typeValue && !allowedTypes.includes(typeValue)) {
      throw new HttpsError("invalid-argument", `Select a valid ${recordType} type.`);
    }

    const selectedTemplate = templateFor(options, recordType, templateId, typeValue);
    const templateDefaults = selectedTemplate?.defaults || {};
    const templateContent = cleanTemplateContent(data.templateContent);
    const similar = await findSimilar(db, config.collection, name);
    if (similar.length && data.confirmDuplicate !== true) {
      return {
        success: false,
        duplicateWarning: true,
        similar,
      };
    }

    const explicitId = slugify(data.id);
    const id = explicitId || `${config.idPrefix}-${slugify(name) || Date.now()}`;
    const ref = db.collection(config.collection).doc(id);
    const now = admin.firestore.FieldValue.serverTimestamp();

    const doc = {
      name,
      title: name,
      [config.typeField]: typeValue || templateDefaults[config.typeField] || allowedTypes[0],
      template: selectedTemplate?.name || templateId,
      templateId: selectedTemplate?.id || templateId,
      status: normalizeStatus(data.status),
      shortDescription: cleanString(data.shortDescription),
      longDescription: cleanString(data.longDescription),
      notes: cleanString(data.notes),
      tags: asArray(data.tags),
      updatedAt: now,
      createdAt: now,
      createdByUid: request.auth.uid,
      createdByEmail: request.auth.token.email || null,
    };

    if (recordType === "item") {
      Object.assign(doc, {
        itemId: id,
        type: cleanString(data.firebaseType || templateDefaults.firebaseType).toLowerCase() || "tool",
        itemType: typeValue || templateDefaults.itemType || "Physical Product",
        itemKind: cleanString(data.itemKind || templateDefaults.itemKind),
        categoryId: cleanString(data.categoryId || templateDefaults.categoryId),
        websiteVisible: data.websiteVisible === true,
        visible: data.websiteVisible === true,
        isShopProduct: data.isShopProduct ?? templateDefaults.isShopProduct ?? false,
        soldByRecoveryTools: data.soldByRecoveryTools ?? templateDefaults.soldByRecoveryTools ?? true,
        requiresShipping: data.requiresShipping ?? templateDefaults.requiresShipping ?? false,
        inventoryTracked: data.inventoryTracked ?? templateDefaults.inventoryTracked ?? false,
        stockStatus: templateDefaults.stockStatus || "not-tracked",
        unlocksAccess: data.unlocksAccess ?? templateDefaults.unlocksAccess ?? false,
        accessType: cleanString(data.accessType || templateDefaults.accessType),
        requiresCalendar: data.requiresCalendar ?? templateDefaults.requiresCalendar ?? false,
        requiresSessionTime: data.requiresSessionTime ?? templateDefaults.requiresSessionTime ?? false,
        tracksSeats: data.tracksSeats ?? templateDefaults.tracksSeats ?? false,
        seatCapacity: Number(data.seatCapacity || 0) || null,
        deliveryMode: cleanString(data.deliveryMode || templateDefaults.deliveryMode),
      });
    }

    if (recordType === "blueprint") {
      Object.assign(doc, {
        blueprintId: id,
        blueprintTemplateId: templateDefaults.blueprintTemplateId || selectedTemplate?.id || null,
        ownerType: templateDefaults.ownerType || null,
        approvalStatus: templateDefaults.approvalStatus || "Draft",
        visibility: templateDefaults.visibility || "Private",
        linkedItemIds: mergeUnique(asArray(data.linkedItemIds), templateContent.blueprintItemIds),
        intendedOutput: cleanString(data.intendedOutput),
        templateContent,
      });
    }

    if (recordType === "plan") {
      const durationMinutes = asNumber(data.durationMinutes) ||
        Number(templateDefaults.durationMinutes || 0) ||
        null;
      const sizeLabel = cleanString(data.sizeLabel || templateDefaults.sizeLabel);
      Object.assign(doc, {
        planId: id,
        planTemplateId: templateDefaults.planTemplateId || null,
        templateVariantId: templateDefaults.templateVariantId || selectedTemplate?.id || null,
        durationMinutes,
        sizeLabel,
        linkedItemIds: asArray(data.linkedItemIds),
        linkedBlueprintIds: asArray(data.linkedBlueprintIds),
        blueprintGroups: {
          warmup: templateContent.warmupBlueprintIds,
          main: templateContent.mainBlueprintIds,
          cooldown: templateContent.cooldownBlueprintIds,
        },
        templateContent,
        duration: cleanString(data.duration),
      });
    }

    if (recordType === "campaign") {
      Object.assign(doc, {
        campaignId: id,
        linkedItemIds: asArray(data.linkedItemIds),
        linkedBlueprintIds: asArray(data.linkedBlueprintIds),
        linkedPlanIds: asArray(data.linkedPlanIds),
        audience: cleanString(data.audience),
        goal: cleanString(data.goal),
        startDate: cleanString(data.startDate),
        endDate: cleanString(data.endDate),
        templateContent,
      });
    }

    try {
      const uploadedAssetUrl = cleanString(data.uploadedAssetUrl);
      const uploadedAssets = Array.isArray(data.uploadedAssets)
        ? data.uploadedAssets.filter((asset) => cleanString(asset?.url))
        : uploadedAssetUrl
          ? [{ url: uploadedAssetUrl }]
          : [];
      const assetTitle = cleanString(data.assetTitle) || name;
      const assetPurpose = cleanString(data.assetPurpose) || selectedTemplate?.name || "Primary Asset";

      await admin.firestore().runTransaction(async (transaction) => {
        transaction.set(ref, doc, { merge: false });

        if (recordType === "item" && uploadedAssets.length) {
          uploadedAssets.forEach((asset, index) => {
            const assetId = `ASSET-${slugify(id)}-${Date.now()}-${index + 1}`;
            const itemAssetId = `ITEMASSET-${slugify(id)}-${Date.now()}-${index + 1}`;
            const assetRef = db.collection("assets").doc(assetId);
            const itemAssetRef = db.collection("itemAssets").doc(itemAssetId);
            const currentTitle = cleanString(asset.title) || assetTitle;
            const currentUrl = cleanString(asset.url);

            transaction.set(assetRef, {
              assetId,
              name: currentTitle,
              type: cleanString(asset.type) || cleanString(data.assetType) || assetTypeFromUrl(currentUrl),
              title: currentTitle,
              altText: cleanString(asset.altText || data.assetAltText),
              fileUrl: currentUrl,
              thumbnailUrl: cleanString(asset.thumbnailUrl || data.assetThumbnailUrl),
              status: "active",
              ownerUserId: request.auth.uid,
              notes: cleanString(asset.notes || data.assetNotes),
              createdAt: now,
              updatedAt: now,
            });

            transaction.set(itemAssetRef, {
              itemAssetId,
              itemId: id,
              assetId,
              purpose: cleanString(asset.purpose) || assetPurpose,
              sortOrder: index + 1,
              displayStatus: "active",
              contextTitle: currentTitle,
              contextAltText: cleanString(asset.altText || data.assetAltText),
              notes: cleanString(asset.notes || data.assetNotes),
              createdAt: now,
              updatedAt: now,
            });
          });
        }

        if (recordType === "item" && doc.isShopProduct === true) {
          const productId = cleanString(data.productId) || `PROD-${slugify(id).replace(/^ITEM-/, "")}`;
          const productRef = db.collection("products").doc(productId);
          const priceId = `PRICE-${slugify(productId)}-BASE`;
          const priceRef = db.collection("productPrices").doc(priceId);
          const retailPrice = asNumber(data.price) ?? 0;
          const salePrice = asNumber(data.salePrice);
          const effectivePrice = salePrice ?? retailPrice;
          const variants = (Array.isArray(data.variants) ? data.variants : [])
            .map(normalizeVariant)
            .filter(Boolean);
          const images = uploadedAssets
            .filter((asset) => assetTypeFromUrl(asset.url) === "image")
            .map((asset) => cleanString(asset.url));
          const media = uploadedAssets.map((asset, index) => ({
            type: cleanString(asset.type) || assetTypeFromUrl(asset.url),
            url: cleanString(asset.url),
            title: cleanString(asset.title) || assetTitle,
            altText: cleanString(asset.altText || data.assetAltText),
            sortOrder: index + 1,
            displayStatus: "active",
          }));

          transaction.set(productRef, {
            productId,
            itemId: id,
            name,
            title: name,
            type: productTypeFromItem(doc),
            itemType: doc.itemType,
            itemKind: doc.itemKind,
            categoryId: doc.categoryId,
            tagIds: doc.tagIds || [],
            tags: doc.tags || [],
            shopStatus: normalizeStatus(data.shopStatus || (doc.visible ? "active" : "draft")),
            visible: data.shopVisible ?? doc.visible,
            websiteVisible: doc.websiteVisible,
            archived: false,
            featured: data.featured === true,
            requiresShipping: doc.requiresShipping === true,
            inventoryTracked: doc.inventoryTracked === true,
            sku: cleanString(data.sku),
            shortDescription: doc.shortDescription,
            longDescription: doc.longDescription,
            supplierType: cleanString(data.supplierType || templateDefaults.supplierType),
            unlocksAccess: doc.unlocksAccess === true,
            accessType: doc.accessType,
            relatedPlanId: cleanString(data.relatedPlanId || templateDefaults.relatedPlanId),
            relatedCourseId: cleanString(data.relatedCourseId || templateDefaults.relatedCourseId),
            relatedWorkshopId: cleanString(data.relatedWorkshopId || templateDefaults.relatedWorkshopId),
            accessCodeEligible: data.accessCodeEligible === true,
            slug: cleanString(data.slug) || slugify(name).toLowerCase(),
            price: effectivePrice,
            retailPrice,
            salePrice,
            onSale: salePrice !== null,
            priceFrom: variants
              .map((variant) => variant.priceOverride)
              .filter((price) => price !== null)
              .concat([effectivePrice])
              .sort((a, b) => a - b)[0],
            hasVariants: variants.length > 0,
            stock: doc.inventoryTracked === true
              ? (asNumber(data.stockQty) ?? variants.reduce((sum, variant) => sum + variant.stockQty, 0))
              : 0,
            images,
            media,
            createdAt: now,
            updatedAt: now,
          }, { merge: false });

          transaction.set(priceRef, {
            priceId,
            productId,
            variantId: "",
            currency: "AUD",
            retailPrice,
            salePrice,
            onSale: salePrice !== null,
            effectiveShopPrice: effectivePrice,
            gstIncluded: true,
            gstAmount: Number((effectivePrice / 11).toFixed(2)),
            status: "active",
            createdAt: now,
            updatedAt: now,
          }, { merge: false });

          variants.forEach((variant, index) => {
            const variantId = variant.variantId || `VAR-${slugify(id)}-${index + 1}`;
            const variantRef = db.collection("itemVariants").doc(variantId);
            transaction.set(variantRef, {
              variantId,
              itemId: id,
              productId,
              name: variant.name,
              colour: variant.colour,
              size: variant.size,
              sku: variant.sku,
              priceOverride: variant.priceOverride,
              status: "active",
              stock: variant.stockQty,
              createdAt: now,
              updatedAt: now,
            });

            if (variant.priceOverride !== null) {
              const variantPriceRef = db.collection("productPrices").doc(`PRICE-${slugify(productId)}-${index + 1}`);
              transaction.set(variantPriceRef, {
                priceId: variantPriceRef.id,
                productId,
                variantId,
                currency: "AUD",
                retailPrice: variant.priceOverride,
                salePrice: null,
                onSale: false,
                effectiveShopPrice: variant.priceOverride,
                gstIncluded: true,
                gstAmount: Number((variant.priceOverride / 11).toFixed(2)),
                status: "active",
                createdAt: now,
                updatedAt: now,
              });
            }

            if (doc.inventoryTracked === true) {
              const inventoryRef = db.collection("inventory").doc(`INV-${slugify(variantId)}`);
              transaction.set(inventoryRef, {
                inventoryId: inventoryRef.id,
                name: `${name} ${variant.name}`.trim(),
                itemId: id,
                productId,
                variantId,
                stockQty: variant.stockQty,
                updatedAt: now,
                createdAt: now,
              });
            }
          });

          if (doc.inventoryTracked === true && variants.length === 0) {
            const inventoryRef = db.collection("inventory").doc(`INV-${slugify(id)}`);
            transaction.set(inventoryRef, {
              inventoryId: inventoryRef.id,
              name,
              itemId: id,
              productId,
              variantId: "",
              stockQty: asNumber(data.stockQty) ?? 0,
              updatedAt: now,
              createdAt: now,
            });
          }
        }
      });
      return { success: true, id, recordType, similar };
    } catch (err) {
      console.error("Create content builder record error:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
