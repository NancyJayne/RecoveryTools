import fs from "node:fs/promises";
import path from "node:path";
import admin from "firebase-admin";

const MIGRATION_VERSION = "product-asset-v1";
const TARGET_COLLECTIONS = [
  "products",
  "productLinks",
  "productOptions",
  "productOptionValues",
  "productVariants",
  "productVariantValues",
  "productComponents",
  "productAccessGrants",
  "assets",
  "entityAssets",
  "assetRenditions",
  "items",
  "blueprints",
  "plans",
];
const LEGACY_COLLECTIONS = ["productPrices", "itemVariants", "itemAssets"];
const OMIT_COMPARE_KEYS = new Set(["updatedAt", "migratedAt"]);

function parseArgs(argv) {
  const options = { dryRun: false, emulator: false, reportPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--emulator") options.emulator = true;
    else if (arg === "--report") {
      options.reportPath = argv[index + 1] || null;
      index += 1;
    }
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/migrateProductAssetArchitecture.js --dry-run [--report report.json]",
    "  node scripts/migrateProductAssetArchitecture.js --emulator [--report report.json]",
    "",
    "Both modes target the local Firestore emulator. Live migration is intentionally unsupported.",
  ].join("\n");
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value);
}

function slug(value) {
  return cleanString(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "UNKNOWN";
}

function cleanObject(value) {
  if (Array.isArray(value)) return value.map(cleanObject).filter((entry) => entry !== undefined);
  if (!value || typeof value !== "object" || typeof value.toDate === "function") return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    const cleaned = cleanObject(entry);
    if (cleaned !== undefined && cleaned !== null && cleaned !== "") output[key] = cleaned;
  }
  return output;
}

function normalizeStatus(value, fallback = "draft") {
  return cleanString(value).toLowerCase().replace(/\s+/g, "-") || fallback;
}

function productType(product) {
  const canonicalType = cleanString(product.productType);
  const canonicalTypes = new Set([
    "Physical", "Digital Download", "Plan Access", "Course Access",
    "Workshop Registration", "Program Access", "Service", "Bundle",
    "Membership", "Mixed",
  ]);
  if (canonicalTypes.has(canonicalType)) return canonicalType;
  const type = cleanString(product.productType || product.type).toLowerCase();
  if (product.requiresShipping !== false && !["course", "workshop", "program", "digital", "session"].includes(type)) {
    return "Physical";
  }
  if (type === "course") return "Course Access";
  if (type === "workshop") return "Workshop Registration";
  if (type === "program") return "Program Access";
  if (type === "service" || type === "session") return "Service";
  if (product.unlocksAccess || product.relatedPlanId) return "Plan Access";
  return "Digital Download";
}

function comparable(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(comparable);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (OMIT_COMPARE_KEYS.has(key)) continue;
    const child = comparable(value[key]);
    if (child !== undefined) output[key] = child;
  }
  return output;
}

function patchChanged(existing, patch) {
  const current = {};
  for (const key of Object.keys(patch)) current[key] = existing?.[key];
  return JSON.stringify(comparable(current)) !== JSON.stringify(comparable(patch));
}

function addDesired(desired, collection, id, data, source) {
  if (!id) return;
  if (!desired.has(collection)) desired.set(collection, new Map());
  const collectionDocs = desired.get(collection);
  if (collectionDocs.has(id)) {
    const existing = collectionDocs.get(id);
    collectionDocs.set(id, {
      data: cleanObject({ ...existing.data, ...data }),
      source: `${existing.source}; ${source}`,
    });
    return;
  }
  collectionDocs.set(id, { data: cleanObject(data), source });
}

async function snapshotsByCollection(db, collections) {
  const entries = await Promise.all(collections.map(async (collection) => {
    const snapshot = await db.collection(collection).get();
    return [collection, new Map(snapshot.docs.map((doc) => [doc.id, doc.data() || {}]))];
  }));
  return new Map(entries);
}

function entityAssetData({ id, assetId, entityType, entityId, role, fieldKey, sortOrder, displayStatus }) {
  return {
    entityAssetId: id,
    assetId,
    entityType,
    entityId,
    assetRole: role || "SupportingResource",
    fieldKey: fieldKey || "",
    isPrimary: Number(sortOrder ?? 999) === 1,
    sortOrder: Number(sortOrder ?? 999),
    displayStatus: normalizeStatus(displayStatus, "active"),
    visibility: ["public", "active"].includes(normalizeStatus(displayStatus, "active")) ? "users" : "private",
    status: normalizeStatus(displayStatus, "active") === "archived" ? "archived" : "active",
    migrationVersion: MIGRATION_VERSION,
    legacyItemAssetId: id,
  };
}

