import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const baseDir = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc";
const inputPath = path.join(baseDir, "Recovery Tools Master Database (8).xlsx");
const outputPath = path.join(baseDir, "Recovery Tools Master Database (9).xlsx");
const previewDir = path.join(baseDir, "artifact-work", "v9-previews");
await fs.mkdir(previewDir, { recursive: true });

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

const ownershipHeaders = [
  "Owner",
  "OwnerType",
  "OwnerID",
  "CreatedByUserID",
  "CreatedByEmail",
  "UpdatedByUserID",
  "UpdatedByEmail",
  "createdAt",
  "updatedAt",
];

const ownershipKeys = new Set(ownershipHeaders.map((value) => value.toLowerCase()));

function excelDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  }
  return value ?? "";
}

function canonicalOwner(oldOwner, oldOwnerType) {
  if (String(oldOwner || "").trim()) return String(oldOwner).trim();
  const type = String(oldOwnerType || "").trim().toLowerCase();
  if (type === "therapist") return "Therapist";
  if (type === "clinic") return "Clinic";
  if (type === "affiliate") return "Affiliate";
  return "Recovery Tools";
}

function canonicalOwnerType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "therapist" || type === "clinic") return "therapist";
  if (type === "affiliate") return "affiliate";
  return "admin";
}

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

function rowObject(headers, row) {
  const result = {};
  headers.forEach((header, index) => {
    result[String(header || "").trim().toLowerCase()] = row[index];
  });
  return result;
}

function hasFormula(matrix) {
  return (matrix || []).some((row) => (row || []).some((cell) => Boolean(cell)));
}

for (const sheetName of ["Items", "Blueprints", "Plan", "Asset"]) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const used = sheet.getUsedRange();
  if (!used) throw new Error(`${sheetName} has no used range`);
  if (hasFormula(used.formulas)) {
    throw new Error(`${sheetName} contains formulas; refusing to rewrite the canonical table automatically.`);
  }

  const values = used.values;
  const oldHeaders = values[0].map((value) => String(value || "").trim());
  const retainedIndexes = oldHeaders
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => !ownershipKeys.has(header.toLowerCase()));
  const newHeaders = [...retainedIndexes.map(({ header }) => header), ...ownershipHeaders];
  const newRows = [newHeaders];

  for (const row of values.slice(1)) {
    if (!row.some((value) => value !== "" && value !== null && value !== undefined)) continue;
    const old = rowObject(oldHeaders, row);
    const legacyOwnerUser = sheetName === "Asset" ? old.owneruserid : "";
    const createdAt = old.createdat || (sheetName === "Asset" ? old.createddate : "");
    const owner = canonicalOwner(old.owner, old.ownertype);
    const metadata = [
      owner,
      canonicalOwnerType(old.ownertype),
      old.ownerid || legacyOwnerUser || "",
      old.createdbyuserid || legacyOwnerUser || "",
      old.createdbyemail || "",
      old.updatedbyuserid || "",
      old.updatedbyemail || "",
      excelDate(createdAt),
      excelDate(old.updatedat),
    ];
    newRows.push([...retainedIndexes.map(({ index }) => row[index] ?? ""), ...metadata]);
  }

  used.clear({ applyTo: "contents" });
  const endColumn = columnLetter(newHeaders.length);
  const outputRange = sheet.getRange(`A1:${endColumn}${newRows.length}`);
  outputRange.values = newRows;

  const header = sheet.getRange(`A1:${endColumn}1`);
  header.format = {
    fill: "#285F5B",
    font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
    wrapText: true,
    verticalAlignment: "center",
  };
  header.format.rowHeight = 30;
  sheet.freezePanes.freezeRows(1);

  const metadataStart = newHeaders.length - ownershipHeaders.length + 1;
  const widths = [18, 14, 18, 22, 28, 22, 28, 14, 14];
  ownershipHeaders.forEach((name, offset) => {
    const column = metadataStart + offset;
    const range = sheet.getRange(`${columnLetter(column)}2:${columnLetter(column)}${Math.max(newRows.length, 200)}`);
    range.format.font = { name: "Arial", size: 10 };
    range.format.columnWidth = widths[offset];
    if (name === "OwnerType") {
      range.dataValidation = { rule: { type: "list", values: ["admin", "therapist", "affiliate"] } };
    }
    if (name === "createdAt" || name === "updatedAt") {
      range.format.numberFormat = "yyyy-mm-dd";
    }
  });
}

function appendDocumentation(sheetName, rows) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const used = sheet.getUsedRange();
  const start = (used?.rowCount || 0) + 2;
  const end = start + rows.length - 1;
  sheet.getRange(`A${start}:A${end}`).values = rows.map((value) => [value]);
  sheet.getRange(`A${start}`).format = {
    fill: "#285F5B",
    font: { name: "Arial", size: 11, bold: true, color: "#FFFFFF" },
    wrapText: true,
  };
  sheet.getRange(`A${start}:A${end}`).format.wrapText = true;
  sheet.getRange(`A${start}:A${end}`).format.font = { name: "Arial", size: 10 };
}

appendDocumentation("System_Documentation", [
  "Unified ownership and audit model (v9)",
  "Applies to every main entity: Asset, Item, Blueprint and Plan.",
  "Owner is the human-readable current owner. Workbook-managed master content defaults to Recovery Tools.",
  "OwnerType is controlled to admin, therapist or affiliate. Clinic-owned prototype records map to therapist ownership while retaining Clinic as the Owner label.",
  "OwnerID identifies the current owner account or organisation when known; leave it blank rather than inventing an identifier.",
  "CreatedByUserID and CreatedByEmail identify the original creator and should not change when a record is edited.",
  "UpdatedByUserID and UpdatedByEmail identify the most recent editor and should update whenever the app saves a change.",
  "createdAt is set once when a record is created. updatedAt changes on every successful update.",
  "Workbook uploads merge records by stable entity ID. Blank creator or owner identifiers must not erase populated Firestore ownership data.",
  "Legacy Asset OwnerUserID and CreatedDate fields remain available for compatibility; their values have also been copied into the canonical ownership fields where possible.",
]);

