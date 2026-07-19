import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "Recovery Tools Master Database (6).xlsx";
const outputPath = "Recovery Tools Master Database (7).xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

const itemTypes = [
  "tool",
  "clinical supply",
  "exercise equipment",
  "course",
  "FAQ",
  "workshop",
  "content",
  "part",
  "program",
  "anato-me",
  "policy",
  "event",
  "outcome measure",
];
const blueprintTypes = [
  "recovery activity",
  "clinical test",
  "treatment technique",
  "client education",
  "anato-me story",
  "quiz",
  "therapist education",
  "business workflow",
  "marketing content",
  "product manufacture",
];
const planTypes = [
  "course",
  "workshop",
  "treatment plan",
  "assessment",
  "reassessment",
  "business manual",
  "recovery plan",
  "business workflow",
  "campaign",
];
const booleanValidation = { rule: { type: "list", values: ["TRUE", "FALSE"] } };
const headerFormat = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: "#B4C6E7" },
};
const bodyFormat = {
  verticalAlignment: "top",
  wrapText: true,
  borders: { preset: "all", style: "thin", color: "#D9E2F3" },
};

function setUsefulWidths(sheet, widths) {
  widths.forEach(([range, width]) => {
    sheet.getRange(range).format.columnWidth = width;
  });
}

function appendDocumentationRows(sheetName, rows) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const used = sheet.getUsedRange(true);
  const existing = used.values || [];
  const existingKeys = new Set(existing.slice(1).map((row) => String(row[0] || "").trim()));
  const newRows = rows.filter((row) => !existingKeys.has(row[0]));
  if (!newRows.length) return;
  const startRow = existing.length + 1;
  const endRow = startRow + newRows.length - 1;
  const range = sheet.getRange(`A${startRow}:E${endRow}`);
  range.values = newRows;
  range.format.wrapText = true;
  range.format.verticalAlignment = "top";
}

let itemTemplates = workbook.worksheets.getItemOrNullObject("Item Templates");
if (itemTemplates.isNullObject) {
  itemTemplates = workbook.worksheets.add("Item Templates");
}
const itemTemplateHeaders = [
  "ItemTemplateID",
  "TemplateName",
  "ItemType",
  "Description",
  "CreatedByUserID",
  "OwnerType",
  "OwnerID",
  "Visibility",
  "ApprovalStatus",
  "IsMasterTemplate",
  "CanBeCopied",
  "Active",
  "Version",
  "Notes",
];
itemTemplates.getRange("A1:N1").values = [itemTemplateHeaders];
itemTemplates.getRange("A1:N1").format = headerFormat;
itemTemplates.getRange("A2:N200").format = bodyFormat;
itemTemplates.getRange("C2:C200").dataValidation = {
  rule: { type: "list", values: itemTypes },
};
for (const column of ["J", "K", "L"]) {
  itemTemplates.getRange(`${column}2:${column}200`).dataValidation = booleanValidation;
}
itemTemplates.freezePanes.freezeRows(1);
setUsefulWidths(itemTemplates, [
  ["A:A", 22], ["B:B", 28], ["C:C", 22], ["D:D", 44], ["E:G", 20],
  ["H:I", 16], ["J:L", 15], ["M:M", 10], ["N:N", 40],
]);

let itemTemplateVariants = workbook.worksheets.getItemOrNullObject("ItemTemplateVariants");
if (itemTemplateVariants.isNullObject) {
  itemTemplateVariants = workbook.worksheets.add("ItemTemplateVariants");
}
const itemVariantHeaders = [
  "VariantID",
  "ItemTemplateID",
  "VariantName",
  "Description",
  "ItemKind",
  "CategoryID",
  "IsShopProduct",
  "RequiresShipping",
  "InventoryTracked",
  "SoldByRecoveryTools",
  "UnlocksAccess",
  "AccessType",
  "RequiresCalendar",
  "RequiresSessionTime",
  "TracksSeats",
  "DeliveryMode",
  "Active",
  "IsDefault",
  "SortOrder",
  "Notes",
];
itemTemplateVariants.getRange("A1:T1").values = [itemVariantHeaders];
itemTemplateVariants.getRange("A1:T1").format = headerFormat;
itemTemplateVariants.getRange("A2:T200").format = bodyFormat;
itemTemplateVariants.getRange("B2:B200").dataValidation = {
  rule: { type: "list", formula1: "'Item Templates'!$A$2:$A$200" },
};
itemTemplateVariants.getRange("F2:F200").dataValidation = {
  rule: { type: "list", formula1: "Category!$A$2:$A$200" },
};
for (const column of ["G", "H", "I", "J", "K", "M", "N", "O", "Q", "R"]) {
  itemTemplateVariants.getRange(`${column}2:${column}200`).dataValidation = booleanValidation;
}
itemTemplateVariants.freezePanes.freezeRows(1);
setUsefulWidths(itemTemplateVariants, [
  ["A:B", 24], ["C:C", 28], ["D:D", 42], ["E:E", 22], ["F:F", 18],
  ["G:R", 18], ["S:S", 12], ["T:T", 40],
]);