function accessTargets(product) {
  const targets = [];
  const candidates = [
    ["Plan", product.relatedPlanId],
    ["Plan", product.relatedCourseId],
    ["Plan", product.relatedWorkshopId],
  ];
  for (const [type, id] of candidates) {
    const cleanId = cleanString(id);
    if (cleanId && !targets.some((target) => target.id === cleanId)) targets.push({ type, id: cleanId });
  }
  return targets;
}

function buildDesired(existing, warnings) {
  const desired = new Map();
  const products = existing.get("products") || new Map();
  const items = existing.get("items") || new Map();
  const blueprints = existing.get("blueprints") || new Map();
  const plans = existing.get("plans") || new Map();
  const prices = existing.get("productPrices") || new Map();
  const variants = existing.get("itemVariants") || new Map();
  const assets = existing.get("assets") || new Map();
  const itemAssets = existing.get("itemAssets") || new Map();
  const pricesByProduct = new Map();
  const productsByItem = new Map();

  for (const [priceId, price] of prices) {
    if (!price.productId) {
      warnings.push(`productPrices/${priceId} has no productId.`);
      continue;
    }
    const list = pricesByProduct.get(price.productId) || [];
    list.push({ id: priceId, ...price });
    pricesByProduct.set(price.productId, list);
  }

  for (const [productId, product] of products) {
    const itemId = cleanString(product.itemId);
    if (itemId) {
      const list = productsByItem.get(itemId) || [];
      list.push(productId);
      productsByItem.set(itemId, list);
    }
    const activePrices = (pricesByProduct.get(productId) || [])
      .filter((price) => normalizeStatus(price.status, "active") === "active");
    const defaultPrice = activePrices.find((price) => !price.variantId) || activePrices[0] || {};
    const basePrice = Number(
      product.basePrice ?? product.price ?? product.priceFrom ?? defaultPrice.effectiveShopPrice ?? 0,
    );
    const canonical = {
      productId,
      productName: cleanString(product.productName || product.name || product.title || productId),
      productType: productType(product),
      productCategoryId: cleanString(product.productCategoryId || product.categoryId),
      status: normalizeStatus(product.status || product.shopStatus, "draft"),
      shopStatus: normalizeStatus(product.shopStatus, "draft"),
      approvalStatus: normalizeStatus(product.approvalStatus, "draft"),
      marketplaceVisibility: cleanString(product.marketplaceVisibility || (product.visible ? "users" : "private")),
      websiteVisible: product.websiteVisible ?? product.visible ?? false,
      soldByRecoveryTools: product.soldByRecoveryTools ?? true,
      sellerUserId: cleanString(product.sellerUserId || product.creatorId),
      creatorUserId: cleanString(product.creatorUserId || product.creatorId),
      ownerUserId: cleanString(product.ownerUserId || product.ownerId),
      featured: product.featured === true,
      sortOrder: Number(product.sortOrder ?? 999),
      slug: cleanString(product.slug),
      shortDescription: cleanString(product.shortDescription || product.description),
      longDescription: cleanString(product.longDescription || product.description),
      fulfilmentType: product.requiresShipping === false ? "digital" : "shipping",
      requiresShipping: product.requiresShipping !== false,
      isDigital: product.requiresShipping === false,
      isFree: basePrice === 0,
      currency: cleanString(product.currency || defaultPrice.currency || "AUD").toUpperCase(),
      basePrice,
      compareAtPrice: Number(product.compareAtPrice ?? product.retailPrice ?? defaultPrice.retailPrice ?? basePrice),
      taxable: product.taxable ?? true,
      taxCode: cleanString(product.taxCode),
      inventoryTracked: product.inventoryTracked ?? product.requiresShipping !== false,
      stockStatus: cleanString(product.stockStatus || (Number(product.stock ?? 0) > 0 ? "in-stock" : "out-of-stock")),
      stripeProductId: cleanString(product.stripeProductId || defaultPrice.stripeProductId),
      defaultStripePriceId: cleanString(product.defaultStripePriceId || defaultPrice.stripePriceId),
      primaryAssetId: cleanString(product.primaryAssetId || product.media?.[0]?.assetId),
      accessCodeEligible: product.accessCodeEligible === true,
      migrationVersion: MIGRATION_VERSION,
      legacyItemId: itemId,
    };
    addDesired(desired, "products", productId, canonical, `products/${productId}`);

    if (itemId) {
      if (!items.has(itemId)) warnings.push(`Product ${productId} references missing Item ${itemId}.`);
      const id = `PLINK-${slug(productId)}-ITEM-${slug(itemId)}-REPRESENTS`;
      addDesired(desired, "productLinks", id, {
        productLinkId: id,
        productId,
        linkedEntityType: "Item",
        linkedEntityId: itemId,
        linkRole: "Represents",
        quantity: 1,
        isPrimary: true,
        sortOrder: 1,
        required: true,
        variantSpecific: false,
        status: "active",
        migrationVersion: MIGRATION_VERSION,
      }, `products/${productId}.itemId`);
      addDesired(desired, "items", itemId, {
        createsProduct: true,
        migrationVersion: MIGRATION_VERSION,
      }, `products/${productId}.itemId`);
    }

    for (const target of accessTargets(product)) {
      if (target.type === "Plan" && !plans.has(target.id)) {
        warnings.push(`Product ${productId} unlocks missing Plan ${target.id}.`);
        continue;
      }
      const linkId = `PLINK-${slug(productId)}-${slug(target.type)}-${slug(target.id)}-UNLOCKS`;
      addDesired(desired, "productLinks", linkId, {
        productLinkId: linkId,
        productId,
        linkedEntityType: target.type,
        linkedEntityId: target.id,
        linkRole: "Unlocks",
        quantity: 1,
        isPrimary: false,
        sortOrder: 10,
        required: true,
        variantSpecific: false,
        status: "active",
        migrationVersion: MIGRATION_VERSION,
      }, `products/${productId} access fields`);
      const grantId = `PAGRANT-${slug(productId)}-${slug(target.type)}-${slug(target.id)}`;
      addDesired(desired, "productAccessGrants", grantId, {
        productAccessGrantId: grantId,
        productId,
        accessEntityType: target.type,
        accessEntityId: target.id,
        grantTiming: "on-payment-confirmed",
        durationType: "permanent",
        revocable: true,
        status: "active",
        migrationVersion: MIGRATION_VERSION,
      }, `products/${productId} access fields`);
      if (target.type === "Plan") {
        addDesired(desired, "plans", target.id, {
          createsProduct: true,
          migrationVersion: MIGRATION_VERSION,
        }, `products/${productId} access fields`);
      }
    }
  }

  for (const [variantId, variant] of variants) {
    if (normalizeStatus(variant.status, "active") !== "active") continue;
    const productCandidates = productsByItem.get(cleanString(variant.itemId)) || [];
    if (!productCandidates.length) {
      warnings.push(`itemVariants/${variantId} has no Product for Item ${variant.itemId || "(blank)"}.`);
      continue;
    }
    if (productCandidates.length > 1) {
      warnings.push(`itemVariants/${variantId} matches multiple Products: ${productCandidates.join(", ")}.`);
    }
    const productId = productCandidates[0];
    const variantPrices = (pricesByProduct.get(productId) || []).filter((price) => price.variantId === variantId);
    const price = variantPrices.find((entry) =>
      normalizeStatus(entry.status, "active") === "active") || variantPrices[0] || {};
    addDesired(desired, "productVariants", variantId, {
      productVariantId: variantId,
      productId,
      variantName: cleanString(variant.name || [variant.colour, variant.size].filter(Boolean).join(" / ") || variantId),
      variantCode: cleanString(variant.variantCode || variantId),
      sku: cleanString(variant.sku),
      status: normalizeStatus(variant.status, "active"),
      isDefault: variant.isDefault === true,
      optionSummary: [variant.colour, variant.size].filter(Boolean).join(" / "),
      priceOverride: Number(variant.priceOverride ?? price.effectiveShopPrice ?? 0),
      compareAtPriceOverride: Number(price.retailPrice ?? variant.priceOverride ?? 0),
      currency: cleanString(price.currency || "AUD").toUpperCase(),
      inventoryTracked: true,
      stockQuantity: Number(variant.stock ?? 0),
      stockStatus: Number(variant.stock ?? 0) > 0 ? "in-stock" : "out-of-stock",
      stripeProductId: cleanString(price.stripeProductId),
      stripePriceId: cleanString(price.stripePriceId),
      sortOrder: Number(variant.sortOrder ?? 999),
      legacyItemId: cleanString(variant.itemId),
      legacyItemVariantId: variantId,
      migrationVersion: MIGRATION_VERSION,
    }, `itemVariants/${variantId}`);

    for (const [optionName, optionValue] of [["Colour", variant.colour], ["Size", variant.size]]) {
      if (!cleanString(optionValue)) continue;
      const optionId = `POPT-${slug(productId)}-${slug(optionName)}`;
      const valueId = `POVAL-${slug(optionId)}-${slug(optionValue)}`;
      const relationId = `PVVAL-${slug(variantId)}-${slug(valueId)}`;
      if (!(desired.get("productOptions")?.has(optionId))) {
        addDesired(desired, "productOptions", optionId, {
          productOptionId: optionId, productId, optionName, sortOrder: optionName === "Colour" ? 1 : 2,
          status: "active", migrationVersion: MIGRATION_VERSION,
        }, `itemVariants/${variantId}.${optionName.toLowerCase()}`);
      }
      if (!(desired.get("productOptionValues")?.has(valueId))) {
        addDesired(desired, "productOptionValues", valueId, {
          productOptionValueId: valueId, productOptionId: optionId, value: cleanString(optionValue),
          sortOrder: 999, status: "active", migrationVersion: MIGRATION_VERSION,
        }, `itemVariants/${variantId}.${optionName.toLowerCase()}`);
      }
      addDesired(desired, "productVariantValues", relationId, {
        productVariantValueId: relationId,
        productVariantId: variantId,
        productOptionValueId: valueId,
        status: "active",
        migrationVersion: MIGRATION_VERSION,
      }, `itemVariants/${variantId}.${optionName.toLowerCase()}`);
    }
  }

  const variantsByProduct = new Map();
  for (const [variantId, entry] of desired.get("productVariants") || []) {
    const list = variantsByProduct.get(entry.data.productId) || [];
    list.push({ variantId, entry });
    variantsByProduct.set(entry.data.productId, list);
  }
  for (const productVariants of variantsByProduct.values()) {
    if (productVariants.some(({ entry }) => entry.data.isDefault === true)) continue;
    productVariants.sort((left, right) =>
      Number(left.entry.data.sortOrder ?? 999) - Number(right.entry.data.sortOrder ?? 999) ||
      left.variantId.localeCompare(right.variantId));
    productVariants[0].entry.data.isDefault = true;
  }

  for (const [assetId, asset] of assets) {
    addDesired(desired, "assets", assetId, {
      assetId,
      assetName: cleanString(asset.assetName || asset.name || asset.title || assetId),
      assetType: cleanString(asset.assetType || asset.type || "Document")
        .replace(/^./, (char) => char.toUpperCase()),
      title: cleanString(asset.title || asset.name),
      description: cleanString(asset.description),
      altText: cleanString(asset.altText),
      fileUrl: cleanString(asset.fileUrl || asset.url),
      storagePath: cleanString(asset.storagePath),
      originalFilename: cleanString(asset.originalFilename),
      mimeType: cleanString(asset.mimeType),
      fileExtension: cleanString(asset.fileExtension),
      fileSizeBytes: Number(asset.fileSizeBytes ?? 0),
      width: Number(asset.width ?? 0),
      height: Number(asset.height ?? 0),
      aspectRatio: cleanString(asset.aspectRatio),
      durationSeconds: Number(asset.durationSeconds ?? 0),
      ownerUserId: cleanString(asset.ownerUserId),
      creatorUserId: cleanString(asset.creatorUserId || asset.ownerUserId),
      status: normalizeStatus(asset.status, "active"),
      approvalStatus: normalizeStatus(asset.approvalStatus, "approved"),
      visibility: cleanString(asset.visibility || (asset.visible === false ? "private" : "users")),
      copyrightOwner: cleanString(asset.copyrightOwner),
      licenceType: cleanString(asset.licenceType),
      migrationVersion: MIGRATION_VERSION,
    }, `assets/${assetId}`);
    if (asset.thumbnailUrl) {
      const renditionId = `AREN-${slug(assetId)}-THUMBNAIL`;
      addDesired(desired, "assetRenditions", renditionId, {
        assetRenditionId: renditionId,
        assetId,
        renditionName: "Thumbnail",
        purpose: "Thumbnail",
        fileUrl: cleanString(asset.thumbnailUrl),
        isDefault: false,
        status: "active",
        migrationVersion: MIGRATION_VERSION,
      }, `assets/${assetId}.thumbnailUrl`);
    }
  }

  for (const [itemAssetId, itemAsset] of itemAssets) {
    const itemId = cleanString(itemAsset.itemId);
    const assetId = cleanString(itemAsset.assetId);
    if (!assetId || !assets.has(assetId)) {
      warnings.push(`itemAssets/${itemAssetId} references missing Asset ${assetId}.`);
    }
    if (!itemId || !items.has(itemId)) warnings.push(`itemAssets/${itemAssetId} references missing Item ${itemId}.`);
    const itemLinkId = `EASSET-ITEM-${slug(itemAssetId)}`;
    addDesired(desired, "entityAssets", itemLinkId, entityAssetData({
      id: itemLinkId,
      assetId,
      entityType: "Item",
      entityId: itemId,
      role: itemAsset.purpose,
      fieldKey: itemAsset.fieldKey,
      sortOrder: itemAsset.sortOrder,
      displayStatus: itemAsset.displayStatus,
    }), `itemAssets/${itemAssetId}`);

    for (const productId of productsByItem.get(itemId) || []) {
      const productLinkId = `EASSET-PRODUCT-${slug(productId)}-${slug(itemAssetId)}`;
      addDesired(desired, "entityAssets", productLinkId, entityAssetData({
        id: productLinkId,
        assetId,
        entityType: "Product",
        entityId: productId,
        role: itemAsset.purpose || "Gallery",
        fieldKey: itemAsset.fieldKey,
        sortOrder: itemAsset.sortOrder,
        displayStatus: itemAsset.displayStatus,
      }), `itemAssets/${itemAssetId} via products/${productId}`);
    }
  }

  for (const collection of ["blueprints", "plans"]) {
    const source = collection === "blueprints" ? blueprints : plans;
    for (const [id, data] of source) {
      if (data.createsProduct === true) {
        addDesired(desired, collection, id, {
          createsProduct: true,
          migrationVersion: MIGRATION_VERSION,
        }, `${collection}/${id}.createsProduct`);
      }
    }
  }

  return desired;
}

