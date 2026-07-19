import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbook = await SpreadsheetFile.importXlsx(
  await FileBlob.load("Recovery Tools Master Database (7).xlsx"),
);

console.log((await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 20000,
})).ndjson);

for (const [sheetName, range] of [
  ["Item Templates", "A1:N12"],
  ["ItemTemplateVariants", "A1:T12"],
  ["Blueprint Templates", "A1:N6"],
  ["BlueprintTemplateVariants", "A1:H12"],
  ["BlueprintTemplateFields", "A1:L15"],
  ["Plan Templates", "A1:N12"],
  ["PlanTemplateVariants", "A1:I14"],
  ["PlanTemplateSlots", "A1:L10"],
  ["Firebase Mapping", "A1:E40"],
  ["Data Quality", "A1:F80"],
]) {
  console.log(`\n${sheetName}`);
  console.log((await workbook.inspect({
    kind: "table",
    sheetId: sheetName,
    range,
    include: "values,formulas",
    tableMaxRows: 80,
    tableMaxCols: 24,
    maxChars: 30000,
  })).ndjson);
  const image = await workbook.render({
    sheetName,
    range,
    scale: 1,
    format: "png",
  });
  await fs.writeFile(
    `v7-${sheetName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`,
    new Uint8Array(await image.arrayBuffer()),
  );
}

console.log((await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "formula errors",
})).ndjson);
