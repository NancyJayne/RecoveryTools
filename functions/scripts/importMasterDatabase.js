import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";
import {
  CANONICAL_WORKBOOK_SCHEMAS,
  validateCanonicalRecord,
} from "../utils/commerceAssetSchemas.js";

const COLLECTIONS = [
  "categories",
  "tags",
  "entityTypes",
  "items",
  "blueprints",
  "blueprintItems",
  "blueprintMethods",
  "blueprintDosage",
  "plans",
  "planItems",
  "planDosage",
  "planLinks",
  "itemTemplates",
  "itemTemplateVariants",
  "blueprintTemplates",
  "blueprintTemplateVariants",
  "blueprintTemplateFields",
  "planTemplates",
  "planTemplateVariants",
  "planTemplateSlots",
  "contentTemplates",
  "contentTemplateVariants",
  "contentTemplateFields",
  "products",
  "productLinks",
  "productOptions",
  "productOptionValues",
  "productVariants",
  "productVariantValues",
  "productComponents",
  "productAccessGrants",
  "productPrices",
  "itemVariants",
  "assets",
  "entityAssets",
  "assetRenditions",
  "itemAssets",
  "inventory",
  "instructors",
  "users",
  "orders",
  "orderItems",
  "customerAddresses",
  "shipments",
  "stripeEvents",
  "userAccess",
];

const COLLECTION_SHEETS = {
  categories: "Category",
  tags: "Tags",
  entityTypes: "Entity Types",
  items: "Items",
  blueprints: "Blueprints",
  blueprintItems: "Blueprint Items",
  blueprintMethods: "Blueprint Methods",
  blueprintDosage: "Blueprint Dosage",
  plans: "Plan",
  planItems: "Plan Items",
  planDosage: "Plan Dosage",
  planLinks: "Plan Links",
  itemTemplates: "Item Templates",
  itemTemplateVariants: "ItemTemplateVariants",
  blueprintTemplates: "Blueprint Templates",
  blueprintTemplateVariants: "BlueprintTemplateVariants",
  blueprintTemplateFields: "BlueprintTemplateFields",
  planTemplates: "Plan Templates",
  planTemplateVariants: "PlanTemplateVariants",
  planTemplateSlots: "PlanTemplateSlots",
  contentTemplates: "Templates",
  contentTemplateVariants: "TemplateVariants",
  contentTemplateFields: "TemplateFields",
  products: "ItemProduct",
  productLinks: "ProductConnections",
  productOptions: "ProductOptions",
  productOptionValues: "ProductOptionValues",
  productVariants: "ProductVariants",
  productVariantValues: "ProductVariantValues",
  productComponents: "ProductComponents",
  productAccessGrants: "ProductConnections",
  productPrices: "ProductPrice",
  itemVariants: "ItemVariants",
  assets: "Asset",
  entityAssets: "EntityAssets",
  assetRenditions: "AssetRenditions",
  itemAssets: "ItemAsset",
  inventory: "Inventory",
  instructors: "Instructors",
  users: "Users",
  orders: "Orders",
  orderItems: "OrderItem",
  customerAddresses: "CustomerAddresses",
  shipments: "Shipments",
  stripeEvents: "StripeEvents",
  userAccess: "User Access",
};

function parseArgs(argv) {
  const options = {
    dryRun: false,
    emulator: false,
    live: false,
    confirmLive: false,
    reconcile: false,
    reportPath: null,
    workbookPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--emulator") options.emulator = true;
    else if (arg === "--live") options.live = true;
    else if (arg === "--confirm-live") options.confirmLive = true;
    else if (arg === "--reconcile") options.reconcile = true;
    else if (arg === "--report") {
      options.reportPath = argv[index + 1] || null;
      index += 1;
    }
    else if (!arg.startsWith("--")) options.workbookPath = arg;
  }

  return options;
}

function usage() {
  return [
    "Usage:",
    "  node functions/scripts/importMasterDatabase.js --dry-run <workbook.xlsx|xlsm>",
    "  node functions/scripts/importMasterDatabase.js --emulator <workbook.xlsx|xlsm>",
    "  node functions/scripts/importMasterDatabase.js --emulator --reconcile [--report report.json] <workbook.xlsx|xlsm>",
    "  node functions/scripts/importMasterDatabase.js --live --confirm-live <workbook.xlsx|xlsm>",
    "  node functions/scripts/importMasterDatabase.js --live --confirm-live --reconcile " +
      "[--report report.json] <workbook.xlsx|xlsm>",
    "",
    "Imports use a managed merge: new IDs are created and workbook-managed IDs receive changed workbook fields.",
    "App-owned collisions and workbook-managed records missing from the workbook are preserved.",
  ].join("\n");
}

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function cleanObject(value) {
  if (Array.isArray(value)) {
    return value.map(cleanObject).filter((item) => item !== undefined);
  }

  if (!value || typeof value !== "object") return value;

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    const cleaned = cleanObject(entry);
    if (cleaned !== undefined && cleaned !== null && cleaned !== "") {
      out[key] = cleaned;
    }
  }
  return out;
}

function value(row, ...names) {
  for (const name of names) {
    const found = row[normalizeKey(name)];
    if (found !== undefined && found !== null && String(found).trim() !== "") {
      return found;
    }
  }
  return null;
}

function asString(input) {
  if (input === null || input === undefined) return null;
  const trimmed = String(input).trim();
  return trimmed || null;
}

function asNumber(input) {
  if (input === null || input === undefined || input === "") return null;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : null;
}

function asDate(input) {
  if (input === null || input === undefined || input === "") return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? asString(input) : parsed;
}

function asBool(input) {
  if (typeof input === "boolean") return input;
  const normalized = normalizeKey(input);
  if (["yes", "y", "true", "1", "active"].includes(normalized)) return true;
  if (["no", "n", "false", "0", "inactive", "draft", ""].includes(normalized)) {
    return false;
  }
  return false;
}

function asStatus(input) {
  const normalized = normalizeKey(input);
  if (!normalized) return null;
  if (normalized === "active") return "active";
  if (normalized === "draft") return "draft";
  if (normalized === "archived") return "archived";
  if (normalized === "pending") return "pending";
  if (normalized === "suspended") return "suspended";
  if (normalized === "deleted") return "deleted";
  return normalized.replace(/\s+/g, "-");
}

function asContentStatus(input, fallback = "draft") {
  const normalized = normalizeKey(input);
  if (!normalized) return fallback;
  if (["approved", "published", "public", "active"].includes(normalized)) return "active";
  if (["pending review", "review", "changes requested"].includes(normalized)) return "review";
  if (["paused", "unlisted"].includes(normalized)) return "paused";
  if (["archived", "removed", "rejected", "deleted"].includes(normalized)) return "archived";
  return normalized === "draft" ? "draft" : fallback;
}

function asVisibility(input, fallback = "private") {
  const normalized = normalizeKey(input);
  const aliases = {
    public: "users",
    system: "admin",
    marketplace: "users",
    unlisted: "private",
  };
  return aliases[normalized] || normalized || fallback;
}

