import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import {
  ASSET_TYPES,
  CANONICAL_WORKBOOK_SCHEMAS,
  ENTITY_ASSET_TYPES,
  LINKED_ENTITY_TYPES,
  PRODUCT_LINK_ROLES,
  PRODUCT_TYPES,
} from "../../../functions/utils/commerceAssetSchemas.js";

const baseDir = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc";
const inputPath = path.join(baseDir, "Recovery Tools Master Database (9).xlsx");
const outputPath = path.join(baseDir, "Recovery Tools Master Database (10).xlsx");
const previewDir = path.join(baseDir, "artifact-work", "v10-previews");
await fs.mkdir(previewDir, { recursive: true });

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const headerStyle = {
  fill: "#285F5B",
  font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
  wrapText: true,
  verticalAlignment: "center",
};

function columnLetter(columnNumber) {
  let n = columnNumber;
  let result = "";
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function nonEmptyRows(values) {
  return values.filter((row) => row.some((cell) => cell !== "" && cell !== null && cell !== undefined));
}

const legacyProducts = workbook.worksheets.getItem("ItemProduct").getUsedRange().values;
const legacyProductHeaders = legacyProducts[0].map((value) => String(value || "").trim());
const legacyItemIdIndex = legacyProductHeaders.indexOf("ItemID");
const productItemIds = new Set(
  nonEmptyRows(legacyProducts.slice(1)).map((row) => row[legacyItemIdIndex]).filter(Boolean),
);

for (const sheetName of ["Items", "Blueprints", "Plan"]) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const used = sheet.getUsedRange();
  const values = used.values;
  const headers = values[0].map((value) => String(value || "").trim());
  const existingIndex = headers.findIndex((header) => ["createsproduct", "creates product", "creates product?"].includes(header.toLowerCase()));
  const targetColumn = existingIndex >= 0 ? existingIndex + 1 : headers.length + 1;
  sheet.getCell(0, targetColumn - 1).values = [["CreatesProduct"]];
  sheet.getCell(0, targetColumn - 1).format = headerStyle;
  sheet.getCell(0, targetColumn - 1).format.columnWidth = 16;

  const idHeader = sheetName === "Items" ? "ItemID" : sheetName === "Blueprints" ? "BlueprintID" : "PlanID";
  const idIndex = headers.indexOf(idHeader);
  const shopIndex = headers.indexOf("IsShopProduct");
  const rowCount = Math.max(used.rowCount, 2);
  const output = [];
  for (let rowIndex = 1; rowIndex < rowCount; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const id = row[idIndex];
    if (!id) {
      output.push([""]);
      continue;
    }
    const existing = existingIndex >= 0 ? row[existingIndex] : "";
    const derived = sheetName === "Items"
      ? productItemIds.has(id) || [true, "yes", "true", "1"].includes(String(row[shopIndex] ?? "").toLowerCase())
      : false;
    output.push([existing === "" || existing === null || existing === undefined ? derived : existing]);
  }
  sheet.getRange(`${columnLetter(targetColumn)}2:${columnLetter(targetColumn)}${rowCount}`).values = output;
  sheet.getRange(`${columnLetter(targetColumn)}2:${columnLetter(targetColumn)}${Math.max(rowCount, 100)}`).dataValidation = {
    rule: { type: "list", values: ["TRUE", "FALSE"] },
  };
}

const categoricalValidations = {
  Products: {
    ProductType: PRODUCT_TYPES,
    Status: ["draft", "review", "active", "paused", "archived"],
    ShopStatus: ["draft", "review", "active", "paused", "archived"],
    ApprovalStatus: ["draft", "awaiting approval", "approved", "changes requested", "rejected"],
    MarketplaceVisibility: ["private", "users", "affiliates", "therapists", "admin", "unlocked"],
    Currency: ["AUD"],
  },
  ProductLinks: { LinkedEntityType: LINKED_ENTITY_TYPES, LinkRole: PRODUCT_LINK_ROLES, Status: ["active", "paused", "archived"] },
  ProductOptions: { Status: ["active", "paused", "archived"] },
  ProductOptionValues: { Status: ["active", "paused", "archived"] },
  ProductVariants: { Status: ["draft", "active", "paused", "archived"], Currency: ["AUD"] },
  ProductVariantValues: { Status: ["active", "paused", "archived"] },
  ProductComponents: { Status: ["active", "paused", "archived"] },
  ProductAccessGrants: { AccessEntityType: ["Item", "Blueprint", "Plan", "Asset"], Status: ["active", "paused", "archived"] },
  Assets: { AssetType: ASSET_TYPES, Status: ["draft", "review", "active", "paused", "archived"] },
  EntityAssets: { EntityType: ENTITY_ASSET_TYPES, Status: ["active", "paused", "archived"], DisplayStatus: ["private", "active", "public", "archived"] },
  AssetRenditions: { Status: ["draft", "active", "paused", "archived"] },
};

