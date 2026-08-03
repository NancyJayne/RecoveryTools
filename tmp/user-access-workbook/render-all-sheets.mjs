import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc/Recovery Tools Master Database (13).xlsx";
const renderDir = "C:/Users/hello/Firebase project/tmp/user-access-workbook/all-sheet-renders";
const contactDir = "C:/Users/hello/Firebase project/tmp/user-access-workbook/contact-sheets";
await fs.mkdir(renderDir, { recursive: true });
await fs.mkdir(contactDir, { recursive: true });

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
const sheetInspect = await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 30000,
});
const sheets = sheetInspect.ndjson
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((entry) => entry.kind === "sheet");

const renders = [];
for (let index = 0; index < sheets.length; index += 1) {
  const sheet = sheets[index];
  const safeName = sheet.name.replace(/[<>:"/\\|?*]+/g, "_");
  const outputPath = path.join(renderDir, `${String(index + 1).padStart(2, "0")}-${safeName}.png`);
  const blob = await workbook.render({
    sheetName: sheet.name,
    autoCrop: "all",
    scale: 0.45,
    format: "png",
  });
  await fs.writeFile(outputPath, new Uint8Array(await blob.arrayBuffer()));
  const thumb = await sharp(outputPath)
    .resize(360, 190, { fit: "contain", background: "#FFFFFF" })
    .png()
    .toBuffer();
  const label = Buffer.from(
    `<svg width="360" height="24"><rect width="360" height="24" fill="#407471"/>` +
    `<text x="8" y="17" font-family="Arial" font-size="13" fill="white">${sheet.name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`,
  );
  const tile = await sharp({
    create: { width: 360, height: 214, channels: 4, background: "#FFFFFF" },
  }).composite([
    { input: label, left: 0, top: 0 },
    { input: thumb, left: 0, top: 24 },
  ]).png().toBuffer();
  renders.push(tile);
}

const perPage = 12;
for (let offset = 0; offset < renders.length; offset += perPage) {
  const pageTiles = renders.slice(offset, offset + perPage);
  const composites = pageTiles.map((input, tileIndex) => ({
    input,
    left: (tileIndex % 3) * 370,
    top: Math.floor(tileIndex / 3) * 224,
  }));
  const pagePath = path.join(
    contactDir,
    `sheets-${String(offset + 1).padStart(2, "0")}-${String(offset + pageTiles.length).padStart(2, "0")}.png`,
  );
  await sharp({
    create: { width: 1100, height: 886, channels: 4, background: "#E5E7EB" },
  }).composite(composites).png().toFile(pagePath);
  console.log(pagePath);
}
console.log(`Rendered ${renders.length} worksheets.`);