appendDocumentation("How to add Content", [
  "Ownership fields (v9)",
  "For Recovery Tools master content, use Owner = Recovery Tools and OwnerType = admin.",
  "Use OwnerType = therapist or affiliate for content owned by those portal users. Record OwnerID when the account ID is known.",
  "Do not overwrite CreatedByUserID, CreatedByEmail or createdAt when editing an existing record. Update the UpdatedBy fields and updatedAt instead.",
  "If identifiers are unknown, leave them blank. The merge importer should preserve existing Firestore values rather than replacing them with blanks.",
]);

const mapping = workbook.worksheets.getItem("Firebase Mapping");
mapping.getRange("A24:E26").values = [
  ["Main entity ownership", "items / blueprints / plans / assets", "entity primary ID", "Owner maps to owner; OwnerType maps to ownerType; OwnerID maps to ownerId. Allowed ownerType values are admin, therapist and affiliate.", "Workbook-managed master content defaults to Recovery Tools/admin. Blank IDs do not overwrite Firestore values during merge."],
  ["Creator and updater audit", "items / blueprints / plans / assets", "entity primary ID", "CreatedByUserID→createdByUid, CreatedByEmail→createdByEmail, UpdatedByUserID→updatedByUid, UpdatedByEmail→updatedByEmail, createdAt→createdAt, updatedAt→updatedAt.", "Creator fields are immutable after creation; updater fields and updatedAt change on save."],
  ["Legacy asset ownership", "assets", "AssetID", "OwnerUserID and CreatedDate remain compatibility fields. Values are copied to OwnerID/CreatedByUserID and createdAt when canonical values are absent.", "Do not treat a blank workbook compatibility field as an instruction to delete populated Firestore ownership."],
];
mapping.getRange("A24:E24").format.fill = "#DDEBF7";
mapping.getRange("A24:E26").format.wrapText = true;
mapping.getRange("A24:E26").format.font = { name: "Arial", size: 10 };

const quality = workbook.worksheets.getItem("Data Quality");
const qualityUsed = quality.getUsedRange();
const qValues = qualityUsed.values;
for (const row of qValues) {
  if (typeof row[0] === "string") {
    row[0] = row[0].replace(/Recovery Tools Master Database v8/g, "Recovery Tools Master Database v9");
  }
  if (typeof row[1] === "string") {
    row[1] = row[1].replace(/Generated from Recovery Tools Master Database \(7\)/g, "Generated from Recovery Tools Master Database (8)");
  }
}
qualityUsed.values = qValues;
const qStart = qualityUsed.rowCount + 2;
quality.getRange(`A${qStart}:F${qStart + 2}`).values = [
  ["OWNERSHIP-SCHEMA", "INFO", "Asset / Item / Blueprint / Plan", "", "", "All main entity sheets use the same nine canonical ownership and audit columns."],
  ["OWNERSHIP-TYPE", "INFO", "OwnerType", "", "", "Controlled values: admin, therapist, affiliate."],
  ["OWNERSHIP-MERGE", "INFO", "Workbook upload", "", "", "Blank ownership or audit values must preserve existing Firestore values during merge."],
];
quality.getRange(`A${qStart}:F${qStart + 2}`).format.wrapText = true;
quality.getRange(`A${qStart}:F${qStart + 2}`).format.font = { name: "Arial", size: 10 };

const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);

const verification = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
for (const sheetName of ["Items", "Blueprints", "Plan", "Asset"]) {
  const sheet = verification.worksheets.getItem(sheetName);
  const headers = sheet.getRange(`A1:${columnLetter(sheet.getUsedRange().columnCount)}1`).values[0];
  const missing = ownershipHeaders.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`${sheetName} missing ownership headers: ${missing.join(", ")}`);
  const ownerTypeIndex = headers.indexOf("OwnerType");
  const invalid = sheet.getUsedRange().values.slice(1)
    .map((row) => row[ownerTypeIndex])
    .filter((value) => value && !["admin", "therapist", "affiliate"].includes(value));
  if (invalid.length) throw new Error(`${sheetName} has invalid OwnerType values: ${[...new Set(invalid)].join(", ")}`);
}

const formulaErrors = await verification.inspect({
  kind: "match",
  searchTerm: "#(REF!|DIV/0!|VALUE!|NAME\\?|N/A)",
  options: { useRegex: true, maxResults: 200 },
  summary: "final formula error scan",
});
console.log("FORMULA_SCAN");
console.log(formulaErrors.ndjson);

const renderFailures = [];
for (const sheet of verification.worksheets.items) {
  try {
    const preview = await verification.render({ sheetName: sheet.name, autoCrop: "all", scale: 0.45, format: "png" });
    const safeName = sheet.name.replace(/[\\/:*?"<>|]/g, "_");
    await fs.writeFile(path.join(previewDir, `${safeName}.png`), new Uint8Array(await preview.arrayBuffer()));
  } catch (error) {
    renderFailures.push(`${sheet.name}: ${error.message}`);
  }
}

console.log(JSON.stringify({
  outputPath,
  sourcePreserved: inputPath,
  sheetCount: verification.worksheets.items.length,
  renderedSheets: verification.worksheets.items.length - renderFailures.length,
  renderFailures,
}, null, 2));
