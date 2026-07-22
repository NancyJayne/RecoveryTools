import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc/Recovery Tools Master Database (10).xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
console.log((await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 12000,
})).ndjson);
for (const sheetName of ["Items", "Blueprints", "Plan", "Templates", "Products", "Tags", "Category", "Firebase Mapping", "Data Quality"]) {
  try {
    console.log(`--- ${sheetName} ---`);
    console.log((await workbook.inspect({
      kind: "table",
      sheetId: sheetName,
      range: "A1:AZ8",
      include: "values,formulas",
      tableMaxRows: 8,
      tableMaxCols: 52,
      maxChars: 12000,
    })).ndjson);
  } catch (error) {
    console.log(`MISSING ${sheetName}: ${error.message}`);
  }
}
