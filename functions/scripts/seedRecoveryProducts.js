import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import admin from "firebase-admin";
import xlsx from "xlsx";
import { FieldValue } from "firebase-admin/firestore";

const DEFAULT_WORKBOOK_PATH = path.join(
  os.homedir(),
  "Downloads",
  "Recovery Tools Master Database (3).xlsx",
);

const FALLBACK_PRODUCTS = [
  {
    id: "PROD-EPSOM-SALT",
    itemId: "ITEM-EPSOM-SALT",
    name: "Epsom Salts",
    productCategory: "CAT-TREAT",
    type: "tool",
    productType: "Physical Product",
    soldByRecoveryTools: true,
    isShopProduct: true,
    shopStatus: "Active",
    visible: true,
    websiteVisible: true,
    price: 15,
    retailPrice: 15,
    salePrice: null,
    onSale: false,
    sku: "EPSOM-SALT",
    stock: 3,
    shortDescription:
      "Pure magnesium sulfate recovery salts for muscle relaxation and recovery.",
    longDescription:
      "Pure magnesium sulfate recovery salts for muscle relaxation and recovery.",
    images: ["https://via.placeholder.com/300"],
    slug: "epsom-salt",
    tags: ["TAG-PAIN"],
    features: [],
    unlocksAccess: true,
    accessType: "Course",
    relatedPlanId: "PLAN-EPSOM-SOAKS",
    relatedCourseId: "COURSE-EPSOM-SOAKS",
    accessCodeEligible: true,
    notes: "Physical product unlocks related recovery course.",
  },
  {
    id: "PROD-MCT-BALM-01",
    itemId: "ITEM-MCT-BALM-01",
    name: "MCT Recovery Balm 50g",
    productCategory: "CAT-TREAT",
    type: "tool",
    productType: "Physical Product",
    soldByRecoveryTools: true,
    isShopProduct: true,
    shopStatus: "Active",
    visible: true,
    websiteVisible: true,
    price: 32,
    retailPrice: 32,
    salePrice: null,
    onSale: false,
    sku: "MCT-BALM-50G",
    stock: 4,
    shortDescription:
      "Warming recovery balm with coconut oil, camphor, magnesium, wintergreen, and eucalyptus.",
    longDescription:
      "Our 50g MCT Recovery Balm combines coconut-oil with camphor, magnesium, " +
      "wintergreen, and eucalyptus to deliver soothing heat, ease inflammation, " +
      "and support deep muscle recovery.",
    images: ["https://via.placeholder.com/300"],
    slug: "mct-balm",
    tags: ["TAG-PAIN"],
    features: [],
    unlocksAccess: true,
    accessType: "Course",
    relatedPlanId: "PLAN-MCT-BALM-USE",
    relatedCourseId: "COURSE-MCT-BALM-USE",
    accessCodeEligible: true,
    notes: "May also pair with trigger ball/cupping recovery routines.",
  },
  {
    id: "PROD-CUPPING-SET",
    itemId: "ITEM-CUPPING-SET",
    name: "Silicone Cupping Set",
    productCategory: "CAT-TREAT",
    type: "tool",
    productType: "Physical Product",
    soldByRecoveryTools: true,
    isShopProduct: true,
    shopStatus: "Active",
    visible: true,
    websiteVisible: true,
    price: 50,
    retailPrice: 50,
    salePrice: null,
    onSale: false,
    sku: "CUPPING-SET",
    stock: 3,
    shortDescription:
      "Silicone cupping set with 2 large cups, 2 small cups, hard case, and MCT balm sample.",
    longDescription:
      "Experience professional-level recovery in your hands with our silicone " +
      "cupping set, featuring 2 large and 2 small cups, a sturdy hard-case, " +
      "and a soothing MCT balm sample for effective myofascial release wherever you are.",
    images: ["https://via.placeholder.com/300"],
    slug: "cupping-set",
    tags: ["TAG-PAIN"],
    features: [],
    unlocksAccess: true,
    accessType: "Course",
    relatedPlanId: "PLAN-CUPPING-BASICS",
    relatedCourseId: "COURSE-CUPPING-BASICS",
    accessCodeEligible: true,
    notes: "Include safety/contraindication education in unlocked content.",
  },
  {
    id: "PROD-TRIGGER-BALL-6CM",
    itemId: "ITEM-TRIGGER-BALL-6CM",
    name: "Trigger Ball 6cm",
    productCategory: "CAT-ART",
    type: "tool",
    productType: "Physical Product",
    soldByRecoveryTools: true,
    isShopProduct: true,
    shopStatus: "Active",
    visible: true,
    websiteVisible: true,
    price: 15,
    retailPrice: 15,
    salePrice: null,
    onSale: false,
    sku: "TRIGGER-BALL-6CM",
    stock: 10,
    shortDescription:
      "Hard silicone trigger ball for targeted muscle release and deep tissue recovery.",
    longDescription:
      "Our 6cm hard silicone trigger balls are designed to target tight spots, " +
      "release muscle tension, and support deep tissue recovery anytime, anywhere.",
    images: ["https://via.placeholder.com/300"],
    slug: "trigger-ball",
    tags: ["TAG-PAIN"],
    features: [],
    unlocksAccess: true,
    accessType: "Course",
    relatedPlanId: "PLAN-TRIGGER-BALL-BASICS",
    relatedCourseId: "COURSE-TRIGGER-BALL-BASICS",
    accessCodeEligible: true,
    notes: "Needs colour variants.",
  },
  {
    id: "PROD-HEAT-PATCHES-6PK",
    itemId: "ITEM-HEAT-PATCHES-6PK",
    name: "Heat Patches 6 Pack",
    productCategory: "CAT-TREAT",
    type: "tool",
    productType: "Physical Product",
    soldByRecoveryTools: true,
    isShopProduct: true,
    shopStatus: "Active",
    visible: true,
    websiteVisible: true,
    price: 25,
    retailPrice: 25,
    salePrice: null,
    onSale: false,
    sku: "HEAT-PATCHES-6PK",
    stock: 5,
    shortDescription:
      "Six air-activated heat patches providing up to 12 hours of soothing warmth.",
    longDescription:
      "Six heat patches, air-activated and powered by natural iron powder. " +
      "Providing up to 12 hours of soothing warmth to support muscle recovery, " +
      "ease tension, and promote self-managed pain relief.",
    images: ["https://via.placeholder.com/300"],
    slug: "heat-patches",
    tags: ["TAG-PAIN"],
    features: [],
    unlocksAccess: true,
    accessType: "Course",
    relatedPlanId: "PLAN-HEAT-PATCHES",
    relatedCourseId: "COURSE-HEAT-PATCHES",
    accessCodeEligible: true,
    notes: "Include safe use, timing, and contraindications in course.",
  },
  {
    id: "PROD-COURSE-001",
    itemId: "ITEM-COURSE-001",
    name: "Trigger Ball Basics",
    productCategory: "CAT-ART",
    type: "course",
    productType: "Digital Product",
    soldByRecoveryTools: true,
    isShopProduct: true,
    shopStatus: "Active",
    visible: true,
    websiteVisible: true,
    price: 120,
    retailPrice: 120,
    salePrice: null,
    onSale: false,
    sku: "TRIGGER-BALL-COURSE",
    stock: 0,
    shortDescription: "Guide to trigger ball recovery tool",
    longDescription:
      "A comprehensive guide to using the trigger ball for muscular release.",
    images: ["https://via.placeholder.com/300"],
    slug: "trigger-ball-course",
    tags: ["TAG-PAIN"],
    features: [],
    unlocksAccess: true,
    accessType: "Course",
    relatedPlanId: "PLAN-TRIGGER-BALL-BASICS",
    relatedCourseId: "COURSE-TRIGGER-BALL-BASICS",
    accessCodeEligible: true,
  },
];

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "recovery-tools";
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function sheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  return xlsx.utils.sheet_to_json(sheet, {
    defval: null,
    raw: false,
  });
}