const blueprintTemplates = workbook.worksheets.getItem("Blueprint Templates");
blueprintTemplates.getRange("C2").values = [["recovery activity"]];
blueprintTemplates.getRange("F2").values = [["Recovery Tools"]];
blueprintTemplates.getRange("H2:I2").values = [["Private", "Draft"]];
blueprintTemplates.getRange("C2:C200").dataValidation = {
  rule: { type: "list", values: blueprintTypes },
};
blueprintTemplates.freezePanes.freezeRows(1);
blueprintTemplates.getRange("A1:N1").format.wrapText = true;
setUsefulWidths(blueprintTemplates, [
  ["A:A", 22], ["B:B", 28], ["C:C", 22], ["D:D", 42], ["E:G", 20],
  ["H:I", 18], ["J:L", 16], ["M:M", 10], ["N:N", 34],
]);

let blueprintVariants = workbook.worksheets.getItemOrNullObject("BlueprintTemplateVariants");
if (blueprintVariants.isNullObject) {
  blueprintVariants = workbook.worksheets.add("BlueprintTemplateVariants");
}
blueprintVariants.getRange("A1:H2").values = [
  [
    "VariantID",
    "BlueprintTemplateID",
    "VariantName",
    "Description",
    "Active",
    "IsDefault",
    "SortOrder",
    "Notes",
  ],
  [
    "BTV-EX-STANDARD",
    "BT-EX-HOWTO",
    "Standard Exercise How-To",
    "Default variant for the Exercise How-To Blueprint template",
    true,
    true,
    1,
    null,
  ],
];
blueprintVariants.getRange("A1:H1").format = headerFormat;
blueprintVariants.getRange("A2:H200").format = bodyFormat;
blueprintVariants.getRange("B2:B200").dataValidation = {
  rule: { type: "list", formula1: "'Blueprint Templates'!$A$2:$A$200" },
};
for (const column of ["E", "F"]) {
  blueprintVariants.getRange(`${column}2:${column}200`).dataValidation = booleanValidation;
}
blueprintVariants.freezePanes.freezeRows(1);
setUsefulWidths(blueprintVariants, [
  ["A:B", 26], ["C:C", 30], ["D:D", 46], ["E:G", 14], ["H:H", 38],
]);

const blueprintFields = workbook.worksheets.getItem("BlueprintTemplateFields");
const blueprintFieldRows = [
  ["BTF-EX-IMAGE", "BT-EX-HOWTO", "Image", "Linked Item List", "Items", false, false, null, null, false, 1, null],
  ["BTF-EX-PURPOSE", "BT-EX-HOWTO", "Purpose", "Long Text", null, true, false, 1, null, false, 3, null],
  ["BTF-EX-001", "BT-EX-HOWTO", "Equipment Needed", "Linked Item List", "Items", false, true, 0, null, true, 2, null],
  ["BTF-EX-START", "BT-EX-HOWTO", "Starting Position", "Long Text", null, true, false, 1, null, false, 4, null],
  ["BTF-EX-MOVEMENT", "BT-EX-HOWTO", "Movement Instructions", "Long Text", null, true, false, 1, null, false, 5, null],
  ["BTF-EX-MISTAKES", "BT-EX-HOWTO", "Common Mistakes", "Long Text", null, false, true, null, null, false, 6, null],
  ["BTF-EX-PROGRESSIONS", "BT-EX-HOWTO", "Progressions", "Linked Blueprint List", "Blueprints", false, true, null, null, false, 7, null],
  ["BTF-EX-REGRESSIONS", "BT-EX-HOWTO", "Regressions", "Linked Blueprint List", "Blueprints", false, true, null, null, false, 8, null],
  ["BTF-EX-CONTRA", "BT-EX-HOWTO", "Contraindications", "Long Text", null, false, false, null, null, false, 9, null],
  ["BTF-EX-THERAPIST", "BT-EX-HOWTO", "Therapist Notes", "Long Text", null, false, false, null, null, false, 10, null],
  ["BTF-EX-CLIENT", "BT-EX-HOWTO", "Client Explanation", "Long Text", null, false, false, null, null, false, 11, null],
];
blueprintFields.getRange("A2:L12").values = blueprintFieldRows;
blueprintFields.getRange("B2:B200").dataValidation = {
  rule: { type: "list", formula1: "'Blueprint Templates'!$A$2:$A$200" },
};
for (const column of ["F", "G", "J"]) {
  blueprintFields.getRange(`${column}2:${column}200`).dataValidation = booleanValidation;
}
blueprintFields.freezePanes.freezeRows(1);
setUsefulWidths(blueprintFields, [
  ["A:B", 24], ["C:C", 26], ["D:E", 22], ["F:G", 12], ["H:K", 14], ["L:L", 38],
]);

