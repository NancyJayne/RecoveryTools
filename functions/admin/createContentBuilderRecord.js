import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { CONTENT_BUILDER_OPTIONS } from "./contentBuilderOptions.js";
import { loadContentTemplateDefinitions } from "./contentTemplateDefinitions.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const RECORD_CONFIG = {
  item: {
    collection: "items",
    idPrefix: "ITEM",
    typeField: "type",
    optionsKey: "itemTypes",
  },
  blueprint: {
    collection: "blueprints",
    idPrefix: "BLUEPRINT",
    typeField: "type",
    optionsKey: "blueprintTypes",
  },
  plan: {
    collection: "plans",
    idPrefix: "PLAN",
    typeField: "type",
    optionsKey: "planTypes",
  },
  campaign: {
    collection: "campaigns",
    idPrefix: "CAMPAIGN",
    typeField: "type",
    optionsKey: "campaignTypes",
  },
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

function cleanTemplateFieldValues(value) {
  const source = asPlainObject(value);
  const output = {};
  Object.entries(source).slice(0, 50).forEach(([rawKey, rawValue]) => {
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

function templateFieldKey(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function validateTemplateFieldValues(template, values) {
  const fields = Array.isArray(template?.defaults?.fields) ? template.defaults.fields : [];
  fields.forEach((field) => {
    const key = templateFieldKey(field.key || field.id || field.name);
    if (!key) return;
    const rawValue = values[key];
    const entries = Array.isArray(rawValue)
      ? rawValue.filter((entry) => cleanString(entry))
      : rawValue === null || rawValue === undefined || rawValue === ""
        ? []
        : [rawValue];
    const minimum = field.minEntries === null || field.minEntries === undefined || field.minEntries === ""
      ? null
      : Number.isInteger(Number(field.minEntries))
        ? Number(field.minEntries)
        : null;
    const maximum = field.maxEntries === null || field.maxEntries === undefined || field.maxEntries === ""
      ? null
      : Number.isInteger(Number(field.maxEntries))
        ? Number(field.maxEntries)
        : null;
    if (field.required === true && entries.length === 0) {
      throw new HttpsError("invalid-argument", `${field.name || "Template field"} is required.`);
    }
    if (minimum !== null && entries.length < minimum) {
      throw new HttpsError(
        "invalid-argument",
        `${field.name || "Template field"} needs at least ${minimum} entr${minimum === 1 ? "y" : "ies"}.`,
      );
    }
    if (field.allowUnlimited !== true && maximum !== null && entries.length > maximum) {
      throw new HttpsError(
        "invalid-argument",
        `${field.name || "Template field"} allows up to ${maximum} entr${maximum === 1 ? "y" : "ies"}.`,
      );
    }
  });
}

function selectedAssetLinks(template, values) {
  const fields = Array.isArray(template?.defaults?.fields) ? template.defaults.fields : [];
  const links = [];
  fields.forEach((field) => {
    const linkedTable = cleanString(field.linkedTable).toLowerCase();
    if (!["asset", "assets", "item asset", "item assets"].includes(linkedTable)) return;
    const key = templateFieldKey(field.key || field.id || field.name);
    const rawValue = values[key];
    const assetIds = Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : [];
    assetIds.forEach((assetId) => {
      const cleanAssetId = cleanString(assetId);
      if (!cleanAssetId) return;
      links.push({
        assetId: cleanAssetId,
        fieldKey: key,
        fieldName: cleanString(field.name) || "Template Asset",
      });
    });
  });
  const seen = new Set();
  return links.filter((link) => {
    const key = `${link.fieldKey}:${link.assetId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 100);
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
  const [snap, entityTypesSnapshot, workbookTemplates] = await Promise.all([
    db.collection("settings").doc("contentBuilderOptions").get(),
    db.collection("entityTypes").where("status", "==", "active").limit(200).get(),
    loadContentTemplateDefinitions(db),
  ]);
  const saved = snap.exists ? snap.data() : {};
  const workbookTypes = { item: [], blueprint: [], plan: [] };
  entityTypesSnapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    const kind = cleanString(data.entityKind).toLowerCase();
    const type = cleanString(data.type).toLowerCase();
    if (workbookTypes[kind] && type) workbookTypes[kind].push(type);
  });
  return {
    ...CONTENT_BUILDER_OPTIONS,
    ...saved,
    itemTypes: workbookTypes.item.length
      ? mergeUnique([], workbookTypes.item)
      : CONTENT_BUILDER_OPTIONS.itemTypes,
    itemKinds: mergeUnique(CONTENT_BUILDER_OPTIONS.itemKinds, saved.itemKinds),
    blueprintTypes: workbookTypes.blueprint.length
      ? mergeUnique([], workbookTypes.blueprint)
      : CONTENT_BUILDER_OPTIONS.blueprintTypes,
    planTypes: workbookTypes.plan.length
      ? mergeUnique([], workbookTypes.plan)
      : CONTENT_BUILDER_OPTIONS.planTypes,
    campaignTypes: mergeUnique(CONTENT_BUILDER_OPTIONS.campaignTypes, saved.campaignTypes),
    templateDefinitions: mergeTemplateDefinitions(
      {
        ...CONTENT_BUILDER_OPTIONS.templateDefinitions,
        item: workbookTemplates.item || [],
        blueprint: workbookTemplates.blueprint || [],
        plan: workbookTemplates.plan || [],
      },
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
  const itemKind = cleanString(doc.itemKind).toLowerCase();
  const type = cleanString(doc.type).toLowerCase();

  if (["course", "program", "workshop", "event"].includes(type)) return type;
  if (itemKind === "digital product") return "course";
  return type || "tool";
}

function canonicalProductTypeFromItem(doc) {
  const legacyType = productTypeFromItem(doc);
  if (legacyType === "course") return "Course Access";
  if (legacyType === "workshop" || legacyType === "event") return "Workshop Registration";
  if (legacyType === "program") return "Program Access";
  if (cleanString(doc.itemKind).toLowerCase() === "digital product") return "Digital Download";
  return "Physical";
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
      type: record.type || record.itemType || record.blueprintType || record.planType || record.campaignType || "",
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
    const templateFieldValues = cleanTemplateFieldValues(data.templateFieldValues);
    validateTemplateFieldValues(selectedTemplate, templateFieldValues);
    const linkedAssetSelections = recordType === "item"
      ? selectedAssetLinks(selectedTemplate, templateFieldValues)
      : [];
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
    const actor = actorOwnership(request);
    const appManagedFields = {
      managedByWorkbook: false,
      contentOrigin: "app",
      createdInApp: true,
    };

    const doc = {
      ...appManagedFields,
      name,
      title: name,
      [config.typeField]: typeValue || templateDefaults[config.typeField] || allowedTypes[0],
      template: selectedTemplate?.name || templateId,
      templateId: selectedTemplate?.id || templateId,
      status: normalizeStatus(data.status),
      visibility: cleanString(data.visibility).toLowerCase() || "private",
      shortDescription: cleanString(data.shortDescription),
      longDescription: cleanString(data.longDescription),
      notes: cleanString(data.notes),
      categoryId: cleanString(data.categoryId || templateDefaults.categoryId),
      tags: asArray(data.tags),
      owner: cleanString(data.owner) || actor.owner,
      ownerType: cleanString(data.ownerType) || actor.ownerType,
      templateFieldValues,
      approvalStatus: cleanString(data.approvalStatus) || (normalizeStatus(data.status) === "active"
        ? "approved"
        : "draft"),
      publishRequested: data.publishRequested === true,
      approvalRequestedAt: data.publishRequested === true ? now : null,
      approvalRequestedByUid: data.publishRequested === true ? request.auth.uid : null,
      approvalRequestedByEmail: data.publishRequested === true ? request.auth.token.email || "" : null,
      requestedWebsiteVisible: data.requestedWebsiteVisible === true,
      requestedProductVisible: data.requestedProductVisible === true,
      createsProduct: data.createsProduct === true || data.isShopProduct === true,
      updatedAt: now,
      createdAt: now,
      createdByUid: request.auth.uid,
      createdByEmail: request.auth.token.email || null,
    };

    if (recordType === "item") {
      Object.assign(doc, {
        itemId: id,
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
        requiresLocation: data.requiresLocation ?? templateDefaults.requiresLocation ?? false,
        requiresInstructor: data.requiresInstructor ?? templateDefaults.requiresInstructor ?? false,
        issuesCertificate: data.issuesCertificate ?? templateDefaults.issuesCertificate ?? false,
        seatCapacity: Number(data.seatCapacity || templateDefaults.seatCapacity || 0) || null,
        deliveryMode: cleanString(data.deliveryMode || templateDefaults.deliveryMode),
        eventStartAt: cleanString(data.eventStartAt),
        eventEndAt: cleanString(data.eventEndAt),
        eventLocation: cleanString(data.eventLocation),
        instructor: cleanString(data.instructor),
        certificateName: cleanString(data.certificateName),
      });
    }

    if (recordType === "blueprint") {
      Object.assign(doc, {
        blueprintId: id,
        blueprintTemplateId: templateDefaults.blueprintTemplateId || selectedTemplate?.id || null,
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
        linkedPlanIds: asArray(data.linkedPlanIds),
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
      const linkedAssets = await Promise.all(linkedAssetSelections.map(async (selection) => {
        const snapshot = await db.collection("assets").doc(selection.assetId).get();
        if (!snapshot.exists) {
          throw new HttpsError(
            "invalid-argument",
            `Selected asset ${selection.assetId} no longer exists. Refresh the Content Builder and try again.`,
          );
        }
        return { ...selection, data: snapshot.data() || {} };
      }));
      const existingProductId = cleanString(data.productRelation?.existingProductId);
      const existingProductSnapshot = existingProductId
        ? await db.collection("products").doc(existingProductId).get()
        : null;
      if (existingProductId && !existingProductSnapshot?.exists) {
        throw new HttpsError("invalid-argument", "The selected Product no longer exists. Refresh and try again.");
      }

      await admin.firestore().runTransaction(async (transaction) => {
        transaction.create(ref, doc);

        if (recordType === "item" && uploadedAssets.length) {
          uploadedAssets.forEach((asset, index) => {
            const assetId = `ASSET-${slugify(id)}-${Date.now()}-${index + 1}`;
            const itemAssetId = `ITEMASSET-${slugify(id)}-${Date.now()}-${index + 1}`;
            const assetRef = db.collection("assets").doc(assetId);
            const itemAssetRef = db.collection("itemAssets").doc(itemAssetId);
            const entityAssetId = `ENTITYASSET-ITEM-${slugify(id)}-${slugify(assetId)}`;
            const entityAssetRef = db.collection("entityAssets").doc(entityAssetId);
            const currentTitle = cleanString(asset.title) || assetTitle;
            const currentUrl = cleanString(asset.url);
            const currentType = cleanString(asset.type) || cleanString(data.assetType) || assetTypeFromUrl(currentUrl);

            transaction.create(assetRef, {
              ...appManagedFields,
              assetId,
              assetName: currentTitle,
              assetType: currentType.charAt(0).toUpperCase() + currentType.slice(1),
              name: currentTitle,
              type: currentType,
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

            transaction.create(entityAssetRef, {
              ...appManagedFields,
              entityAssetId,
              assetId,
              entityType: "Item",
              entityId: id,
              assetRole: cleanString(asset.purpose) || assetPurpose,
              fieldKey: "",
              productVariantId: "",
              isPrimary: index === 0,
              sortOrder: index + 1,
              displayStatus: "active",
              visibility: doc.visibility,
              status: "active",
              createdAt: now,
              updatedAt: now,
            });

            transaction.create(itemAssetRef, {
              ...appManagedFields,
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

        if (recordType === "item" && linkedAssets.length) {
          linkedAssets.forEach((asset, index) => {
            const itemAssetId = [
              "ITEMASSET",
              slugify(id),
              slugify(asset.fieldKey),
              slugify(asset.assetId),
            ].join("-");
            const itemAssetRef = db.collection("itemAssets").doc(itemAssetId);
            const entityAssetId = `ENTITYASSET-ITEM-${slugify(id)}-${slugify(asset.assetId)}`;
            transaction.create(itemAssetRef, {
              ...appManagedFields,
              itemAssetId,
              itemId: id,
              assetId: asset.assetId,
              purpose: asset.fieldName,
              sortOrder: uploadedAssets.length + index + 1,
              displayStatus: "active",
              contextTitle: cleanString(asset.data.title || asset.data.name) || asset.assetId,
              contextAltText: cleanString(asset.data.altText),
              notes: "Linked from a template field in Content Builder.",
              createdAt: now,
              updatedAt: now,
            });
            transaction.create(db.collection("entityAssets").doc(entityAssetId), {
              ...appManagedFields,
              entityAssetId,
              assetId: asset.assetId,
              entityType: "Item",
              entityId: id,
              assetRole: asset.fieldName,
              fieldKey: asset.fieldKey,
              productVariantId: "",
              isPrimary: uploadedAssets.length === 0 && index === 0,
              sortOrder: uploadedAssets.length + index + 1,
              displayStatus: "active",
              visibility: doc.visibility,
              status: "active",
              createdAt: now,
              updatedAt: now,
            });
          });
        }

        if (doc.createsProduct === true) {
          const productId = cleanString(data.productId) || `PROD-${slugify(id).replace(/^ITEM-/, "")}`;
          const productRef = db.collection("products").doc(productId);
          const linkedEntityType = recordType.charAt(0).toUpperCase() + recordType.slice(1);
          const productLinkId = `PRODUCTLINK-${slugify(productId)}-${linkedEntityType.toUpperCase()}-${slugify(id)}`;
          const priceId = `PRICE-${slugify(productId)}-BASE`;
          const priceRef = db.collection("productPrices").doc(priceId);
          const retailPrice = asNumber(data.price) ?? 0;
          const salePrice = asNumber(data.salePrice);
          const effectivePrice = salePrice ?? retailPrice;
          const variants = (Array.isArray(data.variants) ? data.variants : [])
            .map(normalizeVariant)
            .filter(Boolean);
          const selectedAssetMedia = linkedAssets.map((asset) => ({
            type: cleanString(asset.data.type || asset.data.assetType) ||
              assetTypeFromUrl(asset.data.fileUrl || asset.data.url),
            url: cleanString(asset.data.fileUrl || asset.data.url),
            title: cleanString(asset.data.title || asset.data.name) || asset.assetId,
            altText: cleanString(asset.data.altText),
          }));
          const uploadedAssetMedia = uploadedAssets.map((asset) => ({
            type: cleanString(asset.type) || assetTypeFromUrl(asset.url),
            url: cleanString(asset.url),
            title: cleanString(asset.title) || assetTitle,
            altText: cleanString(asset.altText || data.assetAltText),
          }));
          const allAssetMedia = [...selectedAssetMedia, ...uploadedAssetMedia]
            .filter((asset) => asset.url);
          const images = allAssetMedia
            .filter((asset) => asset.type === "image")
            .map((asset) => asset.url);
          const media = allAssetMedia.map((asset, index) => ({
            ...asset,
            sortOrder: index + 1,
            displayStatus: "active",
          }));

          if (existingProductSnapshot?.exists) {
            transaction.set(db.collection("productLinks").doc(productLinkId), {
              ...appManagedFields,
              productLinkId,
              productId,
              linkedEntityType,
              linkedEntityId: id,
              linkRole: cleanString(data.productRelation?.linkRole) || "Represents",
              quantity: 1,
              isPrimary: true,
              sortOrder: 1,
              required: true,
              variantSpecific: false,
              productVariantId: "",
              status: "active",
              createdAt: now,
              updatedAt: now,
            }, { merge: true });
            if (recordType === "plan" &&
                ["Unlocks", "Delivers", "Represents"].includes(data.productRelation?.linkRole)) {
              const grantId = `ACCESSGRANT-${slugify(productId)}-${slugify(id)}`;
              transaction.set(db.collection("productAccessGrants").doc(grantId), {
                ...appManagedFields,
                productAccessGrantId: grantId,
                productId,
                productVariantId: "",
                accessEntityType: "Plan",
                accessEntityId: id,
                grantTiming: "on-payment-confirmed",
                durationType: "permanent",
                durationValue: null,
                revocable: true,
                status: "active",
                createdAt: now,
                updatedAt: now,
              }, { merge: true });
            }
            return;
          }

          transaction.create(productRef, {
            ...appManagedFields,
            productId,
            productName: name,
            productType: recordType === "plan"
              ? (doc.type === "course" ? "Course Access" : "Plan Access")
              : recordType === "blueprint" ? "Digital Download" : canonicalProductTypeFromItem(doc),
            productCategoryId: doc.categoryId,
            itemId: recordType === "item" ? id : "",
            name,
            title: name,
            type: productTypeFromItem(doc),
            itemType: cleanString(doc.type),
            itemKind: cleanString(doc.itemKind),
            categoryId: cleanString(doc.categoryId),
            templateId: cleanString(doc.templateId),
            templateFieldValues: doc.templateFieldValues || {},
            tagIds: doc.tagIds || [],
            tags: doc.tags || [],
            shopStatus: normalizeStatus(data.shopStatus || (doc.visible ? "active" : "draft")),
            visible: data.shopVisible === true || doc.visible === true,
            websiteVisible: doc.websiteVisible === true,
            archived: false,
            featured: data.featured === true,
            requiresShipping: recordType === "item" && doc.requiresShipping === true,
            inventoryTracked: recordType === "item" && doc.inventoryTracked === true,
            sku: cleanString(data.sku),
            shortDescription: doc.shortDescription,
            longDescription: doc.longDescription,
            supplierType: cleanString(data.supplierType || templateDefaults.supplierType),
            unlocksAccess: doc.unlocksAccess === true,
            accessType: cleanString(doc.accessType),
            deliveryMode: cleanString(doc.deliveryMode),
            requiresCalendar: doc.requiresCalendar === true,
            requiresSessionTime: doc.requiresSessionTime === true,
            tracksSeats: doc.tracksSeats === true,
            seatCapacity: doc.seatCapacity ?? null,
            eventStartAt: cleanString(doc.eventStartAt),
            eventEndAt: cleanString(doc.eventEndAt),
            eventLocation: cleanString(doc.eventLocation),
            instructor: cleanString(doc.instructor),
            issuesCertificate: doc.issuesCertificate === true,
            certificateName: cleanString(doc.certificateName),
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
          });

          transaction.create(db.collection("productLinks").doc(productLinkId), {
            ...appManagedFields,
            productLinkId,
            productId,
            linkedEntityType,
            linkedEntityId: id,
            linkRole: cleanString(data.productRelation?.linkRole) || "Represents",
            quantity: 1,
            isPrimary: true,
            sortOrder: 1,
            required: true,
            variantSpecific: false,
            productVariantId: "",
            status: "active",
            createdAt: now,
            updatedAt: now,
          });

          transaction.create(priceRef, {
            ...appManagedFields,
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
            const canonicalVariantRef = db.collection("productVariants").doc(variantId);
            transaction.create(variantRef, {
              ...appManagedFields,
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
            transaction.create(canonicalVariantRef, {
              ...appManagedFields,
              productVariantId: variantId,
              productId,
              variantName: variant.name || `Variant ${index + 1}`,
              variantCode: variantId,
              sku: variant.sku,
              status: "active",
              isDefault: index === 0,
              optionSummary: [variant.colour, variant.size].filter(Boolean).join(" / "),
              priceOverride: variant.priceOverride,
              currency: "AUD",
              requiresShippingOverride: recordType === "item" && doc.requiresShipping === true,
              inventoryTracked: recordType === "item" && doc.inventoryTracked === true,
              stockQuantity: variant.stockQty,
              stockStatus: variant.stockQty > 0 ? "in-stock" : "out-of-stock",
              sortOrder: index + 1,
              createdAt: now,
              updatedAt: now,
            });

            if (variant.priceOverride !== null) {
              const variantPriceRef = db.collection("productPrices").doc(`PRICE-${slugify(productId)}-${index + 1}`);
              transaction.create(variantPriceRef, {
                ...appManagedFields,
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
              transaction.create(inventoryRef, {
                ...appManagedFields,
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
            transaction.create(inventoryRef, {
              ...appManagedFields,
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

          const accessTargets = [
            recordType === "plan" ? ["Plan", id] : null,
            ["Plan", cleanString(data.relatedPlanId || templateDefaults.relatedPlanId)],
            ["Plan", cleanString(data.relatedCourseId || templateDefaults.relatedCourseId)],
            ["Plan", cleanString(data.relatedWorkshopId || templateDefaults.relatedWorkshopId)],
          ].filter((target) => target?.[1]);
          const seenAccessTargets = new Set();
          accessTargets.forEach(([accessEntityType, accessEntityId]) => {
            if (seenAccessTargets.has(accessEntityId)) return;
            seenAccessTargets.add(accessEntityId);
            const grantId = `ACCESSGRANT-${slugify(productId)}-${slugify(accessEntityId)}`;
            transaction.create(db.collection("productAccessGrants").doc(grantId), {
              ...appManagedFields,
              productAccessGrantId: grantId,
              productId,
              productVariantId: "",
              accessEntityType,
              accessEntityId,
              grantTiming: "on-payment-confirmed",
              durationType: "permanent",
              durationValue: null,
              revocable: true,
              status: "active",
              createdAt: now,
              updatedAt: now,
            });
          });
        }
      });
      return { success: true, id, recordType, similar };
    } catch (err) {
      console.error("Create content builder record error:", err);
      if (err?.code === 6 || err?.code === "already-exists") {
        throw new HttpsError(
          "already-exists",
          "That ID is already in use. Existing app and workbook content was preserved; choose a new ID.",
        );
      }
      throw new HttpsError("internal", err.message);
    }
  },
);
