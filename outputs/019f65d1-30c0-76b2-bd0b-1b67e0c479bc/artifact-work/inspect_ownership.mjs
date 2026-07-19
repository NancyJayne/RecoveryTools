import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc/Recovery Tools Master Database (8).xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

for (const [sheetName, range] of [
  ["Items", "A1:Y8"],
  ["Blueprints", "A1:Y8"],
  ["Plan", "A1:AC8"],
  ["Asset", "A1:K8"],
  ["Firebase Mapping", "A1:E26"],
  ["Data Quality", "A1:F15"],
]) {
  const table = await workbook.inspect({
    kind: "table",
    sheetId: sheetName,
    range,
    include: "values,formulas",
    tableMaxRows: 10,
    tableMaxCols: 40,
    maxChars: 16000,
  });
  const style = await workbook.inspect({
    kind: "computedStyle",
    sheetId: sheetName,
    range: range.split(":")[0] + ":" + range.split(":")[1].replace(/\d+$/, "2"),
    maxChars: 5000,
  });
  console.log(`TABLE ${sheetName}`);
  console.log(table.ndjson);
  console.log(`STYLE ${sheetName}`);
  console.log(style.ndjson);
}