function migrationOperations(existing, desired) {
  const operations = [];
  const summary = { create: 0, update: 0, unchanged: 0 };
  const collections = {};
  for (const [collection, docs] of desired) {
    const existingDocs = existing.get(collection) || new Map();
    collections[collection] = { proposed: docs.size, create: 0, update: 0, unchanged: 0 };
    for (const [id, desiredDoc] of docs) {
      const current = existingDocs.get(id);
      const mode = !current ? "create" : patchChanged(current, desiredDoc.data) ? "update" : "unchanged";
      summary[mode] += 1;
      collections[collection][mode] += 1;
      operations.push({ collection, id, mode, ...desiredDoc });
    }
  }
  return { operations, summary, collections };
}

async function commitOperations(db, operations) {
  const writes = operations.filter((operation) => operation.mode !== "unchanged");
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();
    for (const operation of writes.slice(offset, offset + 400)) {
      const ref = db.collection(operation.collection).doc(operation.id);
      const now = admin.firestore.FieldValue.serverTimestamp();
      const data = { ...operation.data, migratedAt: now, updatedAt: now };
      if (operation.mode === "create") data.createdAt = now;
      batch.set(ref, data, { merge: true });
    }
    await batch.commit();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if ((!options.dryRun && !options.emulator) || (options.dryRun && options.emulator)) {
    console.error("Choose exactly one mode: --dry-run or --emulator.");
    console.error(usage());
    process.exit(1);
  }
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "recovery-tools";
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
  if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
  const db = admin.firestore();
  const collections = [...new Set([...TARGET_COLLECTIONS, ...LEGACY_COLLECTIONS])];
  const before = await snapshotsByCollection(db, collections);
  const warnings = [];
  const desired = buildDesired(before, warnings);
  const migration = migrationOperations(before, desired);
  const legacyCounts = Object.fromEntries(LEGACY_COLLECTIONS.map((name) => [name, before.get(name)?.size || 0]));
  const beforeCounts = Object.fromEntries(collections.map((name) => [name, before.get(name)?.size || 0]));

  if (options.emulator) await commitOperations(db, migration.operations);

  const after = options.emulator ? await snapshotsByCollection(db, collections) : before;
  const afterCounts = Object.fromEntries(collections.map((name) => [name, after.get(name)?.size || 0]));
  const report = {
    migrationVersion: MIGRATION_VERSION,
    generatedAt: new Date().toISOString(),
    mode: options.dryRun ? "dry-run" : "emulator-write",
    safety: "Additive merge only. No deletes. Legacy collections and order history are not modified.",
    summary: migration.summary,
    collections: migration.collections,
    beforeCounts,
    afterCounts,
    legacyCounts,
    warnings,
    examples: migration.operations
      .filter((operation) => operation.mode !== "unchanged")
      .slice(0, 12)
      .map(({ collection, id, mode, source, data }) => ({ collection, id, mode, source, data })),
  };
  if (options.reportPath) {
    const reportPath = path.resolve(options.reportPath);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`Migration report written to ${reportPath}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("Product/Asset migration failed:", error);
  process.exit(1);
});
