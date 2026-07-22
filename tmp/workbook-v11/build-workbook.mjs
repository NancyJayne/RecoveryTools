import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc/Recovery Tools Master Database (10).xlsx";
const outputDir = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc";
const outputPath = `${outputDir}/Recovery Tools Master Database (11).xlsx`;
const previewDir = "C:/Users/hello/Firebase project/tmp/workbook-v11/previews";

await fs.mkdir(previewDir, { recursive: true });
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

// Visual baseline before edits for the sheets whose structure or documentation changes.
for (const sheetName of ["Items", "Blueprints", "Plan", "Templates", "Firebase Mapping", "Data Quality"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 0.8, format: "png" });
  await fs.writeFile(`${previewDir}/before-${sheetName.replaceAll(" ", "-")}.png`, new Uint8Array(await preview.arrayBuffer()));
}

function renameHeader(sheetName, oldHeader, newHeader) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const headerValues = sheet.getUsedRange().getRow(0).values[0];
  const index = headerValues.findIndex((value) => String(value ?? "").trim() === oldHeader);
  if (index >= 0) sheet.getCell(0, index).values = [[newHeader]];
}

// Retain populated historical values for audit and migration, while making it explicit
// that Categories are no longer main-entity or template fields.
renameHeader("Items", "CategoryID", "LegacyCategoryID (ignored)");
renameHeader("Blueprints", "CategoryID", "LegacyCategoryID (ignored)");
renameHeader("Plan", "CategoryID", "LegacyCategoryID (ignored)");
renameHeader("Entity Types", "DefaultCategoryID", "LegacyDefaultCategoryID (ignored)");
renameHeader("Templates", "DefaultCategoryID", "LegacyDefaultCategoryID (ignored)");
renameHeader("TemplateVariants", "DefaultCategoryID", "LegacyDefaultCategoryID (ignored)");

const mapping = workbook.worksheets.getItem("Firebase Mapping");
mapping.getRange("D2:E4").values = [
  ["Canonical reusable resource. TypeID is required and determines the available/default template. Multiple tags come from ItemTagLinks; entity CategoryID is not persisted.", "LegacyCategoryID is retained for migration history only and is ignored by the v11 importer."],
  ["Type is the primary content classification. Active templates whose AppliesToType matches the selected Type are offered; one may be marked default for that Type.", "DefaultCategoryID is retired. Type capability defaults guide the UI but do not create content."],
  ["Categories group and filter Tags and classify Marketplace Products through Products.ProductCategoryID.", "Do not assign CategoryID to Items, Blueprints or Plans."],
];
mapping.getRange("D7:E7").values = [[
  "Canonical reusable action. BlueprintTypeID determines available/default templates; multiple tags come from BlueprintTagLinks.",
  "LegacyCategoryID is retained for migration history only and ignored.",
]];
mapping.getRange("D10:E10").values = [[
  "Canonical reusable journey. PlanTypeID determines available/default templates; multiple tags come from PlanTagLinks.",
  "LegacyCategoryID is retained for migration history only and ignored.",
]];
mapping.getRange("D21:E22").values = [
  ["Parent template for an Item, Blueprint or Plan Type. AppliesToType controls availability; IsDefault selects the default template for that Type.", "Templates do not pre-filter Tags and do not assign an entity category."],
  ["Every template has at least one selectable variant. TemplateID is required; one active variant may be default.", "Category overrides are retired; variants control field/default differences only."],
];
mapping.getRange("D28:E28").values = [[
  "Products is the canonical commercial offer sheet. ProductCategoryID is the Marketplace category and is independent of content Type.",
  "ItemProduct remains a read-only migration source during compatibility.",
]];

const quality = workbook.worksheets.getItem("Data Quality");
quality.getRange("A1").values = [["Recovery Tools Master Database v11 — Data Quality"]];
quality.getRange("B6").values = [["Recovery Tools Master Database (10).xlsx"]];
quality.getRange("A7").values = [["v11 category model applied: Type drives templates; Categories group Tags and Marketplace Products only."]];

const docs = workbook.worksheets.getItem("System_Documentation");
docs.getRange("A270:A276").values = [
  ["## Unified Template and Classification Model (v11)"],
  ["Templates stores the reusable parent definition for an Item, Blueprint, or Plan Type. AppliesToType controls which templates are available."],
  ["One active template may be marked default for each main entity Type. The creator can still change the template before building content."],
  ["TemplateVariants stores every selectable version of a template. Every template needs at least one variant."],
  ["TemplateFields stores the ordered fields for one VariantID; fields are not shared implicitly between variants."],
  ["Items, Blueprints and Plans do not use CategoryID. Their Type is structural; multiple Tags provide descriptive classification."],
  ["Categories remain as a controlled lookup for grouping/filtering Tags and for Products.ProductCategoryID in the Marketplace."],
];
docs.getRange("A291:A295").values = [
  ["## Product and Asset canonical schema (v11)"],
  ["Products and Assets are independent first-class entities. Neither Product nor Asset is an Item Type."],
  ["Products.ProductCategoryID is the commercial Marketplace category. It must not be copied onto the linked Item, Blueprint or Plan."],
  ["CreatesProduct is available on Items, Blueprints and Plans as an admin workflow toggle. It does not publish or price content."],
  ["Legacy entity CategoryID columns are retained under an ignored heading for migration history; the v11 importer does not persist them."],
];

const howTo = workbook.worksheets.getItem("How to add Content");
howTo.getRange("A1:A4").values = [
  ["New template → add one Templates row for the main entity Type + at least one TemplateVariants row"],
  ["Mark one active template as default for a Type when creators should start with it automatically; they may still choose another"],
  ["Variant-specific structure → add ordered TemplateFields rows linked to that VariantID"],
  ["Use multiple Tag link rows for descriptive classification. Categories only organise Tags and Marketplace Products."],
];

// Compact content/formula checks before export.
console.log((await workbook.inspect({
  kind: "table",
  sheetId: "Firebase Mapping",
  range: "A1:E32",
  include: "values,formulas",
  tableMaxRows: 32,
  tableMaxCols: 5,
  maxChars: 12000,
})).ndjson);
console.log((await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
  maxChars: 6000,
})).ndjson);

// Render every worksheet for the required visual QA pass.
for (const sheet of workbook.worksheets.items) {
  const safeName = sheet.name.replaceAll(/[\\/:*?"<>|]/g, "-");
  const preview = await workbook.render({ sheetName: sheet.name, autoCrop: "all", scale: 0.55, format: "png" });
  await fs.writeFile(`${previewDir}/after-${safeName}.png`, new Uint8Array(await preview.arrayBuffer()));
}

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`SAVED ${outputPath}`);