function isYes(value) {
  if (typeof value === "boolean") return value;
  return ["yes", "true", "active", "1"].includes(
    String(value ?? "").trim().toLowerCase(),
  );
}

function normalizeStatus(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function splitList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  const text = String(value ?? "").trim();
  if (!text) return [];

  return text
    .split(/[|,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapBy(rows, key) {
  return new Map(
    rows
      .filter((row) => optionalString(row[key]))
      .map((row) => [optionalString(row[key]), row]),
  );
}

function buildProductsFromWorkbook(workbookPath) {
  const workbook = xlsx.readFile(workbookPath, { cellDates: true });

  const itemProducts = sheetRows(workbook, "ItemProduct");
  const items = sheetRows(workbook, "Items");
  const prices = sheetRows(workbook, "ProductPrice");
  const inventory = sheetRows(workbook, "Inventory");
  const itemAssets = sheetRows(workbook, "ItemAsset");
  const assets = sheetRows(workbook, "Asset");

  const itemById = mapBy(items, "ItemID");
  const assetById = mapBy(assets, "AssetID");
  const activePriceByProductId = mapBy(
    prices.filter((row) => normalizeStatus(row.Status) === "Active"),
    "ItemProductID",
  );

  return itemProducts
    .filter((product) => optionalString(product.ItemProductID))
    .map((product) => {
      const id = optionalString(product.ItemProductID);
      const itemId = optionalString(product.ItemID);
      const item = itemById.get(itemId) || {};
      const price = activePriceByProductId.get(id) || {};

      const stock = inventory
        .filter((row) => optionalString(row.ItemID) === itemId)
        .reduce((total, row) => total + numberOrZero(row["Stock Qty"]), 0);

      const images = itemAssets
        .filter((row) => optionalString(row.ItemID) === itemId)
        .map((row) => assetById.get(optionalString(row.AssetID)))
        .filter((asset) => asset && String(asset.Type ?? asset.AssetType ?? "").toLowerCase().includes("image"))
        .map((asset) => optionalString(asset.FileURL))
        .filter(Boolean);

      const shopStatus = normalizeStatus(product["Shop Status"]);
      const websiteVisible = isYes(item["Website Visible"]);
      const visible = shopStatus === "Active" && websiteVisible;

      return {
        id,
        itemId,
        name: optionalString(product.ProductTitle) || optionalString(item["Item Name"]),
        productCategory: optionalString(item.CategoryID) || optionalString(product.ProductCategory),
        type: optionalString(item.Type) || optionalString(item.FirebaseType) || "tool",
        productType: optionalString(item.ItemType) || optionalString(item.Type),
        soldByRecoveryTools: isYes(item.SoldByRecoveryTools),
        isShopProduct: isYes(item.IsShopProduct),
        shopStatus,
        visible,
        websiteVisible,
        price: numberOrZero(price.EffectiveShopPrice || price.RetailPrice),
        retailPrice: numberOrZero(price.RetailPrice),
        salePrice: price.SalePrice ? numberOrZero(price.SalePrice) : null,
        onSale: isYes(price.OnSale),
        sku: optionalString(product.SKU),
        stock,
        shortDescription:
          optionalString(product.ProductShortDescription) ||
          optionalString(item["Short Description"]) ||
          "",
        longDescription:
          optionalString(product.ProductLongDescription) ||
          optionalString(item["Long Description"]) ||
          "",
        images: images.length ? images : ["https://via.placeholder.com/300"],
        slug: optionalString(product.slug),
        tags: splitList(item.TagID),
        features: splitList(product.Features || item.Features),
        unlocksAccess: isYes(product["Unlocks access"] || item["Unlocks access"]),
        accessType: optionalString(product["Access Type"] || item["Access Type"]),
        relatedPlanId: optionalString(product["Related PlanID"] || item["Related PlanID"]),
        relatedCourseId: optionalString(
          product["Related PlanCourseDetailID"] ||
          item["Related PlanCourseDetailID"],
        ),
        relatedWorkshopId: optionalString(
          product["Related WorkshopID"] || item["Related WorkshopID"],
        ),
        accessCodeEligible: isYes(
          product["Access Code Eligible"] ||
          item["Access Code Eligible"] ||
          item["Access Code Eligable"],
        ),
        references: optionalString(item.References),
        referenceStatus: optionalString(item["Reference Status"]),
        notes: optionalString(product.Notes || item.Notes),
      };
    });
}

function resolveProducts() {
  const requestedWorkbookPath =
    getArgValue("--workbook") || process.env.RECOVERY_PRODUCTS_WORKBOOK;

  const workbookPath = requestedWorkbookPath || DEFAULT_WORKBOOK_PATH;
  if (fs.existsSync(workbookPath)) {
    console.log(`Reading recovery products from workbook: ${workbookPath}`);
    return buildProductsFromWorkbook(workbookPath);
  }

  console.warn(
    `Workbook not found at ${workbookPath}. Using fallback product seed data.`,
  );
  return FALLBACK_PRODUCTS;
}

async function seedRecoveryProducts() {
  const dryRun = process.argv.includes("--dry-run");
  const products = resolveProducts();
  let created = 0;
  let updated = 0;
  let preserved = 0;

  if (!products.length) {
    throw new Error("No recovery products found to seed.");
  }

  for (const product of products) {
    const { id, ...data } = product;

    if (!id) {
      throw new Error(`Product is missing an id: ${JSON.stringify(product)}`);
    }

    if (!data.name || !data.price) {
      throw new Error(`Product ${id} is missing a name or price.`);
    }

    if (dryRun) {
      console.log(`DRY RUN product ${id}:`, JSON.stringify(data, null, 2));
      continue;
    }

    const ref = db.collection("products").doc(id);
    const existing = await ref.get();
    if (existing.exists) {
      if (existing.data()?.managedByWorkbook === true) {
        await ref.set({
          ...data,
          managedByWorkbook: true,
          contentOrigin: "workbook",
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        updated += 1;
        console.log(`Merged workbook product: ${id}`);
      } else {
        preserved += 1;
        console.log(`Preserved app-owned product collision: ${id}`);
      }
      continue;
    }

    await ref.create({
      ...data,
      managedByWorkbook: true,
      contentOrigin: "workbook",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    created += 1;

    console.log(`Created product: ${id}`);
  }

  console.log(
    dryRun
      ? `Dry run complete. ${products.length} products validated.`
      : `Recovery products complete. ${created} created; ${updated} workbook-managed updated; ` +
        `${preserved} app-owned collisions preserved.`,
  );
  process.exit(0);
}

seedRecoveryProducts().catch((error) => {
  console.error("Recovery product seed failed:", error);
  process.exit(1);
});
