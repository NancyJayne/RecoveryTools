import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbook = await SpreadsheetFile.importXlsx(
  await FileBlob.load("Recovery Tools Master Database (6).xlsx"),
);

for (const sheetName of [
  "Blueprint Templates",
  "BlueprintTemplateFields",
  "Plan Templates",
  "PlanTemplateVariants",
  "PlanTemplateSlots",
  "Entity Types",
  "Firebase Mapping",
  "Workbook Guide",
  "Data Quality",
]) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const used = sheet.getUsedRange(true);
  console.log(`\n${sheetName}`);
  console.log(JSON.stringify(used.values, null, 2));
}