for (const schema of Object.values(CANONICAL_WORKBOOK_SCHEMAS)) {
  let sheet;
  try {
    sheet = workbook.worksheets.getItem(schema.sheet);
  } catch {
    sheet = workbook.worksheets.add(schema.sheet);
  }
  const headers = schema.fields.map((definition) => definition.workbook);
  const endColumn = columnLetter(headers.length);
  sheet.getRange(`A1:${endColumn}1`).values = [headers];
  sheet.getRange(`A1:${endColumn}1`).format = headerStyle;
  sheet.getRange(`A1:${endColumn}1`).format.rowHeight = 30;
  sheet.freezePanes.freezeRows(1);
  sheet.showGridLines = true;

  headers.forEach((header, index) => {
    const column = columnLetter(index + 1);
    const definition = schema.fields[index];
    const range = sheet.getRange(`${column}2:${column}101`);
    range.format.font = { name: "Arial", size: 10 };
    range.format.columnWidth = header.endsWith("ID") ? 21
      : ["ShortDescription", "LongDescription", "Description", "Notes"].includes(header) ? 32
        : header.includes("URL") || header === "StoragePath" ? 28
          : 16;
    if (definition.type === "date") range.format.numberFormat = "yyyy-mm-dd hh:mm";
    if (definition.type === "number") range.format.numberFormat = "#,##0.00";
    if (definition.type === "boolean") range.dataValidation = { rule: { type: "list", values: ["TRUE", "FALSE"] } };
    const options = categoricalValidations[schema.sheet]?.[header];
    if (options) range.dataValidation = { rule: { type: "list", values: options } };
  });
}

function appendRows(sheetName, rows) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const used = sheet.getUsedRange();
  const start = used.rowCount + 2;
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [...row, ...Array(width - row.length).fill("")]);
  sheet.getRange(`A${start}:${columnLetter(width)}${start + rows.length - 1}`).values = padded;
  return start;
}

const mappingStart = appendRows("Firebase Mapping", [
  ["Canonical Products", "products", "ProductID", "Products is the canonical commercial offer sheet. ProductType controls commerce fields; it is not an Item Type.", "ItemProduct remains a read-only migration source during compatibility."],
  ["Product relationships", "productLinks", "ProductLinkID", "Links Products to Items, Blueprints, Plans or Assets with an explicit LinkRole.", "CreatesProduct only reveals management UI; ProductLinks is relationship truth."],
  ["Product variants/options/components/access", "productVariants and related collections", "collection primary ID", "Normalises variants, options, bill of materials and access grants.", "Legacy ProductPrice and ItemVariants remain supported during migration."],
  ["Canonical Assets", "assets", "AssetID", "Assets are reusable files independent of every content and commerce entity.", "Legacy Asset remains a migration source when no matching Assets row exists."],
  ["Generic Asset relationships", "entityAssets / assetRenditions", "EntityAssetID / AssetRenditionID", "EntityAssets links files to any supported entity; renditions represent crops/formats of one source Asset.", "ItemAsset remains supported during migration."],
]);
workbook.worksheets.getItem("Firebase Mapping").getRange(`A${mappingStart}:E${mappingStart + 4}`).format.wrapText = true;

appendRows("System_Documentation", [
  ["Product and Asset canonical schema (v10)"],
  ["Products and Assets are independent first-class entities. Neither Product nor Asset is an Item Type."],
  ["CreatesProduct is available on Items, Blueprints and Plans as an admin workflow toggle. It does not publish or price content."],
  ["ProductLinks is the source of truth for relationships. EntityAssets is the source of truth for reusable file placement."],
  ["The canonical sheets are additive. ItemProduct, ProductPrice, ItemVariants, Asset and ItemAsset remain available during the validated migration period."],
  ["Workbook import remains merge-only: blank cells and missing workbook rows do not automatically delete Firestore content."],
]);

const quality = workbook.worksheets.getItem("Data Quality");
const qualityRange = quality.getUsedRange();
const qualityValues = qualityRange.values;
qualityValues.forEach((row) => {
  if (typeof row[0] === "string") row[0] = row[0].replace(/v9/g, "v10");
  if (typeof row[1] === "string") row[1] = row[1].replace(/Database \(8\)/g, "Database (9)");
});
qualityRange.values = qualityValues;
appendRows("Data Quality", [
  ["CANONICAL-SCHEMAS", "INFO", "Products and Assets", "", "", "Canonical sheets added without removing legacy sheets."],
  ["MIGRATION-SAFETY", "INFO", "Importer", "", "", "Canonical rows override a matching legacy ID; missing and app-owned Firestore records remain preserved."],
  ["CREATES-PRODUCT", "INFO", "Items / Blueprints / Plans", "", "", "Workflow toggle only. ProductLinks remains the relationship source of truth."],
]);

const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);

const verification = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
const requiredSheets = Object.values(CANONICAL_WORKBOOK_SCHEMAS).map((schema) => schema.sheet);
const missingSheets = requiredSheets.filter((name) => !verification.worksheets.items.some((sheet) => sheet.name === name));
if (missingSheets.length) throw new Error(`Missing canonical sheets: ${missingSheets.join(", ")}`);

const formulaErrors = await verification.inspect({
  kind: "match",
  searchTerm: "#(REF!|DIV/0!|VALUE!|NAME\\?|N/A)",
  options: { useRegex: true, maxResults: 300 },
  summary: "v10 formula error scan",
});
console.log(formulaErrors.ndjson);

const renderFailures = [];
for (const sheet of verification.worksheets.items) {
  try {
    const preview = await verification.render({ sheetName: sheet.name, autoCrop: "all", scale: 0.4, format: "png" });
    const safeName = sheet.name.replace(/[\\/:*?"<>|]/g, "_");
    await fs.writeFile(path.join(previewDir, `${safeName}.png`), new Uint8Array(await preview.arrayBuffer()));
  } catch (error) {
    renderFailures.push(`${sheet.name}: ${error.message}`);
  }
}

console.log(JSON.stringify({ outputPath, sheetCount: verification.worksheets.items.length, renderFailures }, null, 2));
