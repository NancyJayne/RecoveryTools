import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { CONTENT_BUILDER_OPTIONS } from "./contentBuilderOptions.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const RECORD_TYPES = ["item", "blueprint", "plan", "campaign"];

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

function allowedTypesFor(recordType) {
  return {
    item: CONTENT_BUILDER_OPTIONS.itemTypes,
    blueprint: CONTENT_BUILDER_OPTIONS.blueprintTypes,
    plan: CONTENT_BUILDER_OPTIONS.planTypes,
    campaign: CONTENT_BUILDER_OPTIONS.campaignTypes,
  }[recordType] || [];
}

function cleanFieldKey(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function canonicalFieldType(value) {
  const fieldType = cleanString(value).toLowerCase().replace(/[_-]+/g, " ");
  const aliases = {
    text: "Short Text",
    "short text": "Short Text",
    textarea: "Long Text",
    "long text": "Long Text",
    number: "Number",
    numeric: "Number",
    checkbox: "Boolean",
    boolean: "Boolean",
    date: "Date",
    "linked item list": "Linked Item List",
    "linked blueprint list": "Linked Blueprint List",
    "linked plan list": "Linked Plan List",
    "linked product list": "Linked Product List",
    asset: "Asset",
    "image asset": "Image Asset",
    "video asset": "Video Asset",
    "pdf asset": "PDF Asset",
    "canva design asset": "Canva Design Asset",
  };
  return aliases[fieldType] || "";
}

function entryLimit(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function cleanTemplateFields(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 50) {
    throw new HttpsError("invalid-argument", "A template can have up to 50 extra fields.");
  }

  const keys = new Set();
  const sortOrders = new Set();
  return value.map((field, index) => {
    const name = cleanString(field?.name).slice(0, 120);
    const key = cleanFieldKey(field?.key || field?.id || name);
    const fieldType = canonicalFieldType(field?.fieldType);
    const linkedTable = cleanString(field?.linkedTable).slice(0, 80);
    const minEntries = entryLimit(field?.minEntries);
    const allowUnlimited = field?.allowUnlimited === true;
    const maxEntries = allowUnlimited ? null : entryLimit(field?.maxEntries);
    const sortOrder = Number(field?.sortOrder ?? index + 1);
    if (!name || !key) {
      throw new HttpsError("invalid-argument", "Every template field needs a name and field key.");
    }
    if (keys.has(key)) {
      throw new HttpsError("invalid-argument", `Template field key "${key}" is duplicated.`);
    }
    if (!fieldType) {
      throw new HttpsError("invalid-argument", `Select a valid input type for "${name}".`);
    }
    if ((fieldType.startsWith("Linked ") || fieldType.endsWith(" Asset") || fieldType === "Asset") && !linkedTable) {
      throw new HttpsError("invalid-argument", `Choose a LinkedTable for "${name}".`);
    }
    if (
      field?.minEntries !== null &&
      field?.minEntries !== undefined &&
      field?.minEntries !== "" &&
      minEntries === null
    ) {
      throw new HttpsError(
        "invalid-argument",
        `MinEntries for "${name}" must be zero or a positive whole number.`,
      );
    }
    if (
      !allowUnlimited &&
      field?.maxEntries !== null &&
      field?.maxEntries !== undefined &&
      field?.maxEntries !== "" &&
      maxEntries === null
    ) {
      throw new HttpsError(
        "invalid-argument",
        `MaxEntries for "${name}" must be zero or a positive whole number.`,
      );
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 1 || sortOrders.has(sortOrder)) {
      throw new HttpsError(
        "invalid-argument",
        `SortOrder for "${name}" must be a unique positive whole number.`,
      );
    }
    if (minEntries !== null && maxEntries !== null && maxEntries < minEntries) {
      throw new HttpsError(
        "invalid-argument",
        `MaxEntries cannot be less than MinEntries for "${name}".`,
      );
    }
    keys.add(key);
    sortOrders.add(sortOrder);
    return {
      id: slugify(field?.id) || `FIELD-${slugify(name)}`,
      key,
      name,
      fieldType,
      linkedTable,
      required: field?.required === true,
      repeatable: field?.repeatable === true,
      minEntries,
      maxEntries,
      allowUnlimited,
      sortOrder,
      notes: cleanString(field?.notes).slice(0, 500),
    };
  });
}

function cleanDefaults(defaults = {}) {
  if (!defaults || typeof defaults !== "object") return {};

  const output = {};
  Object.entries(defaults).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    output[key] = key === "fields" ? cleanTemplateFields(value) : value;
  });
  return output;
}

