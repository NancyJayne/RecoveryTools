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
  if (value === null || value === undefined || value === "") return null;
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
    references: [...new Set(asArray(variant?.references))],
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
    priceOverride: (asNumber(value.priceOverride) ?? 0) > 0 ? asNumber(value.priceOverride) : null,
    stockQty: asNumber(value.stockQty ?? value.stock) ?? 0,
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
    const entityVariants = cleanEntityVariants(data.entityVariants);
    validateTemplateFieldValues(selectedTemplate, templateFieldValues);
    entityVariants.forEach((variant) => {
      const variantTemplate = templateFor(options, recordType, variant.templateVariantId, typeValue);
      if (!variantTemplate) {
        throw new HttpsError("invalid-argument", `Choose a valid template for ${variant.name}.`);
      }
      validateTemplateFieldValues(variantTemplate, variant.templateFieldValues);
    });
    const linkedAssetSelections = ["item", "blueprint", "plan"].includes(recordType)
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
    const variantAuditTime = new Date().toISOString();
    const auditedEntityVariants = entityVariants.map((variant) => ({
      ...variant,
      owner: variant.owner || actor.owner,
      ownerType: variant.ownerType || actor.ownerType,
      createdByUid: request.auth.uid,
      createdByEmail: request.auth.token.email || "",
      createdAt: variantAuditTime,
      approvalStatus: variant.status === "review"
        ? "awaiting-approval"
        : variant.status === "active" ? "approved" : "draft",
      approvedByUid: variant.status === "active" ? request.auth.uid : "",
      approvedByEmail: variant.status === "active" ? request.auth.token.email || "" : "",
      approvedAt: variant.status === "active" ? variantAuditTime : "",
    }));
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
      tags: asArray(data.tags),
      owner: cleanString(data.owner) || actor.owner,
      ownerType: cleanString(data.ownerType) || actor.ownerType,
      templateFieldValues,
      entityVariants: auditedEntityVariants,
      scheduledActiveAt: cleanString(data.scheduledActiveAt),
      scheduledPauseAt: cleanString(data.scheduledPauseAt),
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
      websiteVisible: data.websiteVisible === true,
      visible: data.websiteVisible === true,
      updatedAt: now,
      createdAt: now,
      createdByUid: request.auth.uid,
      createdByEmail: request.auth.token.email || null,
    };

    if (recordType === "item") {
      Object.assign(doc, {
        itemId: id,
        itemKind: cleanString(data.itemKind || templateDefaults.itemKind),
        isShopProduct: data.isShopProduct ?? templateDefaults.isShopProduct ?? false,
        soldByRecoveryTools: data.soldByRecoveryTools ?? templateDefaults.soldByRecoveryTools ?? true,
        requiresShipping: data.requiresShipping ?? templateDefaults.requiresShipping ?? false,
        inventoryTracked: data.inventoryTracked ?? templateDefaults.inventoryTracked ?? false,
        stockQty: asNumber(data.stockQty) ?? 0,
        reorderLevel: asNumber(data.reorderLevel),
        inventoryUnit: cleanString(data.inventoryUnit),
        inventoryLocation: cleanString(data.inventoryLocation),
        unitCost: asNumber(data.unitCost),
        supplierId: cleanString(data.supplierId),
        costReference: cleanString(data.costReference),
        purchaseUrl: cleanString(data.purchaseUrl),
        stockStatus: templateDefaults.stockStatus || "not-tracked",
        unlocksAccess: data.unlocksAccess ?? templateDefaults.unlocksAccess ?? false,
        accessType: cleanString(data.accessType),
        requiresCalendar: data.requiresCalendar ?? templateDefaults.requiresCalendar ?? false,
        requiresSessionTime: data.requiresSessionTime ?? templateDefaults.requiresSessionTime ?? false,
        tracksSeats: data.tracksSeats ?? templateDefaults.tracksSeats ?? false,
        requiresLocation: data.requiresLocation ?? templateDefaults.requiresLocation ?? false,
        requiresInstructor: data.requiresInstructor ?? templateDefaults.requiresInstructor ?? false,
        issuesCertificate: data.issuesCertificate ?? templateDefaults.issuesCertificate ?? false,
        seatCapacity: Number(data.seatCapacity || 0) || null,
        deliveryMode: cleanString(data.deliveryMode),
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
        linkedItemComponents: cleanItemComponents(data.linkedItemComponents),
        estimatedUnitCost: asNumber(data.estimatedUnitCost) ?? 0,
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

        if (["item", "blueprint", "plan"].includes(recordType) && linkedAssets.length) {
          const entityType = recordType.charAt(0).toUpperCase() + recordType.slice(1);
          linkedAssets.forEach((asset, index) => {
            const entityAssetId = `ENTITYASSET-${entityType.toUpperCase()}-${slugify(id)}-${slugify(asset.assetId)}`;
            if (recordType === "item") {
              const itemAssetId = [
                "ITEMASSET", slugify(id), slugify(asset.fieldKey), slugify(asset.assetId),
              ].join("-");
              transaction.create(db.collection("itemAssets").doc(itemAssetId), {
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
            }
            transaction.create(db.collection("entityAssets").doc(entityAssetId), {
              ...appManagedFields,
              entityAssetId,
              assetId: asset.assetId,
              entityType,
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

        if (recordType === "item" && doc.inventoryTracked === true && doc.createsProduct !== true) {
          const inventoryRef = db.collection("inventory").doc(`INV-${slugify(id)}`);
          transaction.create(inventoryRef, {
            ...appManagedFields,
            inventoryId: inventoryRef.id,
            name,
            itemId: id,
            productId: "",
            variantId: "",
            stockQty: asNumber(data.stockQty) ?? 0,
            reorderLevel: asNumber(data.reorderLevel),
            unit: cleanString(data.inventoryUnit),
            location: cleanString(data.inventoryLocation),
            unitCost: asNumber(data.unitCost),
            supplierId: cleanString(data.supplierId),
            costReference: cleanString(data.costReference),
            purchaseUrl: cleanString(data.purchaseUrl),
            status: "active",
            updatedAt: now,
            createdAt: now,
          });
        }

        if (doc.createsProduct === true) {
          const productId = cleanString(data.productId) || `PROD-${slugify(id).replace(/^ITEM-/, "")}`;
          const productRef = db.collection("products").doc(productId);
          const linkedEntityType = recordType.charAt(0).toUpperCase() + recordType.slice(1);
          const productLinkId = `PRODUCTLINK-${slugify(productId)}-${linkedEntityType.toUpperCase()}-${slugify(id)}`;
          const linkRole = cleanString(data.productRelation?.linkRole) || "Represents";
          const isManufacturingLink = recordType === "blueprint" && linkRole === "ManufacturedFrom";
          const manufacturingBlueprintId = isManufacturingLink
            ? id
            : cleanString(data.productRelation?.manufacturingBlueprintId);
          const blueprintLinkId = manufacturingBlueprintId
            ? `PRODUCTLINK-${slugify(productId)}-BLUEPRINT-${slugify(manufacturingBlueprintId)}`
            : "";
          const priceId = `PRICE-${slugify(productId)}-BASE`;
          const priceRef = db.collection("productPrices").doc(priceId);
          const retailPrice = asNumber(data.price) ?? 0;
          const salePrice = asNumber(data.salePrice);
          const effectivePrice = salePrice ?? retailPrice;
          const variants = (Array.isArray(data.variants) ? data.variants : [])
            .map(normalizeVariant)
            .filter(Boolean);
          const accessTargets = cleanAccessGrants(data.productRelation?.accessGrants);
          const variantContentLinks = cleanVariantContentLinks(data.productRelation?.variantContentLinks);
          variantContentLinks.filter((link) => link.linkRole === "Unlocks").forEach((link) => {
            accessTargets.push({
              accessEntityType: link.entityType,
              accessEntityId: link.entityId,
              accessEntityVariantId: link.entityVariantId,
              productVariantId: link.productVariantId,
            });
          });
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
            if (!cleanString(existingProductSnapshot.data()?.sku)) {
              transaction.set(productRef, {
                sku: cleanString(data.sku) || generatedProductSku(productId),
                updatedAt: now,
              }, { merge: true });
            }
            transaction.set(productRef, {
              manufacturingBlueprintId,
              estimatedUnitCost: asNumber(data.productRelation?.estimatedUnitCost) ?? 0,
              variantContentLinks,
              updatedAt: now,
            }, { merge: true });
            transaction.set(db.collection("productLinks").doc(productLinkId), {
              ...appManagedFields,
              productLinkId,
              productId,
              linkedEntityType,
              linkedEntityId: id,
              linkRole,
              quantity: 1,
              isPrimary: !isManufacturingLink,
              sortOrder: isManufacturingLink ? 2 : 1,
              required: true,
              variantSpecific: false,
              productVariantId: "",
              status: "active",
              createdAt: now,
              updatedAt: now,
            }, { merge: true });
            if (isManufacturingLink) {
              transaction.set(db.collection("productLinks").doc(blueprintLinkId), {
                ...appManagedFields,
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
                createdAt: now,
                updatedAt: now,
              }, { merge: true });
            }
            accessTargets.forEach((grant) => {
              const { accessEntityType, accessEntityId, accessEntityVariantId, productVariantId } = grant;
              const grantId = [
                "ACCESSGRANT", slugify(productId), slugify(productVariantId || "ALL"),
                slugify(accessEntityType), slugify(accessEntityId), slugify(accessEntityVariantId || "ALL"),
              ].join("-");
              transaction.set(db.collection("productAccessGrants").doc(grantId), {
                ...appManagedFields,
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
                createdAt: now,
                updatedAt: now,
              }, { merge: true });
            });
            variantContentLinks.forEach((link) => {
              const linkId = `PRODUCTVARIANTLINK-${slugify(productId)}-${slugify(link.productVariantId)}-` +
                `${slugify(link.entityType)}-${slugify(link.entityId)}-${slugify(link.entityVariantId || "ALL")}`;
              transaction.set(db.collection("productVariantContentLinks").doc(linkId), {
                productVariantContentLinkId: linkId,
                productId,
                ...link,
                contentOrigin: "app",
                managedByWorkbook: false,
                createdAt: now,
                updatedAt: now,
              }, { merge: true });
            });
            return;
          }

          if (isManufacturingLink) {
            throw new HttpsError(
              "failed-precondition",
              "Choose an existing Product for a manufacturing/cost Blueprint.",
            );
          }

          transaction.create(productRef, {
            ...appManagedFields,
            productId,
            productName: name,
            productType: cleanString(data.productRelation?.productType) || (recordType === "plan"
              ? (doc.type === "course" ? "Course Access" : "Plan Access")
              : recordType === "blueprint" ? "Digital Download" : canonicalProductTypeFromItem(doc)),
            productCategoryId: cleanString(data.productRelation?.productCategoryId),
            itemId: recordType === "item" ? id : "",
            name,
            title: name,
            type: cleanString(data.productRelation?.productType) || productTypeFromItem(doc),
            itemType: cleanString(doc.type),
            itemKind: cleanString(doc.itemKind),
            categoryId: cleanString(data.productRelation?.productCategoryId),
            templateId: cleanString(doc.templateId),
            templateFieldValues: doc.templateFieldValues || {},
            tagIds: doc.tagIds || [],
            tags: doc.tags || [],
            shopStatus: normalizeStatus(data.shopStatus || (doc.visible ? "active" : "draft")),
            visible: data.shopVisible === true || doc.visible === true,
            websiteVisible: doc.websiteVisible === true,
            archived: false,
            featured: data.featured === true,
            requiresShipping: data.productRelation?.requiresShipping === true,
            physicalFulfilment: cleanString(
              data.productRelation?.physicalFulfilment || (data.productRelation?.requiresShipping ? "shipping" : "none"),
            ).toLowerCase(),
            inventoryTracked: data.productRelation?.inventoryTracked === true,
            manufacturingBlueprintId,
            estimatedUnitCost: asNumber(data.productRelation?.estimatedUnitCost) ?? 0,
            variantContentLinks,
            sku: cleanString(data.sku) || generatedProductSku(productId),
            shortDescription: doc.shortDescription,
            longDescription: doc.longDescription,
            supplierType: cleanString(data.supplierType || templateDefaults.supplierType),
            unlocksAccess: doc.unlocksAccess === true,
            accessType: cleanString(doc.accessType),
            deliveryMode: cleanString(doc.deliveryMode),
            requiresCalendar: data.productRelation?.requiresCalendar === true,
            requiresSessionTime: data.productRelation?.requiresSessionTime === true,
            tracksSeats: data.productRelation?.tracksSeats === true,
            requiresLocation: data.productRelation?.requiresLocation === true,
            requiresInstructor: data.productRelation?.requiresInstructor === true,
            seatCapacity: doc.seatCapacity ?? null,
            eventStartAt: cleanString(doc.eventStartAt),
            eventEndAt: cleanString(doc.eventEndAt),
            eventLocation: cleanString(doc.eventLocation),
            instructor: cleanString(data.productRelation?.instructor || doc.instructor),
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
            stock: data.productRelation?.inventoryTracked === true
              ? (asNumber(data.productRelation?.stock) ?? variants.reduce((sum, variant) => sum + variant.stockQty, 0))
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
          if (isManufacturingLink) {
            transaction.create(db.collection("productLinks").doc(blueprintLinkId), {
              ...appManagedFields,
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
              createdAt: now,
              updatedAt: now,
            });
          }

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
              status: variant.status || "active",
              contentVariantId: variant.contentVariantId,
              deliveryMode: variant.deliveryMode,
              physicalFulfilment: variant.physicalFulfilment,
              stock: variant.stockQty,
              calendarBookingReference: variant.calendarBookingReference,
              seatCapacity: variant.seatCapacity,
              eventStartAt: variant.eventStartAt,
              eventEndAt: variant.eventEndAt,
              eventLocation: variant.eventLocation,
              instructor: variant.instructor,
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
              status: variant.status || "active",
              contentVariantId: variant.contentVariantId,
              isDefault: index === 0,
              optionSummary: [variant.colour, variant.size].filter(Boolean).join(" / "),
              priceOverride: variant.priceOverride,
              currency: "AUD",
              requiresShippingOverride: ["shipping", "shipping-or-pickup"].includes(variant.physicalFulfilment),
              inventoryTracked: data.productRelation?.inventoryTracked === true,
              deliveryMode: variant.deliveryMode,
              physicalFulfilment: variant.physicalFulfilment,
              stockQuantity: variant.stockQty,
              stockStatus: variant.stockQty > 0 ? "in-stock" : "out-of-stock",
              calendarBookingReference: variant.calendarBookingReference,
              seatCapacity: variant.seatCapacity,
              eventStartAt: variant.eventStartAt,
              eventEndAt: variant.eventEndAt,
              eventLocation: variant.eventLocation,
              instructor: variant.instructor,
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

          accessTargets.forEach((grant) => {
            const { accessEntityType, accessEntityId, accessEntityVariantId, productVariantId } = grant;
            const grantId = `ACCESSGRANT-${slugify(productId)}-${slugify(productVariantId || "ALL")}-` +
              `${slugify(accessEntityType)}-${slugify(accessEntityId)}-${slugify(accessEntityVariantId || "ALL")}`;
            transaction.create(db.collection("productAccessGrants").doc(grantId), {
              ...appManagedFields,
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
              createdAt: now,
              updatedAt: now,
            });
          });
          variantContentLinks.forEach((link) => {
            const linkId = `PRODUCTVARIANTLINK-${slugify(productId)}-${slugify(link.productVariantId)}-` +
              `${slugify(link.entityType)}-${slugify(link.entityId)}-${slugify(link.entityVariantId || "ALL")}`;
            transaction.set(db.collection("productVariantContentLinks").doc(linkId), {
              ...appManagedFields,
              productVariantContentLinkId: linkId,
              productId,
              ...link,
              createdAt: now,
              updatedAt: now,
            }, { merge: true });
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
