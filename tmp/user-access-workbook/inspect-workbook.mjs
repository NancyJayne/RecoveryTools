import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc/Recovery Tools Master Database (12).xlsx";
const previewPath = "C:/Users/hello/Firebase project/tmp/user-access-workbook/user-access-before.png";

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
const sheets = await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 12000,
});
console.log(sheets.ndjson);
const access = await workbook.inspect({
  kind: "region",
  sheetId: "User Access",
  range: "A1:Z20",
  maxChars: 12000,
});
console.log(access.ndjson);
const productPriceRange = workbook.worksheets.getItem("ProductPrice").getRange("A8:T11");
console.log(JSON.stringify({
  values: productPriceRange.values,
  formulas: productPriceRange.formulas,
}, null, 2));
const entityTypesRange = workbook.worksheets.getItem("Entity Types").getRange("A1:P35");
console.log(JSON.stringify({ entityTypes: entityTypesRange.values }, null, 2));
for (const [sheetId, range] of [
  ["Firebase Mapping", "A1:E40"],
  ["System_Documentation", "A1:A296"],
  ["ProductPrice", "A8:T11"],
]) {
  const region = await workbook.inspect({
    kind: "region",
    sheetId,
    range,
    maxChars: 20000,
    tableMaxRows: 320,
    tableMaxCols: 6,
  });
  console.log(region.ndjson);
}
const styles = await workbook.inspect({
  kind: "computedStyle",
  sheetId: "User Access",
  range: "A1:Z5",
  maxChars: 6000,
});
console.log(styles.ndjson);
for (const searchTerm of ["User Access", "userAccess", "AccessType"]) {
  const matches = await workbook.inspect({
    kind: "match",
    searchTerm,
    options: { useRegex: false, maxResults: 100 },
    maxChars: 8000,
  });
  console.log(matches.ndjson);
}
const preview = await workbook.render({
  sheetName: "User Access",
  autoCrop: "all",
  scale: 1.5,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
console.log(previewPath);
