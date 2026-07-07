import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import XLSX from "xlsx";

const COLLECTIONS = [
  "items",
  "products",
  "productPrices",
  "itemVariants",
  "assets",
  "itemAssets",
  "inventory",
  "users",
  "orders",
  "orderItems",
  "customerAddresses",
  "shipments",
  "stripeEvents",
  "userAccess",
];

function parseArgs(argv) {
  const options = {
    dryRun: false,
    emulator: false,
    live: false,
    confirmLive: false,
    workbookPath: null,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--emulator") options.emulator = true;
    else if (arg === "--live") options.live = true;
    else if (arg === "--confirm-live") options.confirmLive = true;
    else if (!arg.startsWith("--")) options.workbookPath = arg;
  }

  return options;
}

function usage() {
  return [
    "Usage:",
    "  node functions/scripts/importMasterDatabase.js --dry-run <workbook.xlsx>",
    "  node functions/scripts/importMasterDatabase.js --emulator <workbook.xlsx>",
    "  node functions/scripts/importMasterDatabase.js --live --confirm-live <workbook.xlsx>",
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

function asArray(input) {
  if (input === null || input === undefined || input === "") return [];
  return String(input)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

function buildDocs(workbook) {
  const warnings = [];
  const docs = [];

  const rows = {
    items: parseSheet(workbook, "Items"),
    products: parseSheet(workbook, "ItemProduct"),
    prices: parseSheet(workbook, "ProductPrice"),
    variants: parseSheet(workbook, "ItemVariants"),
    assets: parseSheet(workbook, "Asset"),
    itemAssets: parseSheet(workbook, "ItemAsset"),
    inventory: parseSheet(workbook, "Inventory"),
    users: parseSheet(workbook, "Users"),
    orders: parseSheet(workbook, "Orders"),
    orderItems: parseSheet(workbook, "OrderItem"),
    customerAddresses: parseSheet(workbook, "CustomerAddresses"),
    shipments: parseSheet(workbook, "Shipments"),
    stripeEvents: parseSheet(workbook, "StripeEvents"),
    userAccess: parseSheet(workbook, "User Access"),
  };

  const itemsById = indexBy(rows.items, "ItemID");
  const tagsById = indexBy(parseSheet(workbook, "Tags"), "TagID");
  const assetsById = indexBy(rows.assets, "AssetID");
  const itemAssetsByItemId = new Map();
  const pricesByProductId = new Map();
  const variantsByItemId = new Map();
  const inventoryByItemId = new Map();
  const inventoryByVariantId = new Map();

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

  for (const row of rows.items) {
    const itemId = asString(value(row, "ItemID"));
    if (!itemId) continue;

    const tagIds = asArray(value(row, "TagID"));
    pushDoc(docs, "items", itemId, {
      itemId,
      name: asString(value(row, "Item Name")),
      type: asStatus(value(row, "FirebaseType")),
      itemType: asString(value(row, "ItemType")),
      categoryId: asString(value(row, "CategoryID")),
      tagIds,
      tags: tagIds.map((tagId) => asString(value(tagsById.get(tagId) ?? {}, "TagName"))).filter(Boolean),
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
      accessCodeEligible: asBool(value(row, "Access Code Eligable")),
      inventoryTracked: asBool(value(row, "inventoryTracked")),
      stockStatus: asStatus(value(row, "StockStatus")),
      notes: asString(value(row, "Notes")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.assets) {
    const assetId = asString(value(row, "AssetID"));
    if (!assetId) continue;
    if (!asString(value(row, "FileURL"))) {
      warnings.push(`Asset ${assetId} has no FileURL.`);
    }
    pushDoc(docs, "assets", assetId, {
      assetId,
      name: asString(value(row, "AssetName")),
      type: asStatus(value(row, "AssetType")),
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
      priceOverride: asNumber(value(row, "Price Override")),
      itemAssetId: asString(value(row, "ItemAssetID")),
      status: asStatus(value(row, "Status")),
      stock,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const row of rows.prices) {
    const priceId = asString(value(row, "PriceID"));
    const productId = asString(value(row, "ItemProductID"));
    if (!productId) continue;
    if (!priceId) {
      warnings.push(`ProductPrice row for product ${productId} is missing PriceID.`);
      continue;
    }

    pushDoc(docs, "productPrices", priceId, {
      priceId,
      productId,
      variantId: asString(value(row, "VariantID")),
      currency: asString(value(row, "Currency")) ?? "AUD",
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
          type: asStatus(value(asset, "AssetType")),
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
      type: asStatus(value(item, "FirebaseType")),
      categoryId: asString(value(item, "CategoryID")),
      tagIds: asArray(value(item, "TagID")),
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

  const counts = Object.fromEntries(COLLECTIONS.map((collection) => [collection, 0]));
  for (const doc of docs) counts[doc.collection] += 1;

  return { docs, warnings, counts };
}

async function commitDocs(db, docs) {
  let batch = db.batch();
  let opCount = 0;
  let committed = 0;

  for (const doc of docs) {
    batch.set(db.collection(doc.collection).doc(doc.id), doc.data, { merge: true });
    opCount += 1;

    if (opCount === 400) {
      await batch.commit();
      committed += opCount;
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await batch.commit();
    committed += opCount;
  }

  return committed;
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
  const { docs, warnings, counts } = buildDocs(workbook);

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

  const committed = await commitDocs(admin.firestore(), docs);
  console.log(`\nCommitted ${committed} Firestore documents.`);
}

main().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
