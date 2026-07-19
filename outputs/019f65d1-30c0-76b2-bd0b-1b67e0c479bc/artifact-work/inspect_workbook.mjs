import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const baseDir = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc";
const inputPath = path.join(baseDir, "Recovery Tools Master Database (8).xlsx");
const previewDir = path.join(baseDir, "artifact-work", "before-previews");
await fs.mkdir(previewDir, { recursive: true });

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheetInfo = await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 20000,
});
console.log("SHEETS");
console.log(sheetInfo.ndjson);

for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange();
  const address = used?.address || "A1";
  const sample = await workbook.inspect({
    kind: "table",
    sheetId: sheet.name,
    range: address,
    include: "values,formulas",
    tableMaxRows: 4,
    tableMaxCols: 80,
    tableMaxCellChars: 100,
    maxChars: 16000,
  });
  console.log(`SAMPLE ${sheet.name} ${address}`);
  console.log(sample.ndjson);

  const preview = await workbook.render({
    sheetName: sheet.name,
    autoCrop: "all",
    scale: 0.75,
    format: "png",
  });
  const safeName = sheet.name.replace(/[\\/:*?"<>|]/g, "_");
  await fs.writeFile(
    path.join(previewDir, `${safeName}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}