const planTemplates = workbook.worksheets.getItem("Plan Templates");
planTemplates.getRange("C2:I2").values = [[
  "recovery plan",
  "Builds structured exercise plans from reusable Blueprint slots",
  "USER-001",
  "Recovery Tools",
  "RECOVERYTOOLS",
  "Private",
  "Draft",
]];
const planTemplateRows = [
  ["PT-COURSE", "Course Plan Builder", "course", "Flexible starter for an ordered course made from reusable Blueprints and Items", "USER-001", "Recovery Tools", "RECOVERYTOOLS", "Private", "Draft", true, true, true, 1, "Default starter; customise structure in the app or workbook."],
  ["PT-WORKSHOP", "Workshop Plan Builder", "workshop", "Flexible starter for a workshop made from reusable Blueprints and Items", "USER-001", "Recovery Tools", "RECOVERYTOOLS", "Private", "Draft", true, true, true, 1, "Default starter; customise structure in the app or workbook."],
  ["PT-TREATMENT", "Treatment Plan Builder", "treatment plan", "Flexible starter for a reusable treatment journey", "USER-001", "Recovery Tools", "RECOVERYTOOLS", "Private", "Draft", true, true, true, 1, "Default starter; customise structure in the app or workbook."],
  ["PT-ASSESSMENT", "Assessment Builder", "assessment", "Flexible starter for an ordered assessment", "USER-001", "Recovery Tools", "RECOVERYTOOLS", "Private", "Draft", true, true, true, 1, "Default starter; customise structure in the app or workbook."],
  ["PT-REASSESSMENT", "Reassessment Builder", "reassessment", "Flexible starter for an ordered reassessment", "USER-001", "Recovery Tools", "RECOVERYTOOLS", "Private", "Draft", true, true, true, 1, "Default starter; customise structure in the app or workbook."],
  ["PT-BUSINESS-MANUAL", "Business Manual Builder", "business manual", "Flexible starter for a reusable business manual", "USER-001", "Recovery Tools", "RECOVERYTOOLS", "Private", "Draft", true, true, true, 1, "Default starter; customise structure in the app or workbook."],
  ["PT-BUSINESS-WORKFLOW", "Business Workflow Builder", "business workflow", "Flexible starter for an ordered business workflow", "USER-001", "Recovery Tools", "RECOVERYTOOLS", "Private", "Draft", true, true, true, 1, "Default starter; customise structure in the app or workbook."],
  ["PT-CAMPAIGN", "Campaign Plan Builder", "campaign", "Flexible starter for a campaign that can collect tagged marketing content, Plans, Blueprints, and Items", "USER-001", "Recovery Tools", "RECOVERYTOOLS", "Private", "Draft", true, true, true, 1, "Default starter; customise structure in the app or workbook."],
];
for (let index = 0; index < planTemplateRows.length; index += 1) {
  const rowNumber = index + 3;
  planTemplates.getRange(`A${rowNumber}:N${rowNumber}`).copyFrom(
    planTemplates.getRange("A2:N2"),
    "all",
  );
  planTemplates.getRange(`A${rowNumber}:N${rowNumber}`).values = [planTemplateRows[index]];
}
planTemplates.getRange("C2:C200").dataValidation = {
  rule: { type: "list", values: planTypes },
};
planTemplates.freezePanes.freezeRows(1);
setUsefulWidths(planTemplates, [
  ["A:A", 24], ["B:B", 28], ["C:C", 22], ["D:D", 48], ["E:G", 20],
  ["H:I", 16], ["J:L", 15], ["M:M", 10], ["N:N", 42],
]);

