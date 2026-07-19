import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const outputDir = "qa-v7-all-sheets";
await fs.mkdir(outputDir, { recursive: true });
const workbook = await SpreadsheetFile.importXlsx(
  await FileBlob.load("Recovery Tools Master Database (7).xlsx"),
);
const manifest = [];

for (const sheet of workbook.worksheets) {
  const safeName = sheet.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const fileName = `${String(sheet.index + 1).padStart(2, "0")}-${safeName || "sheet"}.png`;
  const image = await workbook.render({
    sheetName: sheet.name,
    autoCrop: "all",
    scale: 0.45,
    format: "png",
  });
  await fs.writeFile(
    path.join(outputDir, fileName),
    new Uint8Array(await image.arrayBuffer()),
  );
  manifest.push({ index: sheet.index + 1, name: sheet.name, fileName });
}

await fs.writeFile(
  path.join(outputDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(`Rendered ${manifest.length} worksheets.`);