function cleanTemplateVariants(value, templateId, parentDefaults) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpsError("invalid-argument", "Every template needs at least one variant.");
  }
  if (value.length > 20) {
    throw new HttpsError("invalid-argument", "A template can have up to 20 variants.");
  }

  const ids = new Set();
  const sortOrders = new Set();
  let defaultCount = 0;
  const variants = value.map((variant, index) => {
    const name = cleanString(variant?.name).slice(0, 120);
    const id = slugify(variant?.id) || `${templateId}-VARIANT-${slugify(name || `VARIANT-${index + 1}`)}`;
    const sortOrder = Number(variant?.sortOrder ?? index + 1);
    if (!name) {
      throw new HttpsError("invalid-argument", "Every template variant needs a name.");
    }
    if (ids.has(id)) {
      throw new HttpsError("invalid-argument", `Template variant ID "${id}" is duplicated.`);
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 1 || sortOrders.has(sortOrder)) {
      throw new HttpsError(
        "invalid-argument",
        `SortOrder for variant "${name}" must be a unique positive whole number.`,
      );
    }
    const active = variant?.active !== false;
    const isDefault = active && variant?.isDefault === true;
    if (isDefault) defaultCount += 1;
    ids.add(id);
    sortOrders.add(sortOrder);
    return {
      id,
      name,
      description: cleanString(variant?.description).slice(0, 2000),
      active,
      isDefault,
      sortOrder,
      defaults: {
        ...parentDefaults,
        ...cleanDefaults(variant?.defaults),
      },
    };
  });

  if (defaultCount > 1) {
    throw new HttpsError("invalid-argument", "Choose only one default variant per template.");
  }
  if (defaultCount === 0) {
    const firstActive = variants.find((variant) => variant.active) || variants[0];
    firstActive.isDefault = true;
  }
  return variants;
}

export const upsertContentBuilderTemplate = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can update content templates.");
    }

    const data = request.data || {};
    const recordType = cleanString(data.recordType).toLowerCase();
    const name = cleanString(data.name);
    const appliesTo = cleanString(data.appliesTo);

    if (!RECORD_TYPES.includes(recordType)) {
      throw new HttpsError("invalid-argument", "Select a valid template area.");
    }
    if (!name) {
      throw new HttpsError("invalid-argument", "Template name is required.");
    }
    if (!allowedTypesFor(recordType).includes(appliesTo)) {
      throw new HttpsError("invalid-argument", "Select a valid type for this template.");
    }

    const id = slugify(data.id) || `${recordType.toUpperCase()}-TEMPLATE-${slugify(name)}`;
    const active = data.active !== false;
    const defaults = cleanDefaults(data.defaults);
    delete defaults.fields;
    const variants = cleanTemplateVariants(data.variants, id, defaults);
    const template = {
      id,
      name,
      description: cleanString(data.description).slice(0, 2000),
      recordType,
      appliesTo,
      isDefault: active && data.isDefault === true,
      active,
      defaults,
      variants,
      updatedAt: new Date().toISOString(),
      updatedByUid: request.auth.uid,
      updatedByEmail: request.auth.token.email || null,
    };

    const ref = admin.firestore().collection("settings").doc("contentBuilderOptions");
    await admin.firestore().runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const current = snap.exists ? snap.data() : {};
      const templateDefinitions = current.templateDefinitions || {};
      const existing = Array.isArray(templateDefinitions[recordType])
        ? templateDefinitions[recordType]
        : [];
      const withoutCurrent = existing.filter((item) =>
        item?.templateId !== id && item?.id !== id,
      );
      const definitions = variants.map((variant) => ({
        id: variant.id,
        templateId: id,
        variantId: variant.id,
        templateName: name,
        templateDescription: template.description,
        templateActive: template.active,
        templateIsDefault: template.isDefault,
        name: variant.name,
        variantDescription: variant.description,
        variantActive: variant.active,
        variantIsDefault: variant.isDefault,
        description: variant.description || template.description,
        recordType,
        appliesTo,
        active: active && variant.active,
        isDefault: template.isDefault && variant.isDefault,
        sortOrder: variant.sortOrder,
        source: "app",
        defaults: {
          ...variant.defaults,
          templateId: id,
          templateVariantId: variant.id,
          type: appliesTo,
        },
      }));

      transaction.set(ref, {
        ...current,
        templateDefinitions: {
          ...templateDefinitions,
          [recordType]: [...withoutCurrent, ...definitions],
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    const definitions = variants.map((variant) => ({
      id: variant.id,
      templateId: id,
      variantId: variant.id,
      templateName: name,
      templateDescription: template.description,
      templateActive: template.active,
      templateIsDefault: template.isDefault,
      name: variant.name,
      variantDescription: variant.description,
      variantActive: variant.active,
      variantIsDefault: variant.isDefault,
      description: variant.description || template.description,
      recordType,
      appliesTo,
      active: active && variant.active,
      isDefault: template.isDefault && variant.isDefault,
      sortOrder: variant.sortOrder,
      source: "app",
      defaults: {
        ...variant.defaults,
        templateId: id,
        templateVariantId: variant.id,
        type: appliesTo,
      },
    }));
    return { success: true, template, definitions };
  },
);