const variants = workbook.worksheets.getItem("PlanTemplateVariants");
variants.getRange("I1:I3").values = [["IsDefault"], [true], [false]];
variants.getRange("I2:I200").dataValidation = booleanValidation;
const planVariantRows = [
  ["PTV-COURSE-DEFAULT", "PT-COURSE", "Default Course Plan", null, "Default", "Flexible course starter with no forced slots", true, 1, true],
  ["PTV-WORKSHOP-DEFAULT", "PT-WORKSHOP", "Default Workshop Plan", null, "Default", "Flexible workshop starter with no forced slots", true, 1, true],
  ["PTV-TREATMENT-DEFAULT", "PT-TREATMENT", "Default Treatment Plan", null, "Default", "Flexible treatment plan starter with no forced slots", true, 1, true],
  ["PTV-ASSESSMENT-DEFAULT", "PT-ASSESSMENT", "Default Assessment", null, "Default", "Flexible assessment starter with no forced slots", true, 1, true],
  ["PTV-REASSESSMENT-DEFAULT", "PT-REASSESSMENT", "Default Reassessment", null, "Default", "Flexible reassessment starter with no forced slots", true, 1, true],
  ["PTV-BUSINESS-MANUAL-DEFAULT", "PT-BUSINESS-MANUAL", "Default Business Manual", null, "Default", "Flexible business manual starter with no forced slots", true, 1, true],
  ["PTV-BUSINESS-WORKFLOW-DEFAULT", "PT-BUSINESS-WORKFLOW", "Default Business Workflow", null, "Default", "Flexible business workflow starter with no forced slots", true, 1, true],
  ["PTV-CAMPAIGN-DEFAULT", "PT-CAMPAIGN", "Default Campaign Plan", null, "Default", "Flexible campaign starter with no forced slots", true, 1, true],
];
for (let index = 0; index < planVariantRows.length; index += 1) {
  const rowNumber = index + 4;
  variants.getRange(`A${rowNumber}:I${rowNumber}`).copyFrom(
    variants.getRange("A2:I2"),
    "all",
  );
  variants.getRange(`A${rowNumber}:I${rowNumber}`).values = [planVariantRows[index]];
}
variants.getRange("B2:B200").dataValidation = {
  rule: { type: "list", formula1: "'Plan Templates'!$A$2:$A$200" },
};
variants.freezePanes.freezeRows(1);
setUsefulWidths(variants, [
  ["A:B", 28], ["C:C", 30], ["D:D", 16], ["E:E", 14], ["F:F", 46],
  ["G:I", 14],
]);

const slots = workbook.worksheets.getItem("PlanTemplateSlots");
slots.getRange("B2:B200").dataValidation = {
  rule: { type: "list", formula1: "'PlanTemplateVariants'!$A$2:$A$200" },
};
slots.getRange("E2:E200").dataValidation = {
  rule: { type: "list", values: blueprintTypes },
};
slots.freezePanes.freezeRows(1);

appendDocumentationRows("Firebase Mapping", [
  ["Item Templates", "itemTemplates", "ItemTemplateID", "Parent definition for an Item template and its ItemType. A parent needs at least one active variant to appear in the Builder.", "App-created templates remain stored in settings/contentBuilderOptions and are merged by ID."],
  ["ItemTemplateVariants", "itemTemplateVariants", "VariantID", "Selectable Item template variants store category, item kind, commerce, inventory, access, session, and delivery defaults.", "Blank parent and variant sheets mean there are no workbook Item templates."],
  ["Blueprint Templates", "blueprintTemplates", "BlueprintTemplateID", "Parent definition for a Blueprint template and its BlueprintType. A parent needs at least one active variant to appear in the Builder.", "BlueprintTemplateFields are loaded as the shared parent field guide."],
  ["BlueprintTemplateVariants", "blueprintTemplateVariants", "VariantID", "Each active variant becomes a selectable Blueprint template and inherits type, ownership, visibility, approval, and fields from its parent.", "IsDefault selects the initial variant for the BlueprintType."],
  ["BlueprintTemplateFields", "blueprintTemplateFields", "FieldID", "Rows attach ordered required/repeatable field guidance to a Blueprint template.", "Field IDs and BlueprintTemplateID must be stable."],
  ["Plan Templates + PlanTemplateVariants", "planTemplates + planTemplateVariants", "PlanTemplateID + VariantID", "Each active variant becomes a selectable Plan template. IsDefault selects the initial variant for each PlanType.", "PlanTemplateSlots are optional; no slots means a flexible Plan assembled in Relationships."],
]);

const dataQuality = workbook.worksheets.getItem("Data Quality");
dataQuality.getRange("A1").values = [["Recovery Tools Master Database v7 — Data Quality"]];
dataQuality.getRange("B7").values = [[inputPath]];
dataQuality.getRange("A13:F15").values = [
  ["TEMPLATE-ITEMS", "Info", "ItemTemplateVariants", null, "VariantID / ItemTemplateID", "Every Item variant needs a unique VariantID and valid ItemTemplateID; only one default per ItemType."],
  ["TEMPLATE-BLUEPRINTS", "Info", "BlueprintTemplateVariants", null, "VariantID / BlueprintTemplateID", "Every Blueprint variant needs a unique VariantID and valid BlueprintTemplateID; fields reference the parent template."],
  ["TEMPLATE-PLANS", "Info", "PlanTemplateVariants", null, "IsDefault", "Every active Plan type needs at least one active variant; only one variant per type should be IsDefault."],
];
dataQuality.getRange("A13:F15").format.wrapText = true;

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
