import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { CONTENT_BUILDER_OPTIONS } from "./contentBuilderOptions.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const RECORD_TYPES = ["item", "blueprint", "plan", "campaign"];

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value) {
  return cleanString(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function allowedTypesFor(recordType) {
  return {
    item: CONTENT_BUILDER_OPTIONS.itemTypes,
    blueprint: CONTENT_BUILDER_OPTIONS.blueprintTypes,
    plan: CONTENT_BUILDER_OPTIONS.planTypes,
    campaign: CONTENT_BUILDER_OPTIONS.campaignTypes,
  }[recordType] || [];
}

function cleanDefaults(defaults = {}) {
  if (!defaults || typeof defaults !== "object") return {};

  const output = {};
  Object.entries(defaults).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    output[key] = value;
  });
  return output;
}

export const upsertContentBuilderTemplate = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can update content templates.");
    }

    const data = request.data || {};
    const recordType = cleanString(data.recordType).toLowerCase();
    const name = cleanString(data.name);
    const appliesTo = cleanString(data.appliesTo);

    if (!RECORD_TYPES.includes(recordType)) {
      throw new HttpsError("invalid-argument", "Select a valid template area.");
    }
    if (!name) {
      throw new HttpsError("invalid-argument", "Template name is required.");
    }
    if (!allowedTypesFor(recordType).includes(appliesTo)) {
      throw new HttpsError("invalid-argument", "Select a valid type for this template.");
    }

    const id = cleanString(data.id) || `${recordType.toUpperCase()}-TEMPLATE-${slugify(name)}`;
    const template = {
      id,
      name,
      recordType,
      appliesTo,
      isDefault: data.isDefault === true,
      defaults: cleanDefaults(data.defaults),
      updatedAt: new Date().toISOString(),
      updatedByUid: request.auth.uid,
      updatedByEmail: request.auth.token.email || null,
    };

    const ref = admin.firestore().collection("settings").doc("contentBuilderOptions");
    await admin.firestore().runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const current = snap.exists ? snap.data() : {};
      const templateDefinitions = current.templateDefinitions || {};
      const existing = Array.isArray(templateDefinitions[recordType])
        ? templateDefinitions[recordType]
        : [];
      const withoutCurrent = existing.filter((item) => item?.id !== id);

      transaction.set(ref, {
        ...current,
        templateDefinitions: {
          ...templateDefinitions,
          [recordType]: [...withoutCurrent, template],
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    return { success: true, template };
  },
);
