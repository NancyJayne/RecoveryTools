import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc/Recovery Tools Master Database (10).xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

for (const sheetName of ["Firebase Mapping", "Data Quality", "System_Documentation", "How to add Content"]) {
  console.log(`--- ${sheetName} ---`);
  console.log((await workbook.inspect({
    kind: "table",
    sheetId: sheetName,
    range: "A1:AZ120",
    include: "values,formulas",
    tableMaxRows: 120,
    tableMaxCols: 52,
    maxChars: 40000,
  })).ndjson);
}
