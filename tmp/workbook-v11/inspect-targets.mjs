import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc/Recovery Tools Master Database (10).xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

for (const sheetName of ["Data Quality", "System_Documentation", "How to add Content"]) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const values = sheet.getUsedRange().values;
  console.log(`--- ${sheetName} ${values.length}x${Math.max(...values.map((row) => row.length))} ---`);
  values.forEach((row, index) => {
    const text = row.filter((value) => value !== null && value !== "").join(" | ");
    if (/categor|template|type|tag|v10|v7|item|blueprint|plan/i.test(text)) {
      console.log(`${index + 1}: ${text}`);
    }
  });
}
