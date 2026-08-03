import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc/Recovery Tools Master Database (12).xlsx";
const outputDir = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc";
const outputPath = `${outputDir}/Recovery Tools Master Database (13).xlsx`;
const previewDir = "C:/Users/hello/Firebase project/tmp/user-access-workbook/previews";

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));

// Row 10 is an empty reserved ProductPrice row with stale cached formula errors.
// It has no PriceID and is ignored by the importer, so remove only those orphan formulas.
const prices = workbook.worksheets.getItem("ProductPrice");
for (const range of ["H10", "K10:N10", "Q10:T10"]) {
  prices.getRange(range).clear({ applyTo: "contents" });
}

const access = workbook.worksheets.getItem("User Access");
const accessHeaders = [
  "UserAccessID",
  "UserID",
  "AccessType",
  "AccessID",
  "AccessVariantID",
  "SourceProductID",
  "SourceOrderID",
  "GrantedAt",
  "ExpiresAt",
  "Revocable",
  "Active",
  "RevokedAt",
  "Notes",
];
access.getRange("A1:M1").values = [accessHeaders];
access.getRange("A1:M1").format = {
  fill: "#407471",
  font: { bold: true, color: "#FFFFFF", typeface: "Arial" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
access.getRange("A1:M1").format.rowHeight = 32;
access.getRange("A1:M500").format.columnWidth = 18;
access.getRange("A1:A500").format.columnWidth = 34;
access.getRange("B1:B500").format.columnWidth = 24;
access.getRange("D1:D500").format.columnWidth = 28;
access.getRange("E1:G500").format.columnWidth = 24;
access.getRange("H1:I500").format.columnWidth = 20;
access.getRange("M1:M500").format.columnWidth = 36;
access.getRange("H2:I500").format.numberFormat = "yyyy-mm-dd hh:mm";
access.getRange("L2:L500").format.numberFormat = "yyyy-mm-dd hh:mm";
access.getRange("C2:C500").dataValidation = {
  rule: { type: "list", values: ["Item", "Blueprint", "Plan"] },
};
access.getRange("J2:K500").dataValidation = {
  rule: { type: "list", values: ["Yes", "No"] },
};
access.freezePanes.freezeRows(1);

const mapping = workbook.worksheets.getItem("Firebase Mapping");
mapping.getRange("A35:E35").copyTo(mapping.getRange("A36:E36"), "all");
mapping.getRange("A36:E36").values = [[
  "User Access",
  "userAccess",
  "UserAccessID",
  "Seed or update access with merge-only rows. AccessType is Item, Blueprint or Plan; AccessID is the target's stable ID. The target Type controls the profile section.",
  "Active=No revokes display. Blank ExpiresAt means permanent access. Firestore-only access is never deleted.",
]];
mapping.getRange("A36:E36").format.wrapText = true;
mapping.getRange("A36:E36").format.rowHeight = 54;
mapping.getRange("D1:E36").format.columnWidth = 48;
mapping.getRange("A1:E36").format.wrapText = true;
mapping.getRange("A1:E36").format.autofitRows();

const docs = workbook.worksheets.getItem("System_Documentation");
docs.getRange("A297:A303").values = [
  ["## Canonical customer access (v13)"],
  ["User Access can target any reusable Item, Blueprint or Plan. AccessType identifies the main entity and AccessID is its stable ID."],
  ["The referenced entity Type determines whether the record appears under My Courses, My Workshops or My Programs."],
  ["Use a deterministic UserAccessID such as {UserID}_{AccessType}_{AccessID}; importing the same ID updates rather than duplicates the grant."],
  ["Active and Revocable default to Yes. Leave ExpiresAt blank for permanent access."],
  ["To revoke seeded access, set Active to No and optionally enter RevokedAt. Workbook imports never delete Firestore-only access."],
  ["SourceProductID and SourceOrderID are optional audit links; purchases populate them automatically."],
];
docs.getRange("A297:A303").format.wrapText = true;
docs.getRange("A1:A303").format.columnWidth = 110;
docs.getRange("A1:A303").format.wrapText = true;
docs.getRange("A1:A303").format.autofitRows();

await fs.mkdir(previewDir, { recursive: true });
for (const [sheetName, range, fileName] of [
  ["User Access", "A1:M8", "user-access-after.png"],
  ["Firebase Mapping", "A32:E36", "firebase-mapping-after.png"],
  ["System_Documentation", "A291:A303", "system-documentation-after.png"],
]) {
  const preview = await workbook.render({
    sheetName,
    range,
    scale: 1.5,
    format: "png",
  });
  await fs.writeFile(
    `${previewDir}/${fileName}`,
    new Uint8Array(await preview.arrayBuffer()),
  );
}

const accessCheck = await workbook.inspect({
  kind: "region",
  sheetId: "User Access",
  range: "A1:M5",
  maxChars: 8000,
});
console.log(accessCheck.ndjson);
const mappingCheck = await workbook.inspect({
  kind: "region",
  sheetId: "Firebase Mapping",
  range: "A32:E36",
  maxChars: 8000,
});
console.log(mappingCheck.ndjson);
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(formulaErrors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
