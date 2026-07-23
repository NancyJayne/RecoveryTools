import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = process.argv[2];
const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const sheets = await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 12000,
});
console.log(sheets.ndjson);

const requestedSheetNames = process.argv.slice(3);
const supplierSheetNames = requestedSheetNames.length
  ? requestedSheetNames
  : ["Suppliers", "Supplier"];
for (const sheetName of supplierSheetNames) {
  try {
    const result = await workbook.inspect({
      kind: "region",
      sheetId: sheetName,
      range: "A1:Z20",
      maxChars: 12000,
      tableMaxRows: 20,
      tableMaxCols: 26,
      tableMaxCellChars: 120,
    });
    console.log(`SHEET=${sheetName}`);
    console.log(result.ndjson);
  } catch {
    // Try the next conventional sheet name.
  }
}
