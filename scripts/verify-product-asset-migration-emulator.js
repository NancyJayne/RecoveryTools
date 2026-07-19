import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import admin from "firebase-admin";

async function main() {
  const workbookPath = path.resolve(process.argv[2] || "");
  const reportDir = path.resolve(process.argv[3] || "outputs/product-asset-migration-verification");
  if (!workbookPath) throw new Error("Pass the v10 workbook path as the first argument.");
  await fs.mkdir(reportDir, { recursive: true });

  const env = {
    ...process.env,
    GCLOUD_PROJECT: process.env.GCLOUD_PROJECT || "recovery-tools",
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080",
  };
  const firstReportPath = path.join(reportDir, "migration-first.json");
  const secondReportPath = path.join(reportDir, "migration-second.json");
  const verificationPath = path.join(reportDir, "verification.json");

  function run(script, args) {
    const output = execFileSync(process.execPath, [script, ...args], {
      cwd: path.resolve("."),
      env,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    const finalLine = output.trim().split(/\r?\n/).find((line) => line.includes("Dry run complete"));
    if (finalLine) console.log(finalLine);
  }

  run("functions/scripts/importMasterDatabase.js", ["--emulator", workbookPath]);

  if (!admin.apps.length) admin.initializeApp({ projectId: env.GCLOUD_PROJECT });
  const db = admin.firestore();
  const count = async (collection) => (await db.collection(collection).get()).size;
  const legacyBefore = {
    products: await count("products"),
    productPrices: await count("productPrices"),
    itemVariants: await count("itemVariants"),
    itemAssets: await count("itemAssets"),
    assets: await count("assets"),
    orders: await count("orders"),
    orderItems: await count("orderItems"),
  };

  run("functions/scripts/migrateProductAssetArchitecture.js", ["--emulator", "--report", firstReportPath]);
  run("functions/scripts/migrateProductAssetArchitecture.js", ["--emulator", "--report", secondReportPath]);

  const first = JSON.parse(await fs.readFile(firstReportPath, "utf8"));
  const second = JSON.parse(await fs.readFile(secondReportPath, "utf8"));
  const legacyAfter = Object.fromEntries(await Promise.all(
    Object.keys(legacyBefore).map(async (collection) => [collection, await count(collection)]),
  ));

  const errors = [];
  if (first.summary.create + first.summary.update === 0) errors.push("First migration produced no changes.");
  if (second.summary.create !== 0 || second.summary.update !== 0) {
    errors.push(`Second migration was not idempotent: ${JSON.stringify(second.summary)}.`);
  }
  for (const [collection, before] of Object.entries(legacyBefore)) {
    if (legacyAfter[collection] !== before) {
      errors.push(`${collection} count changed from ${before} to ${legacyAfter[collection]}.`);
    }
  }

  const [products, productLinks, productVariants, entityAssets, assets, items] = await Promise.all([
    db.collection("products").get(),
    db.collection("productLinks").get(),
    db.collection("productVariants").get(),
    db.collection("entityAssets").get(),
    db.collection("assets").get(),
    db.collection("items").get(),
  ]);

  for (const product of products.docs) {
    const data = product.data();
    if (!data.productName || !data.productType) errors.push(`products/${product.id} lacks canonical identity fields.`);
    if (data.itemId && !productLinks.docs.some((link) => {
      const linkData = link.data();
      return linkData.productId === product.id && linkData.linkRole === "Represents";
    })) errors.push(`products/${product.id} has no Represents ProductLink.`);
    if (data.itemId && !items.docs.find((item) => item.id === data.itemId)?.data()?.createsProduct) {
      errors.push(`items/${data.itemId} was not marked createsProduct.`);
    }
  }

  for (const asset of assets.docs) {
    const data = asset.data();
    if (!data.assetName || !data.assetType) errors.push(`assets/${asset.id} lacks canonical identity fields.`);
  }

  const variantsByProduct = new Map();
  for (const variant of productVariants.docs) {
    const data = variant.data();
    const list = variantsByProduct.get(data.productId) || [];
    list.push(data);
    variantsByProduct.set(data.productId, list);
  }
  for (const [productId, variants] of variantsByProduct) {
    const defaults = variants.filter((variant) => variant.isDefault === true);
    if (defaults.length !== 1) errors.push(`Product ${productId} has ${defaults.length} default canonical variants.`);
  }

  const verification = {
    verifiedAt: new Date().toISOString(),
    workbookPath,
    firstRun: first.summary,
    secondRun: second.summary,
    legacyBefore,
    legacyAfter,
    canonicalCounts: {
      productLinks: productLinks.size,
      productVariants: productVariants.size,
      entityAssets: entityAssets.size,
    },
    warnings: first.warnings,
    errors,
  };
  await fs.writeFile(verificationPath, JSON.stringify(verification, null, 2));
  console.log(JSON.stringify(verification, null, 2));
  if (errors.length) process.exit(1);
}

main().catch((error) => {
  console.error("Product/Asset emulator verification failed:", error);
  process.exit(1);
});
