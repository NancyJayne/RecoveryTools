import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const file = "C:/Users/hello/Firebase project/outputs/019f65d1-30c0-76b2-bd0b-1b67e0c479bc/Recovery Tools Master Database (9).xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file));
const required = ["Owner", "OwnerType", "OwnerID", "CreatedByUserID", "CreatedByEmail", "UpdatedByUserID", "UpdatedByEmail", "createdAt", "updatedAt"];
const summary = {};

for (const name of ["Items", "Blueprints", "Plan", "Asset"]) {
  const sheet = workbook.worksheets.getItem(name);
  const values = sheet.getUsedRange().values;
  const headers = values[0];
  const ownerIndex = headers.indexOf("Owner");
  const typeIndex = headers.indexOf("OwnerType");
  const types = {};
  let blankOwners = 0;
  for (const row of values.slice(1)) {
    if (!row.some((cell) => cell !== "" && cell !== null && cell !== undefined)) continue;
    if (!row[ownerIndex]) blankOwners += 1;
    types[row[typeIndex] || "(blank)"] = (types[row[typeIndex] || "(blank)"] || 0) + 1;
  }
  summary[name] = {
    records: values.length - 1,
    missingHeaders: required.filter((header) => !headers.includes(header)),
    blankOwners,
    ownerTypes: types,
    lastHeaders: headers.slice(-9),
  };
}
console.log(JSON.stringify(summary, null, 2));
