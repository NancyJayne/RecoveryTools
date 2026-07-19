import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "Recovery Tools Master Database (6).xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

console.log((await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 12000,
})).ndjson);

for (const [sheetName, range] of [
  ["Blueprint Templates", "A1:N20"],
  ["BlueprintTemplateFields", "A1:N30"],
  ["Plan Templates", "A1:N20"],
  ["PlanTemplateVariants", "A1:J20"],
  ["PlanTemplateSlots", "A1:M30"],
  ["Entity Types", "A1:M45"],
]) {
  console.log(`\n--- ${sheetName} ---`);
  console.log((await workbook.inspect({
    kind: "table",
    sheetId: sheetName,
    range,
    include: "values,formulas",
    tableMaxRows: 45,
    tableMaxCols: 16,
    maxChars: 18000,
  })).ndjson);
  console.log((await workbook.inspect({
    kind: "computedStyle",
    sheetId: sheetName,
    range: "A1:F5",
    maxChars: 4000,
  })).ndjson);
  const image = await workbook.render({
    sheetName,
    range,
    scale: 1.25,
    format: "png",
  });
  await fs.writeFile(
    `preview-${sheetName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`,
    new Uint8Array(await image.arrayBuffer()),
  );
}
