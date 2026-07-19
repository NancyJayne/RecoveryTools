import fs from "node:fs/promises";
import path from "node:path";
import admin from "firebase-admin";

const DEFAULT_COLLECTIONS = [
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
  "campaigns",
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
    emulator: false,
    live: false,
    confirmLive: false,
    outputDir: null,
    collections: DEFAULT_COLLECTIONS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--emulator") options.emulator = true;
    else if (arg === "--live") options.live = true;
    else if (arg === "--confirm-live") options.confirmLive = true;
    else if (arg === "--out") {
      options.outputDir = argv[i + 1];
      i += 1;
    } else if (arg === "--collections") {
      options.collections = argv[i + 1]
        .split(",")
        .map((collection) => collection.trim())
        .filter(Boolean);
      i += 1;
    }
  }

  return options;
}

function usage() {
  return [
    "Usage:",
    "  node functions/scripts/exportFirestoreBackup.js --emulator",
    "  node functions/scripts/exportFirestoreBackup.js --emulator --out backups/firestore",
    "  node functions/scripts/exportFirestoreBackup.js --live --confirm-live --out backups/firestore",
    "  node functions/scripts/exportFirestoreBackup.js --emulator --collections products,orders",
  ].join("\n");
}

function toPlainJson(value) {
  if (!value || typeof value !== "object") return value;

  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (Array.isArray(value)) return value.map(toPlainJson);

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = toPlainJson(entry);
  }
  return out;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function exportCollection(db, collectionName) {
  const snapshot = await db.collection(collectionName).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...toPlainJson(doc.data()),
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.live && !options.confirmLive) {
    console.error("Refusing live export without --confirm-live.");
    process.exit(1);
  }

  if (!options.emulator && !options.live) {
    console.error("Choose one target: --emulator or --live.");
    console.error(usage());
    process.exit(1);
  }

  if (options.emulator && !process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "recovery-tools";
    process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  }

  if (!admin.apps.length) admin.initializeApp();

  const target = options.live ? "live" : "emulator";
  const backupRoot = options.outputDir ?? path.join("backups", "firestore");
  const outputDir = path.join(backupRoot, `${target}-${timestamp()}`);

  await fs.mkdir(outputDir, { recursive: true });

  const db = admin.firestore();
  const manifest = {
    target,
    exportedAt: new Date().toISOString(),
    collections: {},
  };

  for (const collectionName of options.collections) {
    const rows = await exportCollection(db, collectionName);
    const filePath = path.join(outputDir, `${collectionName}.json`);
    await fs.writeFile(filePath, JSON.stringify(rows, null, 2));
    manifest.collections[collectionName] = {
      count: rows.length,
      file: `${collectionName}.json`,
    };
    console.log(`Exported ${collectionName}: ${rows.length}`);
  }

  await fs.writeFile(
    path.join(outputDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  console.log(`\nBackup written to ${outputDir}`);
}

main().catch((error) => {
  console.error("Export failed:", error);
  process.exit(1);
});
