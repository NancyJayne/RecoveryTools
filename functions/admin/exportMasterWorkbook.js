import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import XLSX from "xlsx";

if (!admin.apps.length) admin.initializeApp();

const MASTER_COLLECTIONS = [
  "categories", "tags", "entityTypes", "items", "blueprints", "blueprintItems",
  "blueprintMethods", "blueprintDosage", "plans", "planItems", "planDosage", "planLinks",
  "itemTemplates", "itemTemplateVariants", "blueprintTemplates", "blueprintTemplateVariants",
  "blueprintTemplateFields", "planTemplates", "planTemplateVariants", "planTemplateSlots",
  "contentTemplates", "contentTemplateVariants", "contentTemplateFields", "products", "productLinks",
  "productOptions", "productOptionValues", "productVariants", "productVariantValues",
  "productComponents", "productAccessGrants", "productPrices", "itemVariants", "assets", "entityAssets",
  "assetRenditions", "itemAssets", "inventory", "suppliers", "instructors", "affiliates",
  "pickupLocations", "productVariantPickupLocations", "promotions",
];

function jsonSafe(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.path === "string" && value.firestore) return { __type: "reference", path: value.path };
  if (typeof value.latitude === "number" && typeof value.longitude === "number") {
    return { __type: "geopoint", latitude: value.latitude, longitude: value.longitude };
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]));
  }
  return value;
}

function plain(value) {
  const safe = jsonSafe(value);
  return Array.isArray(safe) || safe && typeof safe === "object" ? JSON.stringify(safe) : safe;
}

function sheetName(collection, index) {
  const suffix = collection.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 26);
  return `FS_${String(index + 1).padStart(2, "0")}_${suffix}`.slice(0, 31);
}

function workbookTimestamp(value) {
  return value.replace(/[:.]/g, "-");
}

export async function buildMasterWorkbook(db) {
  const exportedAt = new Date().toISOString();
  const workbook = XLSX.utils.book_new();
  const guide = [
    ["Recovery Tools editable Firestore master-data export"],
    ["ExportedAt", exportedAt],
    ["Purpose", "Edit master/content records and reseed them with npm run seed:all -- --workbook <file>."],
    ["Safety", "Customer, Order, payment, access-history and promotion-redemption data are excluded."],
    ["Editing", "Keep DocumentID and Collection unchanged. Arrays and objects are stored as JSON text."],
    ["Import", "The importer merges by DocumentID. Missing rows never delete Firestore records."],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(guide), "Workbook Guide");

  const snapshots = await Promise.all(MASTER_COLLECTIONS.map((collection) => db.collection(collection).get()));
  const collectionMap = [["SheetName", "Collection", "RowCount"]];
  snapshots.forEach((snapshot, index) => {
    const collection = MASTER_COLLECTIONS[index];
    const name = sheetName(collection, index);
    const records = snapshot.docs.map((doc) => {
      const data = doc.data() || {};
      const row = { DocumentID: doc.id };
      Object.keys(data).sort().forEach((key) => {
        if (key !== "importSource") row[key] = plain(data[key]);
      });
      return row;
    });
    const worksheet = XLSX.utils.json_to_sheet(records.length ? records : [{ DocumentID: "" }]);
    worksheet["!autofilter"] = { ref: worksheet["!ref"] || "A1:A1" };
    worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
    collectionMap.push([name, collection, records.length]);
  });
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(collectionMap), "CollectionMap");

  return {
    base64: XLSX.write(workbook, { type: "base64", bookType: "xlsx", compression: true }),
    suggestedFileName: `recovery-tools-master-export-${workbookTimestamp(exportedAt)}.xlsx`,
    exportedAt,
  };
}

export const exportMasterWorkbook = onCall(
  { region: "australia-southeast1", timeoutSeconds: 120, memory: "1GiB" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can download the master workbook.");
    }
    try {
      return await buildMasterWorkbook(admin.firestore());
    } catch (error) {
      console.error("Master workbook export failed:", error);
      throw new HttpsError("internal", "The editable master workbook could not be generated.");
    }
  },
);