function asArray(input) {
  if (input === null || input === undefined || input === "") return [];
  return String(input)
    .split(/[|,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function canonicalType(input) {
  const normalized = normalizeKey(input);
  const aliases = {
    "recovery tools business operations": "business workflow",
    "marketing campaign plan": "campaign",
    "exercise plan": "recovery plan",
    "testing bundle": "assessment",
    exercise: "recovery activity",
    test: "clinical test",
    treatment: "treatment technique",
    education: "client education",
  };
  return aliases[normalized] || normalized || null;
}

function slugId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function groupValues(rows, ownerColumn, valueColumn) {
  const grouped = new Map();
  for (const row of rows) {
    const ownerId = asString(value(row, ownerColumn));
    const linkedId = asString(value(row, valueColumn));
    if (!ownerId || !linkedId) continue;
    const values = grouped.get(ownerId) || [];
    values.push(linkedId);
    grouped.set(ownerId, values);
  }
  return grouped;
}

function resolveEntityType(row, entityKind, entityTypeById) {
  const direct = asString(value(row, "Type"));
  if (direct) return canonicalType(direct);

  const legacyTypeColumns = {
    Item: ["FirebaseType", "ItemType"],
    Blueprint: ["Blueprint Type", "BlueprintType"],
    Plan: ["Plan Type", "PlanType"],
  };
  const legacyType = canonicalType(value(row, ...(legacyTypeColumns[entityKind] || [])));
  if (legacyType) return legacyType;

  const typeId = asString(value(
    row,
    "TypeID",
    `${entityKind}TypeID`,
  ));
  if (typeId && entityTypeById.has(typeId)) {
    return canonicalType(value(entityTypeById.get(typeId), "Type", "TypeName"));
  }
  if (typeId) {
    const prefix = `TYPE-${entityKind.toUpperCase()}-`;
    if (typeId.toUpperCase().startsWith(prefix)) {
      return canonicalType(typeId.slice(prefix.length).replace(/-/g, " "));
    }
  }

  if (entityKind === "Blueprint") {
    const categoryId = asString(value(row, "CategoryID"));
    const categoryTypes = {
      "CAT-ART": "recovery activity",
      "CAT-TEST": "clinical test",
      "CAT-TREAT": "treatment technique",
      "CAT-CLEDU": "client education",
      "CAT-THEREDU": "therapist education",
    };
    if (categoryTypes[categoryId]) return categoryTypes[categoryId];
    const context = normalizeKey([
      value(row, "Role"),
      value(row, "BlueprintName"),
      value(row, "BlueprintID"),
    ].filter(Boolean).join(" "));
    if (context.includes("manufactur")) return "product manufacture";
    if (context.includes("marketing") || context.includes("photo") || context.includes("social")) {
      return "marketing content";
    }
    if (categoryId === "CAT-BUS-CONT" || context.includes("business") || context.includes("blue-bus")) {
      return "business workflow";
    }
  }
  if (entityKind === "Plan") {
    const planId = normalizeKey(value(row, "PlanID"));
    if (planId.includes("reass")) return "reassessment";
    if (planId.includes("assessment") || planId.includes("func")) return "assessment";
    if (planId.includes("campaign")) return "campaign";
  }
  return null;
}

function parseSheet(workbook, sheetName) {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return [];

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    defval: null,
    raw: true,
  });

  return rows.map((row) => {
    const normalized = {};
    for (const [key, entry] of Object.entries(row)) {
      normalized[normalizeKey(key)] = entry;
    }
    return normalized;
  });
}

function indexBy(rows, ...keys) {
  const map = new Map();
  for (const row of rows) {
    for (const key of keys) {
      const id = asString(value(row, key));
      if (id) {
        map.set(id, row);
        break;
      }
    }
  }
  return map;
}

function pushDoc(docs, collection, id, data) {
  if (!id) return;
  docs.push({
    collection,
    id,
    data: cleanObject(data),
  });
}

function canonicalWorkbookData(row, schema) {
  const data = {};
  for (const definition of schema.fields) {
    const raw = value(row, definition.workbook);
    if (raw === null || raw === undefined || raw === "") continue;
    if (definition.type === "boolean") data[definition.firestore] = asBool(raw);
    else if (definition.type === "number") data[definition.firestore] = asNumber(raw);
    else data[definition.firestore] = raw instanceof Date ? raw : asString(raw);
  }
  return cleanObject(data);
}

function buildDocs(workbook, workbookPath) {
  const warnings = [];
  const docs = [];

  const rows = {
    categories: parseSheet(workbook, "Category"),
    tags: parseSheet(workbook, "Tags"),
    entityTypes: parseSheet(workbook, "Entity Types"),
    items: parseSheet(workbook, "Items"),
    itemTagLinks: parseSheet(workbook, "ItemTagLinks"),
    blueprints: parseSheet(workbook, "Blueprints"),
    blueprintTagLinks: parseSheet(workbook, "BlueprintTagLinks"),
    blueprintItems: parseSheet(workbook, "Blueprint Items"),
    blueprintMethods: parseSheet(workbook, "Blueprint Methods"),
    blueprintDosage: parseSheet(workbook, "Blueprint Dosage"),
    plans: parseSheet(workbook, "Plan"),
    planTagLinks: parseSheet(workbook, "PlanTagLinks"),
    planItems: parseSheet(workbook, "Plan Items"),
    planDosage: parseSheet(workbook, "Plan Dosage"),
    planLinks: parseSheet(workbook, "Plan Links"),
    itemTemplates: parseSheet(workbook, "Item Templates"),
    itemTemplateVariants: parseSheet(workbook, "ItemTemplateVariants"),
    blueprintTemplates: parseSheet(workbook, "Blueprint Templates"),
    blueprintTemplateVariants: parseSheet(workbook, "BlueprintTemplateVariants"),
    blueprintTemplateFields: parseSheet(workbook, "BlueprintTemplateFields"),
    planTemplates: parseSheet(workbook, "Plan Templates"),
    planTemplateVariants: parseSheet(workbook, "PlanTemplateVariants"),
    planTemplateSlots: parseSheet(workbook, "PlanTemplateSlots"),
    contentTemplates: parseSheet(workbook, "Templates"),
    contentTemplateVariants: parseSheet(workbook, "TemplateVariants"),
    contentTemplateFields: parseSheet(workbook, "TemplateFields"),
    products: parseSheet(workbook, "ItemProduct"),
    canonicalProducts: parseSheet(workbook, "Products"),
    productConnections: parseSheet(workbook, "ProductConnections"),
    productLinks: parseSheet(workbook, "ProductLinks"),
    productOptions: parseSheet(workbook, "ProductOptions"),
    productOptionValues: parseSheet(workbook, "ProductOptionValues"),
    productVariants: parseSheet(workbook, "ProductVariants"),
    productVariantValues: parseSheet(workbook, "ProductVariantValues"),
    productComponents: parseSheet(workbook, "ProductComponents"),
    productAccessGrants: parseSheet(workbook, "ProductAccessGrants"),
    prices: parseSheet(workbook, "ProductPrice"),
    variants: parseSheet(workbook, "ItemVariants"),
    assets: parseSheet(workbook, "Asset"),
    canonicalAssets: parseSheet(workbook, "Assets"),
    entityAssets: parseSheet(workbook, "EntityAssets"),
    assetRenditions: parseSheet(workbook, "AssetRenditions"),
    itemAssets: parseSheet(workbook, "ItemAsset"),
    inventory: parseSheet(workbook, "Inventory"),
    instructors: parseSheet(workbook, "Instructors"),
    users: parseSheet(workbook, "Users"),
    orders: parseSheet(workbook, "Orders"),
    orderItems: parseSheet(workbook, "OrderItem"),
    customerAddresses: parseSheet(workbook, "CustomerAddresses"),
    shipments: parseSheet(workbook, "Shipments"),
    stripeEvents: parseSheet(workbook, "StripeEvents"),
    userAccess: parseSheet(workbook, "User Access"),
  };

  const entityTypeById = indexBy(rows.entityTypes, "TypeID");
  const itemsById = indexBy(rows.items, "ItemID");
  const blueprintsById = indexBy(rows.blueprints, "BlueprintID");
  const plansById = indexBy(rows.plans, "PlanID");
  const itemTemplatesById = indexBy(rows.itemTemplates, "ItemTemplateID");
  const blueprintTemplatesById = indexBy(rows.blueprintTemplates, "BlueprintTemplateID");
  const singleBlueprintTemplateId = blueprintTemplatesById.size === 1
    ? [...blueprintTemplatesById.keys()][0]
    : null;
  const planTemplatesById = indexBy(rows.planTemplates, "PlanTemplateID");
  const planTemplateVariantsById = indexBy(rows.planTemplateVariants, "VariantID");
  const contentTemplatesById = indexBy(rows.contentTemplates, "TemplateID");
  const contentTemplateVariantsById = indexBy(rows.contentTemplateVariants, "VariantID");
  const tagsById = indexBy(rows.tags, "TagID");
  const assetsById = indexBy(rows.assets, "AssetID");
  const canonicalProductIds = new Set(
    rows.canonicalProducts.map((row) => asString(value(row, "ProductID"))).filter(Boolean),
  );
  const canonicalAssetIds = new Set(
    rows.canonicalAssets.map((row) => asString(value(row, "AssetID"))).filter(Boolean),
  );
  const itemTagsById = groupValues(rows.itemTagLinks, "ItemID", "TagID");
  const blueprintTagsById = groupValues(rows.blueprintTagLinks, "BlueprintID", "TagID");
  const planTagsById = groupValues(rows.planTagLinks, "PlanID", "TagID");
  const relatedPlansByPlanId = groupValues(rows.planLinks, "PlanID", "RelatedPlanID");
  const blueprintMethodsById = new Map();
  const blueprintDosageById = new Map();
  const planDosageById = new Map();
  const itemAssetsByItemId = new Map();
  const pricesByProductId = new Map();
  const variantsByItemId = new Map();
  const inventoryByItemId = new Map();
  const inventoryByVariantId = new Map();

  for (const method of rows.blueprintMethods) {
    const blueprintId = asString(value(method, "BlueprintID"));
    if (!blueprintId) continue;
    if (!blueprintMethodsById.has(blueprintId)) blueprintMethodsById.set(blueprintId, []);
    blueprintMethodsById.get(blueprintId).push({
      methodStepId: asString(value(method, "MethodStepID")),
      stepOrder: asNumber(value(method, "StepOrder")),
      methodStep: asString(value(method, "MethodStep")),
      instruction: asString(value(method, "Instruction")),
    });
  }

  for (const dosage of rows.blueprintDosage) {
    const blueprintId = asString(value(dosage, "BlueprintID"));
    if (!blueprintId) continue;
    if (!blueprintDosageById.has(blueprintId)) blueprintDosageById.set(blueprintId, []);
    blueprintDosageById.get(blueprintId).push({
      dosageId: asString(value(dosage, "DosageID")),
      sets: asString(value(dosage, "Sets")),
      reps: asString(value(dosage, "Reps")),
      time: asString(value(dosage, "Time")),
      dosage: asString(value(dosage, "Dosage")),
      notes: asString(value(dosage, "Dosage Notes")),
      regression: asString(value(dosage, "Regression")),
      progression: asString(value(dosage, "Progression")),
    });
  }

  for (const dosage of rows.planDosage) {
    const planId = asString(value(dosage, "PlanID"));
    if (!planId) continue;
    if (!planDosageById.has(planId)) planDosageById.set(planId, []);
    planDosageById.get(planId).push({
      planDosageId: asString(value(dosage, "PlanDosageID")),
      planItemId: asString(value(dosage, "PlanItemID")),
      sets: asString(value(dosage, "Sets")),
      reps: asString(value(dosage, "Reps")),
      time: asString(value(dosage, "Time")),
      dosage: asString(value(dosage, "Dosage")),
      notes: asString(value(dosage, "Dosage Notes")),
      regression: asString(value(dosage, "Regression")),
      progression: asString(value(dosage, "Progression")),
    });
  }

  for (const link of rows.itemAssets) {
    const itemId = asString(value(link, "ItemID"));
    if (!itemId) continue;
    if (!itemAssetsByItemId.has(itemId)) itemAssetsByItemId.set(itemId, []);
    itemAssetsByItemId.get(itemId).push(link);
  }

  for (const price of rows.prices) {
    const productId = asString(value(price, "ItemProductID"));
    if (!productId) continue;
    if (!pricesByProductId.has(productId)) pricesByProductId.set(productId, []);
    pricesByProductId.get(productId).push(price);
  }

  for (const variant of rows.variants) {
    const itemId = asString(value(variant, "ItemID"));
    if (!itemId) continue;
    if (!variantsByItemId.has(itemId)) variantsByItemId.set(itemId, []);
    variantsByItemId.get(itemId).push(variant);
  }

  for (const inv of rows.inventory) {
    const itemId = asString(value(inv, "ItemID"));
    const variantId = asString(value(inv, "VariantID"));
    if (itemId) {
      if (!inventoryByItemId.has(itemId)) inventoryByItemId.set(itemId, []);
      inventoryByItemId.get(itemId).push(inv);
    }
    if (variantId) {
      if (!inventoryByVariantId.has(variantId)) inventoryByVariantId.set(variantId, []);
      inventoryByVariantId.get(variantId).push(inv);
    }
  }

  for (const row of rows.categories) {
    const categoryId = asString(value(row, "CategoryID"));
    if (!categoryId) continue;
    pushDoc(docs, "categories", categoryId, {
      categoryId,
      name: asString(value(row, "CategoryName", "Category Name", "Name")),
      parentCategoryId: asString(value(row, "ParentCategoryID", "Parent CategoryID")),
      description: asString(value(row, "Description")),
      status: asStatus(value(row, "Status")) || "active",
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.tags) {
    const tagId = asString(value(row, "TagID"));
    if (!tagId) continue;
    pushDoc(docs, "tags", tagId, {
      tagId,
      name: asString(value(row, "TagName", "Tag Name", "Name")) || tagId,
      abbreviation: asString(value(row, "Abbreviation")),
      synonyms: asArray(value(row, "Synonyms")),
      description: asString(value(row, "Description")),
      categoryId: asString(value(row, "CategoryID")),
      status: asStatus(value(row, "Status")) || "active",
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.entityTypes) {
    const entityKind = canonicalType(value(row, "Main Entity", "EntityKind"));
    const type = canonicalType(value(row, "Type", "TypeName"));
    if (!entityKind || !type) continue;
    const typeId = asString(value(row, "TypeID")) || `${slugId(entityKind)}-${slugId(type)}`;
    pushDoc(docs, "entityTypes", typeId, {
      typeId,
      entityKind,
      type,
      fieldGroupIds: asArray(value(row, "FieldGroupIDs", "Field Group IDs")),
      canUseInBlueprints: asBool(value(row, "CanUseInBlueprints")),
      canUseInPlans: asBool(value(row, "CanUseInPlans")),
      hasContent: asBool(value(row, "HasContent")),
      hasAssets: asBool(value(row, "HasAssets")),
      isShopProduct: asBool(value(row, "IsShopProduct")),
      tracksInventory: asBool(value(row, "TracksInventory")),
      hasVariants: asBool(value(row, "HasVariants")),
      unlocksAccess: asBool(value(row, "UnlocksAccess")),
      isPhysical: asBool(value(row, "IsPhysical")),
      hasDosage: asBool(value(row, "HasDosage")),
      status: asStatus(value(row, "Status")) || "active",
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.items) {
    const itemId = asString(value(row, "ItemID"));
    if (!itemId) continue;

    const tagIds = unique([
      ...asArray(value(row, "TagID")),
      ...(itemTagsById.get(itemId) || []),
    ]);
    const type = resolveEntityType(row, "Item", entityTypeById);
    pushDoc(docs, "items", itemId, {
      itemId,
      name: asString(value(row, "Item Name")),
      type,
      tagIds,
      tags: tagIds.map((tagId) => asString(value(tagsById.get(tagId) ?? {}, "TagName", "Tag Name"))).filter(Boolean),
      soldByRecoveryTools: asBool(value(row, "SoldByRecoveryTools")),
      isShopProduct: asBool(value(row, "IsShopProduct")),
      supplierType: asString(value(row, "Supplier Type")),
      websiteVisible: asBool(value(row, "Website Visible")),
      visible: asBool(value(row, "Website Visible")),
      shortDescription: asString(value(row, "Short Description")),
      longDescription: asString(value(row, "Long Description")),
      unlocksAccess: asBool(value(row, "Unlocks access")),
      accessType: asString(value(row, "Access Type")),
      relatedPlanId: asString(value(row, "Related PlanID")),
      relatedCourseId: asString(value(row, "Related PlanCourseDetailID")),
      relatedWorkshopId: asString(value(row, "Related WorkshopID")),
      accessCodeEligible: asBool(value(row, "Access Code Eligible", "Access Code Eligable")),
      inventoryTracked: asBool(value(row, "inventoryTracked")),
      createsProduct: asBool(value(row, "CreatesProduct", "Creates Product", "IsShopProduct")),
      stockStatus: asStatus(value(row, "StockStatus")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.blueprints) {
    const blueprintId = asString(value(row, "BlueprintID"));
    if (!blueprintId) continue;

    const tagIds = unique(blueprintTagsById.get(blueprintId) || []);
    const components = rows.blueprintItems
      .filter((component) => asString(value(component, "BlueprintID")) === blueprintId)
      .map((component) => ({
        blueprintItemId: asString(value(component, "BlueprintItemID")),
        itemId: asString(value(component, "ItemID")),
        itemName: asString(value(component, "ItemName")),
        fieldName: asString(value(component, "FieldName")),
        role: asString(value(component, "ItemRole", "Role")),
        quantity: asNumber(value(component, "Quantity")),
        instructions: asString(value(component, "Instructions")),
        sortOrder: asNumber(value(component, "SortOrder")),
        required: asBool(value(component, "Required")),
        displayInline: asBool(value(component, "DisplayInline")),
      }))
      .sort((left, right) => (left.sortOrder ?? 999) - (right.sortOrder ?? 999));
    const linkedItemIds = unique(components.map((component) => component.itemId));
    const methodSteps = (blueprintMethodsById.get(blueprintId) || [])
      .sort((left, right) => (left.stepOrder ?? 999) - (right.stepOrder ?? 999));
    const dosageEntries = blueprintDosageById.get(blueprintId) || [];

    pushDoc(docs, "blueprints", blueprintId, {
      blueprintId,
      name: asString(value(row, "BlueprintName", "Blueprint Name")),
      type: resolveEntityType(row, "Blueprint", entityTypeById),
      createsProduct: asBool(value(row, "CreatesProduct", "Creates Product")),
      tagIds,
      tags: tagIds
        .map((tagId) => asString(value(tagsById.get(tagId) ?? {}, "TagName", "Tag Name")))
        .filter(Boolean),
      blueprintTemplateId: asString(value(row, "BlueprintTemplateID")),
      soapAbbreviation: asString(value(row, "SOAPAbbreviation")),
      expectedUnit: asString(value(row, "Expected Unit")),
      purpose: asString(value(row, "Purpose")),
      indications: asString(value(row, "Indications")),
      contraindications: asString(value(row, "Contraindications")),
      methodId: asString(value(row, "MethodID")),
      equipmentIds: asArray(value(row, "EquipmentIDs")),
      phaseId: asString(value(row, "PhaseID", "Phase")),
      flagId: asString(value(row, "FlagID")),
      ownerType: asString(value(row, "OwnerType")),
      ownerId: asString(value(row, "OwnerID")),
      visibility: asVisibility(value(row, "Visibility")),
      status: asContentStatus(value(row, "Status", "ApprovalStatus")),
      sourceBlueprintId: asString(value(row, "SourceBlueprintID")),
      linkedItemIds,
      itemComponents: components,
      methodSteps,
      dosageEntries,
      references: asString(value(row, "References")),
      referenceStatus: asString(value(row, "ReferenceStatus", "Reference Status")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.blueprintItems) {
    const blueprintItemId = asString(value(row, "BlueprintItemID"));
    const blueprintId = asString(value(row, "BlueprintID"));
    const itemId = asString(value(row, "ItemID"));
    if (!blueprintItemId) continue;
    if (blueprintId && !blueprintsById.has(blueprintId)) {
      warnings.push(`BlueprintItem ${blueprintItemId} references missing blueprint ${blueprintId}.`);
    }
    if (itemId && !itemsById.has(itemId)) {
      warnings.push(`BlueprintItem ${blueprintItemId} references missing item ${itemId}.`);
    }
    if (!itemId && asString(value(row, "ItemName"))) {
      warnings.push(`BlueprintItem ${blueprintItemId} is name-only and needs an ItemID.`);
    }

    pushDoc(docs, "blueprintItems", blueprintItemId, {
      blueprintItemId,
      blueprintId,
      itemId,
      itemName: asString(value(row, "ItemName")),
      itemType: canonicalType(value(row, "Item Type", "ItemType")),
      templateFieldId: asString(value(row, "TemplateFieldID")),
      fieldName: asString(value(row, "FieldName")),
      role: asString(value(row, "ItemRole", "Role")),
      methodStepId: asString(value(row, "MethodStepID")),
      sortOrder: asNumber(value(row, "SortOrder")),
      quantity: asNumber(value(row, "Quantity")),
      required: asBool(value(row, "Required")),
      displayInline: asBool(value(row, "DisplayInline")),
      instructions: asString(value(row, "Instructions")),
      unresolvedNameOnly: !itemId && !!asString(value(row, "ItemName")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.blueprintMethods) {
    const methodStepId = asString(value(row, "MethodStepID"));
    const blueprintId = asString(value(row, "BlueprintID"));
    if (!methodStepId) continue;
    if (blueprintId && !blueprintsById.has(blueprintId)) {
      warnings.push(`BlueprintMethod ${methodStepId} references missing blueprint ${blueprintId}.`);
    }
    pushDoc(docs, "blueprintMethods", methodStepId, {
      methodStepId,
      blueprintId,
      stepOrder: asNumber(value(row, "StepOrder")),
      methodStep: asString(value(row, "MethodStep")),
      instruction: asString(value(row, "Instruction")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.blueprintDosage) {
    const dosageId = asString(value(row, "DosageID"));
    const blueprintId = asString(value(row, "BlueprintID"));
    if (!dosageId) continue;
    if (blueprintId && !blueprintsById.has(blueprintId)) {
      warnings.push(`BlueprintDosage ${dosageId} references missing blueprint ${blueprintId}.`);
    }
    pushDoc(docs, "blueprintDosage", dosageId, {
      dosageId,
      blueprintId,
      sets: asString(value(row, "Sets")),
      reps: asString(value(row, "Reps")),
      time: asString(value(row, "Time")),
      dosage: asString(value(row, "Dosage")),
      dosageNotes: asString(value(row, "Dosage Notes")),
      regression: asString(value(row, "Regression")),
      progression: asString(value(row, "Progression")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.contentTemplates) {
    const templateId = asString(value(row, "TemplateID"));
    if (!templateId) continue;
    const templateArea = canonicalType(value(row, "TemplateArea", "MainEntity", "EntityKind"));
    if (!["item", "blueprint", "plan"].includes(templateArea)) {
      warnings.push(`Template ${templateId} has invalid TemplateArea ${templateArea || "(blank)"}.`);
    }
    pushDoc(docs, "contentTemplates", templateId, {
      templateId,
      templateArea,
      name: asString(value(row, "TemplateName", "Name")) || templateId,
      appliesTo: canonicalType(value(row, "AppliesToType", "Type")),
      description: asString(value(row, "Description")),
      requiresShipping: asBool(value(row, "RequiresShipping")),
      inventoryTracked: asBool(value(row, "InventoryTracked", "TrackInventory")),
      isShopProduct: asBool(value(row, "IsShopProduct", "ShopProduct")),
      soldByRecoveryTools: value(row, "SoldByRecoveryTools") === null
        ? true
        : asBool(value(row, "SoldByRecoveryTools")),
      unlocksAccess: asBool(value(row, "UnlocksAccess")),
      accessType: asString(value(row, "AccessType")),
      requiresCalendar: asBool(value(row, "RequiresCalendar")),
      requiresSessionTime: asBool(value(row, "RequiresSessionTime")),
      tracksSeats: asBool(value(row, "TracksSeats")),
      seatCapacity: asNumber(value(row, "SeatCapacity", "DefaultSeatCapacity")),
      deliveryMode: asString(value(row, "DeliveryMode")),
      requiresLocation: asBool(value(row, "RequiresLocation")),
      requiresInstructor: asBool(value(row, "RequiresInstructor")),
      issuesCertificate: asBool(value(row, "IssuesCertificate")),
      ownerType: asString(value(row, "OwnerType")),
      visibility: asString(value(row, "Visibility")),
      approvalStatus: asString(value(row, "ApprovalStatus")),
      isDefault: asBool(value(row, "IsDefault", "DefaultForType")),
      active: value(row, "Active") === null ? true : asBool(value(row, "Active")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.contentTemplateVariants) {
    const variantId = asString(value(row, "VariantID"));
    const templateId = asString(value(row, "TemplateID"));
    if (!variantId) continue;
    if (templateId && !contentTemplatesById.has(templateId)) {
      warnings.push(`TemplateVariant ${variantId} references missing template ${templateId}.`);
    }
    const requiresShipping = value(row, "RequiresShipping");
    const inventoryTracked = value(row, "InventoryTracked", "TrackInventory");
    const isShopProduct = value(row, "IsShopProduct", "ShopProduct");
    const soldByRecoveryTools = value(row, "SoldByRecoveryTools");
    const unlocksAccess = value(row, "UnlocksAccess");
    const requiresCalendar = value(row, "RequiresCalendar");
    const requiresSessionTime = value(row, "RequiresSessionTime");
    const tracksSeats = value(row, "TracksSeats");
    const requiresLocation = value(row, "RequiresLocation");
    const requiresInstructor = value(row, "RequiresInstructor");
    const issuesCertificate = value(row, "IssuesCertificate");
    const accessType = value(row, "AccessType");
    const seatCapacity = value(row, "SeatCapacity", "DefaultSeatCapacity");
    const deliveryMode = value(row, "DeliveryMode");
    pushDoc(docs, "contentTemplateVariants", variantId, {
      variantId,
      templateId,
      name: asString(value(row, "VariantName", "Name")) || variantId,
      description: asString(value(row, "Description")),
      durationMinutes: asNumber(value(row, "DurationMinutes")),
      sizeLabel: asString(value(row, "SizeLabel")),
      ...(requiresShipping === null ? {} : { requiresShipping: asBool(requiresShipping) }),
      ...(inventoryTracked === null ? {} : { inventoryTracked: asBool(inventoryTracked) }),
      ...(isShopProduct === null ? {} : { isShopProduct: asBool(isShopProduct) }),
      ...(soldByRecoveryTools === null ? {} : { soldByRecoveryTools: asBool(soldByRecoveryTools) }),
      ...(unlocksAccess === null ? {} : { unlocksAccess: asBool(unlocksAccess) }),
      ...(requiresCalendar === null ? {} : { requiresCalendar: asBool(requiresCalendar) }),
      ...(requiresSessionTime === null ? {} : { requiresSessionTime: asBool(requiresSessionTime) }),
      ...(tracksSeats === null ? {} : { tracksSeats: asBool(tracksSeats) }),
      ...(requiresLocation === null ? {} : { requiresLocation: asBool(requiresLocation) }),
      ...(requiresInstructor === null ? {} : { requiresInstructor: asBool(requiresInstructor) }),
      ...(issuesCertificate === null ? {} : { issuesCertificate: asBool(issuesCertificate) }),
      ...(accessType === null ? {} : { accessType: asString(accessType) }),
      ...(seatCapacity === null ? {} : { seatCapacity: asNumber(seatCapacity) }),
      ...(deliveryMode === null ? {} : { deliveryMode: asString(deliveryMode) }),
      isDefault: asBool(value(row, "IsDefault", "IsDefaultVariant")),
      sortOrder: asNumber(value(row, "SortOrder")),
      active: value(row, "Active") === null ? true : asBool(value(row, "Active")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.contentTemplateFields) {
    const fieldId = asString(value(row, "FieldID"));
    const variantId = asString(value(row, "VariantID"));
    const variantRow = contentTemplateVariantsById.get(variantId);
    const templateId = asString(value(row, "TemplateID")) ||
      asString(value(variantRow || {}, "TemplateID"));
    if (!fieldId) continue;
    if (variantId && !contentTemplateVariantsById.has(variantId)) {
      warnings.push(`TemplateField ${fieldId} references missing variant ${variantId}.`);
    }
    if (templateId && !contentTemplatesById.has(templateId)) {
      warnings.push(`TemplateField ${fieldId} references missing template ${templateId}.`);
    }
    pushDoc(docs, "contentTemplateFields", fieldId, {
      fieldId,
      templateId,
      variantId,
      name: asString(value(row, "FieldName", "Name")) || fieldId,
      fieldType: asString(value(row, "FieldType")),
      linkedTable: asString(value(row, "LinkedTable")),
      required: asBool(value(row, "Required")),
      repeatable: asBool(value(row, "Repeatable")),
      minEntries: asNumber(value(row, "MinEntries")),
      maxEntries: asNumber(value(row, "MaxEntries")),
      allowUnlimited: asBool(value(row, "AllowUnlimited")),
      sortOrder: asNumber(value(row, "SortOrder")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.itemTemplates) {
    const itemTemplateId = asString(value(row, "ItemTemplateID", "TemplateID"));
    if (!itemTemplateId) continue;
    pushDoc(docs, "itemTemplates", itemTemplateId, {
      itemTemplateId,
      name: asString(value(row, "TemplateName", "Name")) || itemTemplateId,
      type: canonicalType(value(row, "ItemType", "Type")),
      description: asString(value(row, "Description")),
      createdByUserId: asString(value(row, "CreatedByUserID")),
      ownerType: asString(value(row, "OwnerType")),
      ownerId: asString(value(row, "OwnerID")),
      visibility: asString(value(row, "Visibility")),
      approvalStatus: asString(value(row, "ApprovalStatus")),
      isMasterTemplate: asBool(value(row, "IsMasterTemplate")),
      canBeCopied: asBool(value(row, "CanBeCopied")),
      active: value(row, "Active") === null ? true : asBool(value(row, "Active")),
      version: asNumber(value(row, "Version")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.itemTemplateVariants) {
    const variantId = asString(value(row, "VariantID"));
    const itemTemplateId = asString(value(row, "ItemTemplateID"));
    if (!variantId) continue;
    if (itemTemplateId && !itemTemplatesById.has(itemTemplateId)) {
      warnings.push(`ItemTemplateVariant ${variantId} references missing template ${itemTemplateId}.`);
    }
    pushDoc(docs, "itemTemplateVariants", variantId, {
      variantId,
      itemTemplateId,
      name: asString(value(row, "VariantName", "Name")) || variantId,
      description: asString(value(row, "Description")),
      itemKind: asString(value(row, "ItemKind")),
      isShopProduct: asBool(value(row, "IsShopProduct")),
      requiresShipping: asBool(value(row, "RequiresShipping")),
      inventoryTracked: asBool(value(row, "InventoryTracked")),
      soldByRecoveryTools: value(row, "SoldByRecoveryTools") === null
        ? true
        : asBool(value(row, "SoldByRecoveryTools")),
      unlocksAccess: asBool(value(row, "UnlocksAccess")),
      accessType: asString(value(row, "AccessType")),
      requiresCalendar: asBool(value(row, "RequiresCalendar")),
      requiresSessionTime: asBool(value(row, "RequiresSessionTime")),
      tracksSeats: asBool(value(row, "TracksSeats")),
      deliveryMode: asString(value(row, "DeliveryMode")),
      active: value(row, "Active") === null ? true : asBool(value(row, "Active")),
      isDefault: asBool(value(row, "IsDefault")),
      sortOrder: asNumber(value(row, "SortOrder")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.blueprintTemplates) {
    const blueprintTemplateId = asString(value(row, "BlueprintTemplateID"));
    if (!blueprintTemplateId) continue;
    pushDoc(docs, "blueprintTemplates", blueprintTemplateId, {
      blueprintTemplateId,
      name: asString(value(row, "TemplateName", "Name")) || blueprintTemplateId,
      type: canonicalType(value(row, "BlueprintType", "Type")),
      description: asString(value(row, "Description")),
      createdByUserId: asString(value(row, "CreatedByUserID")),
      ownerType: asString(value(row, "OwnerType")),
      ownerId: asString(value(row, "OwnerID")),
      visibility: asString(value(row, "Visibility")),
      approvalStatus: asString(value(row, "ApprovalStatus")),
      isMasterTemplate: asBool(value(row, "IsMasterTemplate")),
      canBeCopied: asBool(value(row, "CanBeCopied")),
      active: value(row, "Active") === null ? true : asBool(value(row, "Active")),
      version: asNumber(value(row, "Version")),
      isDefault: asBool(value(row, "IsDefault")),
      sortOrder: asNumber(value(row, "SortOrder")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.blueprintTemplateVariants) {
    const variantId = asString(value(row, "VariantID"));
    const blueprintTemplateId = asString(value(row, "BlueprintTemplateID"));
    if (!variantId) continue;
    if (blueprintTemplateId && !blueprintTemplatesById.has(blueprintTemplateId)) {
      warnings.push(
        `BlueprintTemplateVariant ${variantId} references missing template ${blueprintTemplateId}.`,
      );
    }
    pushDoc(docs, "blueprintTemplateVariants", variantId, {
      variantId,
      blueprintTemplateId,
      name: asString(value(row, "VariantName", "Name")) || variantId,
      description: asString(value(row, "Description")),
      active: value(row, "Active") === null ? true : asBool(value(row, "Active")),
      isDefault: asBool(value(row, "IsDefault")),
      sortOrder: asNumber(value(row, "SortOrder")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.blueprintTemplateFields) {
    const blueprintTemplateId = asString(value(row, "BlueprintTemplateID")) ||
      singleBlueprintTemplateId;
    const fieldName = asString(value(row, "FieldName"));
    const fieldId = asString(value(row, "FieldID")) ||
      (blueprintTemplateId && fieldName
        ? `${blueprintTemplateId}-FIELD-${slugId(fieldName)}`
        : null);
    if (!fieldId) continue;
    if (blueprintTemplateId && !blueprintTemplatesById.has(blueprintTemplateId)) {
      warnings.push(
        `BlueprintTemplateField ${fieldId} references missing template ${blueprintTemplateId}.`,
      );
    }
    pushDoc(docs, "blueprintTemplateFields", fieldId, {
      fieldId,
      blueprintTemplateId,
      name: fieldName || fieldId,
      fieldType: asString(value(row, "FieldType")),
      linkedTable: asString(value(row, "LinkedTable")),
      required: asBool(value(row, "Required")),
      repeatable: asBool(value(row, "Repeatable")),
      minEntries: asNumber(value(row, "MinEntries")),
      maxEntries: asNumber(value(row, "MaxEntries")),
      allowUnlimited: asBool(value(row, "AllowUnlimited")),
      sortOrder: asNumber(value(row, "SortOrder")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.planTemplates) {
    const planTemplateId = asString(value(row, "PlanTemplateID"));
    if (!planTemplateId) continue;
    pushDoc(docs, "planTemplates", planTemplateId, {
      planTemplateId,
      name: asString(value(row, "TemplateName", "Name")) || planTemplateId,
      type: canonicalType(value(row, "PlanType", "Type")),
      description: asString(value(row, "Description")),
      createdByUserId: asString(value(row, "CreatedByUserID")),
      ownerType: asString(value(row, "OwnerType")),
      ownerId: asString(value(row, "OwnerID")),
      visibility: asString(value(row, "Visibility")),
      approvalStatus: asString(value(row, "ApprovalStatus")),
      isMasterTemplate: asBool(value(row, "IsMasterTemplate")),
      canBeCopied: asBool(value(row, "CanBeCopied")),
      active: asBool(value(row, "Active")),
      version: asNumber(value(row, "Version")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.planTemplateVariants) {
    const variantId = asString(value(row, "VariantID"));
    const planTemplateId = asString(value(row, "PlanTemplateID"));
    if (!variantId) continue;
    if (planTemplateId && !planTemplatesById.has(planTemplateId)) {
      warnings.push(`PlanTemplateVariant ${variantId} references missing template ${planTemplateId}.`);
    }
    pushDoc(docs, "planTemplateVariants", variantId, {
      variantId,
      planTemplateId,
      name: asString(value(row, "VariantName", "Name")) || variantId,
      durationMinutes: asNumber(value(row, "DurationMinutes")),
      sizeLabel: asString(value(row, "SizeLabel")),
      description: asString(value(row, "Description")),
      active: asBool(value(row, "Active")),
      isDefault: asBool(value(row, "IsDefault")),
      sortOrder: asNumber(value(row, "SortOrder")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.planTemplateSlots) {
    const slotId = asString(value(row, "SlotID"));
    const variantId = asString(value(row, "VariantID"));
    if (!slotId) continue;
    if (variantId && !planTemplateVariantsById.has(variantId)) {
      warnings.push(`PlanTemplateSlot ${slotId} references missing variant ${variantId}.`);
    }
    pushDoc(docs, "planTemplateSlots", slotId, {
      slotId,
      variantId,
      sectionName: asString(value(row, "SectionName")),
      slotName: asString(value(row, "SlotName")),
      allowedBlueprintType: canonicalType(value(row, "AllowedBlueprintType")),
      allowedBlueprintTemplateId: asString(value(row, "AllowedBlueprintTemplateID")),
      minBlueprints: asNumber(value(row, "MinBlueprints")),
      maxBlueprints: asNumber(value(row, "MaxBlueprints")),
      allowUnlimited: asBool(value(row, "AllowUnlimited")),
      required: asBool(value(row, "Required")),
      active: value(row, "Active") === null ? true : asBool(value(row, "Active")),
      sortOrder: asNumber(value(row, "SortOrder")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.plans) {
    const planId = asString(value(row, "PlanID"));
    if (!planId) continue;

    const tagIds = unique(planTagsById.get(planId) || []);
    const components = rows.planItems
      .filter((component) => asString(value(component, "PlanID")) === planId)
      .map((component) => {
        const blueprintId = asString(value(component, "BlueprintID"));
        const itemId = asString(value(component, "ItemID"));
        return {
          planItemId: asString(value(component, "PlanItemID")),
          componentKind: canonicalType(value(component, "ComponentKind")) ||
            (blueprintId ? "blueprint" : itemId ? "item" : null),
          blueprintId,
          itemId,
          sectionName: asString(value(component, "SectionName")),
          slotId: asString(value(component, "SlotID")),
          slotOrder: asNumber(value(component, "SlotOrder")),
          required: asBool(value(component, "IsRequiredSlot", "Required")),
          instructions: asString(value(component, "Instructions")),
        };
      })
      .sort((left, right) => (left.slotOrder ?? 999) - (right.slotOrder ?? 999));
    const linkedBlueprintIds = unique(components.map((component) => component.blueprintId));
    const linkedItemIds = unique(components.map((component) => component.itemId));
    const linkedPlanIds = unique([
      ...(relatedPlansByPlanId.get(planId) || []),
      ...asArray(value(row, "RelatedPlanIDs", "Related PlanIDs", "Related PlanID")),
    ]);

    pushDoc(docs, "plans", planId, {
      planId,
      name: asString(value(row, "PlanName", "Plan Name")),
      type: resolveEntityType(row, "Plan", entityTypeById),
      createsProduct: asBool(value(row, "CreatesProduct", "Creates Product", "Creates Product?")),
      conditionId: asString(value(row, "ConditionID")),
      tagIds,
      tags: tagIds
        .map((tagId) => asString(value(tagsById.get(tagId) ?? {}, "TagName", "Tag Name")))
        .filter(Boolean),
      planTemplateId: asString(value(row, "PlanTemplateID")),
      templateVariantId: asString(value(row, "TemplateVariantID")),
      goal: asString(value(row, "Goal")),
      audience: asString(value(row, "Audience")),
      accessType: asString(value(row, "Access Type")),
      ownerType: asString(value(row, "OwnerType")),
      ownerId: asString(value(row, "OwnerID")),
      visibility: asVisibility(value(row, "Visibility")),
      status: asContentStatus(value(row, "Status", "Publish Status", "ApprovalStatus")),
      sourcePlanId: asString(value(row, "SourcePlanID")),
      linkedBlueprintIds,
      linkedItemIds,
      linkedPlanIds,
      components,
      dosageEntries: planDosageById.get(planId) || [],
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.planItems) {
    const planItemId = asString(value(row, "PlanItemID"));
    const planId = asString(value(row, "PlanID"));
    const blueprintId = asString(value(row, "BlueprintID"));
    const itemId = asString(value(row, "ItemID"));
    if (!planItemId) continue;
    if (planId && !plansById.has(planId)) warnings.push(`PlanItem ${planItemId} references missing plan ${planId}.`);
    if (blueprintId && !blueprintsById.has(blueprintId)) {
      warnings.push(`PlanItem ${planItemId} references missing blueprint ${blueprintId}.`);
    }
    if (itemId && !itemsById.has(itemId)) warnings.push(`PlanItem ${planItemId} references missing item ${itemId}.`);
    if ((blueprintId && itemId) || (!blueprintId && !itemId)) {
      warnings.push(`PlanItem ${planItemId} must reference exactly one BlueprintID or ItemID.`);
    }

    pushDoc(docs, "planItems", planItemId, {
      planItemId,
      planId,
      componentKind: canonicalType(value(row, "ComponentKind")) ||
        (blueprintId ? "blueprint" : itemId ? "item" : null),
      blueprintId,
      itemId,
      slotId: asString(value(row, "SlotID")),
      sectionName: asString(value(row, "SectionName")),
      slotOrder: asNumber(value(row, "SlotOrder")),
      required: asBool(value(row, "IsRequiredSlot", "Required")),
      itemType: canonicalType(value(row, "Item Type", "ItemType")),
      soapSection: asString(value(row, "SOAP Section")),
      defaultDosage: asString(value(row, "Default Dosage")),
      defaultSoapLine: asString(value(row, "Default SOAP Line")),
      instructions: asString(value(row, "Instructions")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.planDosage) {
    const planDosageId = asString(value(row, "PlanDosageID"));
    const planId = asString(value(row, "PlanID"));
    const planItemId = asString(value(row, "PlanItemID"));
    if (!planDosageId) continue;
    if (planId && !plansById.has(planId)) {
      warnings.push(`PlanDosage ${planDosageId} references missing plan ${planId}.`);
    }
    pushDoc(docs, "planDosage", planDosageId, {
      planDosageId,
      planId,
      planItemId,
      sets: asString(value(row, "Sets")),
      reps: asString(value(row, "Reps")),
      time: asString(value(row, "Time")),
      dosage: asString(value(row, "Dosage")),
      dosageNotes: asString(value(row, "Dosage Notes")),
      regression: asString(value(row, "Regression")),
      progression: asString(value(row, "Progression")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.planLinks) {
    const planId = asString(value(row, "PlanID"));
    const relatedPlanId = asString(value(row, "RelatedPlanID"));
    if (!planId || !relatedPlanId) continue;
    const planLinkId = asString(value(row, "PlanLinkID", "LinkID")) ||
      `PLANLINK-${slugId(planId)}-${slugId(relatedPlanId)}`;
    pushDoc(docs, "planLinks", planLinkId, {
      planLinkId,
      planId,
      relatedPlanId,
      relationshipType: canonicalType(value(row, "RelationshipType")) || "related",
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.assets) {
    const assetId = asString(value(row, "AssetID"));
    if (!assetId) continue;
    if (canonicalAssetIds.has(assetId)) continue;
    if (!asString(value(row, "FileURL"))) {
      warnings.push(`Asset ${assetId} has no FileURL.`);
    }
    pushDoc(docs, "assets", assetId, {
      assetId,
      name: asString(value(row, "AssetName")),
      type: canonicalType(value(row, "Type", "AssetType")),
      title: asString(value(row, "Title")),
      altText: asString(value(row, "AltText")),
      fileUrl: asString(value(row, "FileURL")),
      thumbnailUrl: asString(value(row, "ThumbnailURL")),
      status: asStatus(value(row, "Status")),
      ownerUserId: asString(value(row, "OwnerUserID")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.itemAssets) {
    const itemAssetId = asString(value(row, "ItemAssetID"));
    const itemId = asString(value(row, "ItemID"));
    const assetId = asString(value(row, "AssetID"));
    if (!itemAssetId) continue;
    if (itemId && !itemsById.has(itemId)) warnings.push(`ItemAsset ${itemAssetId} references missing item ${itemId}.`);
    if (assetId && !assetsById.has(assetId)) {
      warnings.push(`ItemAsset ${itemAssetId} references missing asset ${assetId}.`);
    }

    pushDoc(docs, "itemAssets", itemAssetId, {
      itemAssetId,
      itemId,
      assetId,
      purpose: asString(value(row, "Purpose")),
      sortOrder: asNumber(value(row, "SortOrder")),
      displayStatus: asStatus(value(row, "DisplayStatus")),
      contextTitle: asString(value(row, "ContextTitle")),
      contextAltText: asString(value(row, "ContextAltText")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.variants) {
    const variantId = asString(value(row, "VariantID"));
    const itemId = asString(value(row, "ItemID"));
    if (!variantId) continue;
    if (itemId && !itemsById.has(itemId)) warnings.push(`Variant ${variantId} references missing item ${itemId}.`);

    const stock = (inventoryByVariantId.get(variantId) ?? [])
      .reduce((sum, inv) => sum + (asNumber(value(inv, "Stock Qty")) ?? 0), 0);

    pushDoc(docs, "itemVariants", variantId, {
      variantId,
      itemId,
      name: asString(value(row, "Variant Name")),
      colour: asString(value(row, "Colour")),
      size: asString(value(row, "Size")),
      sku: asString(value(row, "SKU")),
      priceOverride: (asNumber(value(row, "Price Override")) ?? 0) > 0
        ? asNumber(value(row, "Price Override"))
        : null,
      itemAssetId: asString(value(row, "ItemAssetID")),
      status: asStatus(value(row, "Status")),
      stock,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.prices) {
    const priceId = asString(value(row, "PriceID"));
    const productId = asString(value(row, "ProductID", "ItemProductID"));
    if (!productId) continue;
    if (!priceId) {
      warnings.push(`ProductPrice row for product ${productId} is missing PriceID.`);
      continue;
    }

    pushDoc(docs, "productPrices", priceId, {
      priceId,
      productId,
      variantId: asString(value(row, "VariantID")),
      currency: asString(value(row, "Currency")) || "AUD",
      retailPrice: asNumber(value(row, "RetailPrice")),
      salePrice: asNumber(value(row, "SalePrice")),
      onSale: asBool(value(row, "OnSale")),
      effectiveShopPrice: asNumber(value(row, "EffectiveShopPrice")),
      wholesaleCost: asNumber(value(row, "WholesaleCost")),
      gstIncluded: asBool(value(row, "GSTIncluded")),
      gstAmount: asNumber(value(row, "GSTAmount")),
      retailPriceExGst: asNumber(value(row, "RetailPriceExGST")),
      grossProfit: asNumber(value(row, "GrossProfit")),
      grossMarginPercent: asNumber(value(row, "GrossMarginPercent")),
      affiliatePrice: asNumber(value(row, "AffiliatePrice")),
      affiliateCommission: asNumber(value(row, "AffiliateCommission")),
      affiliateProfit: asNumber(value(row, "AffiliateProfit")),
      donationAmount: asNumber(value(row, "DonationAmount")),
      partnerShareAffiliate: asNumber(value(row, "PartnerShareAffiliate")),
      partnerShareRetail: asNumber(value(row, "PartnerShareRetail")),
      stripeProductId: asString(value(row, "stripeProductId")),
      stripePriceId: asString(value(row, "stripePriceId")),
      effectiveFrom: asDate(value(row, "EffectiveFrom")),
      effectiveTo: asDate(value(row, "EffectiveTo")),
      status: asStatus(value(row, "Status")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.inventory) {
    const inventoryId = asString(value(row, "Inventory ID"));
    if (!inventoryId) continue;
    pushDoc(docs, "inventory", inventoryId, {
      inventoryId,
      name: asString(value(row, "InventoryItemName")),
      itemId: asString(value(row, "ItemID")),
      variantId: asString(value(row, "VariantID")),
      partCost: asNumber(value(row, "Part Cost")),
      supplier: asString(value(row, "Part 1 Supplier")),
      stockQty: asNumber(value(row, "Stock Qty")) ?? 0,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.products) {
    const productId = asString(value(row, "ItemProductID"));
    const itemId = asString(value(row, "ItemID"));
    if (!productId) continue;
    if (canonicalProductIds.has(productId)) continue;

    const item = itemsById.get(itemId) ?? {};
    const productPrices = pricesByProductId.get(productId) ?? [];
    const activePrices = productPrices.filter((price) => asStatus(value(price, "Status")) === "active");
    const basePrice = activePrices.find((price) => !asString(value(price, "VariantID")));
    const lowestPrice = activePrices
      .map((price) => asNumber(value(price, "EffectiveShopPrice")))
      .filter((price) => price !== null)
      .sort((a, b) => a - b)[0] ?? null;

    const productAssets = (itemAssetsByItemId.get(itemId) ?? [])
      .map((link) => {
        const asset = assetsById.get(asString(value(link, "AssetID")));
        if (!asset) return null;
        return {
          assetId: asString(value(asset, "AssetID")),
          type: canonicalType(value(asset, "Type", "AssetType")),
          purpose: asString(value(link, "Purpose")),
          title: asString(value(link, "ContextTitle")) ?? asString(value(asset, "Title")),
          altText: asString(value(link, "ContextAltText")) ?? asString(value(asset, "AltText")),
          url: asString(value(asset, "FileURL")),
          thumbnailUrl: asString(value(asset, "ThumbnailURL")),
          sortOrder: asNumber(value(link, "SortOrder")) ?? 999,
          displayStatus: asStatus(value(link, "DisplayStatus")),
        };
      })
      .filter(Boolean)
      .filter((asset) => asset.url && ["active", "public"].includes(asset.displayStatus ?? "active"))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const images = productAssets
      .filter((asset) => asset.type === "image")
      .map((asset) => asset.url);

    if (images.length === 0) warnings.push(`Product ${productId} has no public image assets.`);
    if (!asString(value(row, "ProductShortDescription"))) {
      warnings.push(`Product ${productId} is missing ProductShortDescription.`);
    }
    if (!asString(value(row, "ProductLongDescription"))) {
      warnings.push(`Product ${productId} is missing ProductLongDescription.`);
    }
    if (activePrices.length === 0) warnings.push(`Product ${productId} has no active ProductPrice row.`);

    const itemVariants = (variantsByItemId.get(itemId) ?? [])
      .filter((variant) => asStatus(value(variant, "Status")) === "active");

    const stock = (inventoryByItemId.get(itemId) ?? [])
      .reduce((sum, inv) => sum + (asNumber(value(inv, "Stock Qty")) ?? 0), 0);

    pushDoc(docs, "products", productId, {
      productId,
      itemId,
      name: asString(value(row, "ProductTitle")),
      type: resolveEntityType(item, "Item", entityTypeById),
      productCategoryId: asString(value(row, "ProductCategoryID", "Product Category ID")),
      categoryId: asString(value(row, "ProductCategoryID", "Product Category ID")),
      tagIds: unique([
        ...asArray(value(item, "TagID")),
        ...(itemTagsById.get(itemId) || []),
      ]),
      shopStatus: asStatus(value(row, "Shop Status")),
      visible: asStatus(value(row, "Shop Status")) === "active" && asBool(value(item, "Website Visible")),
      websiteVisible: asBool(value(item, "Website Visible")),
      sortOrder: asNumber(value(row, "SortOrder")),
      featured: asBool(value(row, "Featured")),
      requiresShipping: asBool(value(row, "Requires Shipping")),
      sku: asString(value(row, "SKU")),
      shortDescription: asString(value(row, "ProductShortDescription")),
      longDescription: asString(value(row, "ProductLongDescription")),
      supplierType: asString(value(row, "Supplier Type")),
      unlocksAccess: asBool(value(row, "Unlocks access")),
      accessType: asString(value(row, "Access Type")),
      relatedPlanId: asString(value(row, "Related PlanID")),
      relatedCourseId: asString(value(row, "Related PlanCourseDetailID")),
      relatedWorkshopId: asString(value(row, "Related WorkshopID")),
      accessCodeEligible: asBool(value(row, "Access Code Eligible")),
      slug: asString(value(row, "slug")),
      price: asNumber(value(basePrice ?? {}, "EffectiveShopPrice")) ?? lowestPrice,
      priceFrom: lowestPrice,
      hasVariants: itemVariants.length > 0,
      stock,
      images,
      media: productAssets,
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const canonicalRows = {
    products: rows.canonicalProducts,
    productVariants: rows.productVariants,
    assets: rows.canonicalAssets,
    entityAssets: rows.entityAssets,
    assetRenditions: rows.assetRenditions,
  };

  const canonicalDocsByCollection = new Map();
  for (const [collection, sheetRows] of Object.entries(canonicalRows)) {
    const schema = CANONICAL_WORKBOOK_SCHEMAS[collection];
    const ids = new Set();
    for (const row of sheetRows) {
      const data = canonicalWorkbookData(row, schema);
      const id = asString(data[schema.idField]);
      if (!id) {
        if (Object.keys(data).length) warnings.push(`${schema.sheet} row is missing ${schema.fields[0].workbook}.`);
        continue;
      }
      if (ids.has(id)) {
        warnings.push(`${schema.sheet} contains duplicate ID ${id}.`);
        continue;
      }
      ids.add(id);
      const errors = validateCanonicalRecord(collection, data);
      if (errors.length) warnings.push(`${schema.sheet} ${id}: ${errors.join("; ")}.`);
      if (collection === "products") {
        data.name = data.productName;
        data.shopStatus = data.status;
        data.websiteVisible = data.visible === true;
        data.price = data.basePrice;
        data.priceFrom = data.basePrice;
      }
      if (collection === "productVariants") {
        data.name = data.variantName;
        data.stock = data.stockQuantity ?? 0;
        if (data.requiresShippingOverride === undefined && data.requiresShipping !== undefined) {
          data.requiresShippingOverride = data.requiresShipping;
        }
      }
      pushDoc(docs, collection, id, {
        ...data,
        importSourceSheet: schema.sheet,
        updatedAt: data.updatedAt || FieldValue.serverTimestamp(),
      });
    }
    canonicalDocsByCollection.set(collection, ids);
  }

  const productConnectionIds = new Set();
  const variantContentLinksByProduct = new Map();
  for (const row of rows.productConnections) {
    const connectionId = asString(value(row, "ProductConnectionID"));
    const productId = asString(value(row, "ProductID"));
    const productVariantId = asString(value(row, "ProductVariantID"));
    const entityType = asString(value(row, "EntityType"));
    const entityId = asString(value(row, "EntityID"));
    const entityVariantId = asString(value(row, "EntityVariantID"));
    const connectionType = asString(value(row, "ConnectionType"));
    if (!connectionId) continue;
    if (productConnectionIds.has(connectionId)) {
      warnings.push(`ProductConnections contains duplicate ID ${connectionId}.`);
      continue;
    }
    productConnectionIds.add(connectionId);
    if (!productId || !entityType || !entityId || !connectionType) {
      warnings.push(`ProductConnections ${connectionId} is missing ProductID, EntityType, EntityID, or ConnectionType.`);
      continue;
    }
    const status = asStatus(value(row, "Status")) || "active";
    if (connectionType === "Unlocks") {
      pushDoc(docs, "productAccessGrants", connectionId, {
        productAccessGrantId: connectionId,
        productId,
        productVariantId,
        accessEntityType: entityType,
        accessEntityId: entityId,
        accessEntityVariantId: entityVariantId,
        grantTiming: asString(value(row, "GrantTiming")) || "on-payment-confirmed",
        durationType: asString(value(row, "DurationType")) || "permanent",
        durationValue: asNumber(value(row, "DurationValue")),
        startsAt: asDate(value(row, "StartsAt")),
        endsAt: asDate(value(row, "EndsAt")),
        revocable: true,
        status,
        notes: asString(value(row, "Notes")),
        importSourceSheet: "ProductConnections",
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      pushDoc(docs, "productLinks", connectionId, {
        productLinkId: connectionId,
        productId,
        linkedEntityType: entityType,
        linkedEntityId: entityId,
        linkedEntityVariantId: entityVariantId,
        linkRole: connectionType,
        isPrimary: asBool(value(row, "IsPrimary")),
        variantSpecific: Boolean(productVariantId || entityVariantId),
        productVariantId,
        status,
        notes: asString(value(row, "Notes")),
        importSourceSheet: "ProductConnections",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (productVariantId || entityVariantId) {
      const links = variantContentLinksByProduct.get(productId) || [];
      links.push({
        productVariantId,
        entityType,
        entityId,
        entityVariantId,
        linkRole: connectionType,
        status,
      });
      variantContentLinksByProduct.set(productId, links);
    }
  }
  for (const doc of docs.filter((entry) => entry.collection === "products")) {
    const variantContentLinks = variantContentLinksByProduct.get(doc.id);
    if (variantContentLinks?.length) doc.data.variantContentLinks = variantContentLinks;
    const manufacturing = rows.productConnections.find((row) =>
      asString(value(row, "ProductID")) === doc.id &&
      asString(value(row, "ConnectionType")) === "ManufacturedFrom" &&
      asString(value(row, "EntityType")) === "Blueprint");
    if (manufacturing) doc.data.manufacturingBlueprintId = asString(value(manufacturing, "EntityID"));
  }

  const productIds = canonicalDocsByCollection.get("products") || new Set();
  rows.products.forEach((row) => {
    const id = asString(value(row, "ItemProductID"));
    if (id) productIds.add(id);
  });
  const targetAssetIds = canonicalDocsByCollection.get("assets") || new Set();
  rows.assets.forEach((row) => {
    const id = asString(value(row, "AssetID"));
    if (id) targetAssetIds.add(id);
  });

  const productLinkKeys = new Set();
  const primaryRepresentsByProduct = new Map();
  for (const row of rows.productConnections) {
    const id = asString(value(row, "ProductConnectionID"));
    const productId = asString(value(row, "ProductID"));
    const entityType = asString(value(row, "EntityType"));
    const entityId = asString(value(row, "EntityID"));
    const linkRole = asString(value(row, "ConnectionType"));
    if (id && productId && !productIds.has(productId)) {
      warnings.push(`ProductConnections ${id} references missing Product ${productId}.`);
    }
    const entityMaps = { Item: itemsById, Blueprint: blueprintsById, Plan: plansById };
    if (id && entityMaps[entityType] && entityId && !entityMaps[entityType].has(entityId)) {
      warnings.push(`ProductConnections ${id} references missing ${entityType} ${entityId}.`);
    }
    if (id && !["Item", "Blueprint", "Plan"].includes(entityType)) {
      warnings.push(`ProductConnections ${id} has invalid EntityType ${entityType}.`);
    }
    if (id && !["Represents", "ManufacturedFrom", "Unlocks", "Includes"].includes(linkRole)) {
      warnings.push(`ProductConnections ${id} has invalid ConnectionType ${linkRole}.`);
    }
    const uniqueKey = [
      productId,
      asString(value(row, "ProductVariantID")),
      entityType,
      entityId,
      asString(value(row, "EntityVariantID")),
      linkRole,
    ].join("|");
    if (id && productLinkKeys.has(uniqueKey)) {
      warnings.push(`ProductConnections ${id} duplicates ${uniqueKey}.`);
    }
    if (id) productLinkKeys.add(uniqueKey);
    if (productId && linkRole === "Represents" && asBool(value(row, "IsPrimary"))) {
      primaryRepresentsByProduct.set(productId, (primaryRepresentsByProduct.get(productId) || 0) + 1);
    }
  }
  for (const [productId, count] of primaryRepresentsByProduct) {
    if (count > 1) warnings.push(`Product ${productId} has ${count} primary Represents links; expected at most one.`);
  }

  for (const row of rows.entityAssets) {
    const id = asString(value(row, "EntityAssetID"));
    const assetId = asString(value(row, "AssetID"));
    if (id && assetId && !targetAssetIds.has(assetId)) {
      warnings.push(`EntityAssets ${id} references missing Asset ${assetId}.`);
    }
  }

  const canonicalIds = (collection) => canonicalDocsByCollection.get(collection) || new Set();
  for (const row of rows.productVariants) {
    const id = asString(value(row, "ProductVariantID"));
    const productId = asString(value(row, "ProductID"));
    if (id && productId && !productIds.has(productId)) {
      warnings.push(`ProductVariants ${id} references missing Product ${productId}.`);
    }
  }
  const productVariantIds = canonicalIds("productVariants");
  for (const row of rows.prices) {
    const id = asString(value(row, "PriceID"));
    const productId = asString(value(row, "ProductID", "ItemProductID"));
    const variantId = asString(value(row, "VariantID"));
    if (id && productId && !productIds.has(productId)) {
      warnings.push(`ProductPrice ${id} references missing Product ${productId}.`);
    }
    if (id && variantId && !productVariantIds.has(variantId)) {
      warnings.push(`ProductPrice ${id} references missing ProductVariant ${variantId}.`);
    }
  }
  for (const row of rows.productOptions) {
    const id = asString(value(row, "ProductOptionID"));
    const productId = asString(value(row, "ProductID"));
    if (id && productId && !productIds.has(productId)) {
      warnings.push(`ProductOptions ${id} references missing Product ${productId}.`);
    }
  }
  for (const row of rows.productOptionValues) {
    const id = asString(value(row, "ProductOptionValueID"));
    const optionId = asString(value(row, "ProductOptionID"));
    if (id && optionId && !canonicalIds("productOptions").has(optionId)) {
      warnings.push(`ProductOptionValues ${id} references missing ProductOption ${optionId}.`);
    }
  }
  for (const row of rows.productVariantValues) {
    const id = asString(value(row, "ProductVariantValueID"));
    const variantId = asString(value(row, "ProductVariantID"));
    const optionValueId = asString(value(row, "ProductOptionValueID"));
    if (id && variantId && !canonicalIds("productVariants").has(variantId)) {
      warnings.push(`ProductVariantValues ${id} references missing ProductVariant ${variantId}.`);
    }
    if (id && optionValueId && !canonicalIds("productOptionValues").has(optionValueId)) {
      warnings.push(`ProductVariantValues ${id} references missing ProductOptionValue ${optionValueId}.`);
    }
  }
  for (const row of rows.productComponents) {
    const id = asString(value(row, "ProductComponentID"));
    const productId = asString(value(row, "ProductID"));
    const itemId = asString(value(row, "ItemID"));
    if (id && productId && !productIds.has(productId)) {
      warnings.push(`ProductComponents ${id} references missing Product ${productId}.`);
    }
    if (id && itemId && !itemsById.has(itemId)) {
      warnings.push(`ProductComponents ${id} references missing Item ${itemId}.`);
    }
  }
  for (const row of rows.productAccessGrants) {
    const id = asString(value(row, "ProductAccessGrantID"));
    const productId = asString(value(row, "ProductID"));
    if (id && productId && !productIds.has(productId)) {
      warnings.push(`ProductAccessGrants ${id} references missing Product ${productId}.`);
    }
  }
  for (const row of rows.assetRenditions) {
    const id = asString(value(row, "AssetRenditionID"));
    const assetId = asString(value(row, "AssetID"));
    if (id && assetId && !targetAssetIds.has(assetId)) {
      warnings.push(`AssetRenditions ${id} references missing Asset ${assetId}.`);
    }
  }

  for (const row of rows.instructors) {
    const instructorId = asString(value(row, "InstructorID"));
    if (!instructorId) continue;
    pushDoc(docs, "instructors", instructorId, {
      instructorId,
      name: asString(value(row, "InstructorName", "Name")) || instructorId,
      email: asString(value(row, "Email")),
      phone: asString(value(row, "Phone")),
      userId: asString(value(row, "UserID")),
      bio: asString(value(row, "Bio", "Description")),
      status: asStatus(value(row, "Status")) || "active",
      ownerType: asString(value(row, "OwnerType")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.users) {
    const userId = asString(value(row, "UserID"));
    if (!userId) continue;
    pushDoc(docs, "users", userId, {
      userId,
      name: asString(value(row, "Name")),
      phone: asString(value(row, "Phone")),
      email: asString(value(row, "Email")),
      defaultShippingAddress: {
        line1: asString(value(row, "Shipping Address Line 1")),
        line2: asString(value(row, "Shipping Address Line 2")),
        city: asString(value(row, "City")),
        postcode: asString(value(row, "Post Code")),
      },
      billingSameAsShipping: asBool(value(row, "Billing Address Same as Shipping?")),
      business: {
        abn: asString(value(row, "ABN")),
        type: asString(value(row, "Business Type")),
        address: asString(value(row, "Business Address")),
        phone: asString(value(row, "Business Phone")),
        email: asString(value(row, "Business Email")),
      },
      stripeCustomerId: asString(value(row, "StripeCustomerID")),
      status: asStatus(value(row, "UserStatus")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const simpleSheets = [
    ["orders", rows.orders, "OrderID"],
    ["orderItems", rows.orderItems, "OrderItemID"],
    ["customerAddresses", rows.customerAddresses, "AddressID"],
    ["shipments", rows.shipments, "ShipmentID"],
    ["stripeEvents", rows.stripeEvents, "StripeEventID"],
    ["userAccess", rows.userAccess, "UserAccessID"],
  ];

  for (const [collection, sheetRows, idColumn] of simpleSheets) {
    for (const row of sheetRows) {
      const id = asString(value(row, idColumn));
      if (!id) continue;
      const data = {};
      for (const [key, entry] of Object.entries(row)) {
        const field = key.replace(/(?:^|\s)([a-z0-9])/g, (_, char) => char.toUpperCase());
        const camel = field.charAt(0).toLowerCase() + field.slice(1);
        data[camel] = entry;
      }
      data.updatedAt = FieldValue.serverTimestamp();
      pushDoc(docs, collection, id, data);
    }
  }

  for (const doc of docs) {
    const sourceWorkbook = path.basename(workbookPath || "Recovery Tools Master Database.xlsx");
    const versionMatch = sourceWorkbook.match(/\((\d+)\)\.(?:xlsx|xlsm)$/i);
    doc.data.managedByWorkbook = true;
    const sourceSheet = doc.data.importSourceSheet || COLLECTION_SHEETS[doc.collection] || doc.collection;
    delete doc.data.importSourceSheet;
    doc.data.importSource = {
      sourceSheet,
      sourceWorkbook,
      sourceWorkbookVersion: versionMatch?.[1] || null,
      importerVersion: "5",
      lastImportedAt: FieldValue.serverTimestamp(),
    };
    if (["items", "blueprints", "plans"].includes(doc.collection) && !doc.data.type) {
      warnings.push(`${doc.collection}/${doc.id} has no resolved Type.`);
    }
  }

  const counts = Object.fromEntries(COLLECTIONS.map((collection) => [collection, 0]));
  for (const doc of docs) counts[doc.collection] += 1;

  return { docs, warnings, counts };
}

const COMPARISON_OMIT_KEYS = new Set(["updatedAt", "importSource"]);

function comparableValue(value, incomingShape = value, key = "") {
  if (COMPARISON_OMIT_KEYS.has(key)) return undefined;
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(incomingShape)) {
    const source = Array.isArray(value) ? value : [];
    return source.map((entry, index) => comparableValue(
      entry,
      incomingShape[index] ?? entry,
    ));
  }

  const output = {};
  const shape = incomingShape && typeof incomingShape === "object" ? incomingShape : {};
  for (const childKey of Object.keys(shape).sort()) {
    const child = comparableValue(value?.[childKey], shape[childKey], childKey);
    if (child !== undefined) output[childKey] = child;
  }
  return output;
}

function workbookFieldsChanged(existing, incoming) {
  const current = comparableValue(existing, incoming);
  const next = comparableValue(incoming, incoming);
  return JSON.stringify(current) !== JSON.stringify(next);
}

async function reconcileDocs(db, docs) {
  const incomingByCollection = new Map();
  for (const doc of docs) {
    const collectionDocs = incomingByCollection.get(doc.collection) || [];
    collectionDocs.push(doc);
    incomingByCollection.set(doc.collection, collectionDocs);
  }

  const newDocs = [];
  const updateDocs = [];
  const collections = {};
  const summary = {
    incoming: 0,
    new: 0,
    workbookUpdates: 0,
    workbookUnchanged: 0,
    appCollisionsPreserved: 0,
    appCreatedOnlyPreserved: 0,
    workbookManagedMissing: 0,
  };

  for (const collection of COLLECTIONS) {
    const incoming = incomingByCollection.get(collection) || [];
    const incomingIds = new Set(incoming.map((doc) => doc.id));
    const snapshot = await db.collection(collection).get();
    const existingById = new Map(snapshot.docs.map((doc) => [doc.id, doc]));
    const newIds = [];
    const workbookUpdateIds = [];
    const workbookUnchangedIds = [];
    const appCollisionPreservedIds = [];

    for (const doc of incoming) {
      const existing = existingById.get(doc.id);
      if (!existing) {
        newIds.push(doc.id);
        newDocs.push(doc);
      } else if (existing.data()?.managedByWorkbook === true) {
        if (workbookFieldsChanged(existing.data(), doc.data)) {
          workbookUpdateIds.push(doc.id);
          updateDocs.push(doc);
        } else {
          workbookUnchangedIds.push(doc.id);
        }
      } else {
        appCollisionPreservedIds.push(doc.id);
      }
    }

    const appCreatedOnlyPreservedIds = [];
    const workbookManagedMissingIds = [];
    for (const existing of snapshot.docs) {
      if (incomingIds.has(existing.id)) continue;
      if (existing.data()?.managedByWorkbook === true) {
        workbookManagedMissingIds.push(existing.id);
      } else {
        appCreatedOnlyPreservedIds.push(existing.id);
      }
    }

    collections[collection] = {
      incoming: incoming.length,
      new: newIds.length,
      workbookUpdates: workbookUpdateIds.length,
      workbookUnchanged: workbookUnchangedIds.length,
      appCollisionsPreserved: appCollisionPreservedIds.length,
      appCreatedOnlyPreserved: appCreatedOnlyPreservedIds.length,
      workbookManagedMissing: workbookManagedMissingIds.length,
      newIds,
      workbookUpdateIds,
      workbookUnchangedIds,
      appCollisionPreservedIds,
      appCreatedOnlyPreservedIds,
      workbookManagedMissingIds,
    };
    summary.incoming += incoming.length;
    summary.new += newIds.length;
    summary.workbookUpdates += workbookUpdateIds.length;
    summary.workbookUnchanged += workbookUnchangedIds.length;
    summary.appCollisionsPreserved += appCollisionPreservedIds.length;
    summary.appCreatedOnlyPreserved += appCreatedOnlyPreservedIds.length;
    summary.workbookManagedMissing += workbookManagedMissingIds.length;
  }

  return {
    newDocs,
    updateDocs,
    report: {
      generatedAt: new Date().toISOString(),
      mode: "workbook-managed-merge",
      safety: "Only changed workbook fields merge into workbook-managed IDs. " +
        "App-owned collisions and missing rows are preserved.",
      summary,
      collections,
    },
  };
}

function printReconciliation(report) {
  console.log("\nWorkbook-managed merge reconciliation:");
  console.log(JSON.stringify(report.summary, null, 2));
  console.log("\nCollection summary:");
  for (const [collection, counts] of Object.entries(report.collections)) {
    if (
      counts.incoming === 0 &&
      counts.appCreatedOnlyPreserved === 0 &&
      counts.workbookManagedMissing === 0
    ) continue;
    console.log(
      `- ${collection}: ${counts.new} new, ${counts.workbookUpdates} workbook updates, ` +
      `${counts.workbookUnchanged} unchanged, ${counts.appCollisionsPreserved} app collisions preserved, ` +
      `${counts.appCreatedOnlyPreserved} app-only preserved, ` +
      `${counts.workbookManagedMissing} workbook-missing preserved`,
    );
  }
}

async function writeReconciliationReport(reportPath, report, workbookPath) {
  const resolved = path.resolve(reportPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, JSON.stringify({
    ...report,
    workbook: path.resolve(workbookPath),
  }, null, 2));
  console.log(`\nReconciliation report written to ${resolved}`);
}

async function commitReconciledDocs(db, newDocs, updateDocs) {
  let batch = db.batch();
  let opCount = 0;
  const operations = [
    ...newDocs.map((doc) => ({ mode: "create", doc })),
    ...updateDocs.map((doc) => ({ mode: "merge", doc })),
  ];

  for (const operation of operations) {
    const { doc } = operation;
    const ref = db.collection(doc.collection).doc(doc.id);
    if (operation.mode === "create") batch.create(ref, doc.data);
    else batch.set(ref, doc.data, { merge: true });
    opCount += 1;

    if (opCount === 400) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await batch.commit();
  }

  return { created: newDocs.length, updated: updateDocs.length };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.workbookPath) {
    console.error(usage());
    process.exit(1);
  }

  if (options.live && !options.confirmLive) {
    console.error("Refusing live import without --confirm-live.");
    process.exit(1);
  }

  if (options.dryRun && options.reconcile) {
    console.error("Use --emulator or --live with --reconcile so Firestore can be compared.");
    process.exit(1);
  }

  if (!options.dryRun && !options.emulator && !options.live) {
    console.error("Choose one target: --dry-run, --emulator, or --live.");
    console.error(usage());
    process.exit(1);
  }

  if ((options.emulator || options.dryRun) && !process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "recovery-tools";
    process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  }

  if (!admin.apps.length) admin.initializeApp();

  const workbook = XLSX.readFile(options.workbookPath, {
    cellDates: true,
  });
  const { docs, warnings, counts } = buildDocs(workbook, options.workbookPath);

  console.log("Import target:", options.live ? "LIVE" : options.dryRun ? "DRY RUN" : "EMULATOR");
  console.log("Workbook:", options.workbookPath);
  console.log("Document counts:", JSON.stringify(counts, null, 2));

  if (warnings.length > 0) {
    console.warn("\nWarnings:");
    for (const warning of warnings) console.warn("-", warning);
  }

  if (options.dryRun) {
    console.log("\nDry run complete. No Firestore writes performed.");
    return;
  }

  const { newDocs, updateDocs, report } = await reconcileDocs(admin.firestore(), docs);
  printReconciliation(report);
  if (options.reportPath) {
    await writeReconciliationReport(options.reportPath, report, options.workbookPath);
  }

  if (options.reconcile) {
    console.log("\nReconciliation complete. No Firestore writes performed.");
    return;
  }

  const committed = await commitReconciledDocs(admin.firestore(), newDocs, updateDocs);
  console.log(`\nCreated ${committed.created} new Firestore documents.`);
  console.log(`Merged changed workbook fields into ${committed.updated} workbook-managed documents.`);
  console.log(`Preserved ${report.summary.appCollisionsPreserved} app-owned ID collisions.`);
  console.log("No documents were deleted or archived; app-only fields remain intact during merge updates.");
}

main().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
