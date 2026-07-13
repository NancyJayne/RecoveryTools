import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { getBusinessProfile, normalizeBusinessProfile } from "../utils/businessProfile.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const ASSET_SLOTS = [
  {
    itemIdField: "logoItemId",
    uploadUrlField: "logoUploadedUrl",
    assetType: "image",
    purpose: "logo",
    title: "Business logo",
  },
  {
    itemIdField: "faviconItemId",
    uploadUrlField: "faviconUploadedUrl",
    assetType: "image",
    purpose: "favicon",
    title: "Favicon",
  },
  {
    itemIdField: "",
    uploadUrlField: "aboutImageUploadedUrl",
    assetType: "image",
    purpose: "about",
    title: "About page image",
  },
  {
    itemIdField: "termsItemId",
    uploadUrlField: "termsPdfUploadedUrl",
    assetType: "pdf",
    purpose: "terms",
    title: "Terms and Conditions",
  },
  {
    itemIdField: "privacyItemId",
    uploadUrlField: "privacyPdfUploadedUrl",
    assetType: "pdf",
    purpose: "privacy",
    title: "Privacy Policy",
  },
  {
    itemIdField: "supportItemId",
    uploadUrlField: "supportPdfUploadedUrl",
    assetType: "pdf",
    purpose: "support",
    title: "Support Policy",
  },
  {
    itemIdField: "commerceItemId",
    uploadUrlField: "commercePdfUploadedUrl",
    assetType: "pdf",
    purpose: "commerce",
    title: "Commerce Information",
  },
];

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeIdPart(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "asset";
}

function normalizedPurpose(value) {
  const purpose = cleanString(value).toLowerCase();
  if (purpose.includes("term")) return "terms";
  if (purpose.includes("privacy")) return "privacy";
  if (purpose.includes("commerce")) return "commerce";
  if (purpose.includes("support")) return "support";
  if (purpose.includes("favicon") || purpose.includes("icon")) return "favicon";
  if (purpose.includes("logo")) return "logo";
  return purpose;
}

function assetNameFromUrl(url, fallback) {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split("/").pop() || "");
    return name || fallback;
  } catch {
    return fallback;
  }
}

function uploadedAssetWrites({ batch, db, slot, itemId, fileUrl, request }) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const timestamp = Date.now();
  const itemAssetId = `${slot.purpose}_${safeIdPart(itemId)}_${timestamp}`;
  const assetId = `${itemAssetId}_asset`;
  const assetName = assetNameFromUrl(fileUrl, slot.title);

  batch.set(db.collection("assets").doc(assetId), {
    assetId,
    name: assetName,
    type: slot.assetType,
    title: slot.title,
    altText: slot.title,
    fileUrl,
    thumbnailUrl: "",
    status: "active",
    ownerUserId: request.auth.uid,
    notes: "Created from Admin > Business Settings.",
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  batch.set(db.collection("itemAssets").doc(itemAssetId), {
    itemAssetId,
    itemId,
    assetId,
    purpose: slot.purpose,
    sortOrder: 0,
    displayStatus: "active",
    contextTitle: slot.title,
    contextAltText: slot.title,
    notes: "Created from Admin > Business Settings.",
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
}

async function archiveExistingPurposeLinks({ batch, db, itemId, purpose }) {
  const snap = await db.collection("itemAssets")
    .where("itemId", "==", itemId)
    .get();

  snap.docs
    .map((doc) => ({ ref: doc.ref, data: doc.data() || {} }))
    .filter(({ data }) => normalizedPurpose(data.purpose) === purpose)
    .forEach(({ ref }) => {
      batch.set(ref, {
        displayStatus: "replaced",
        replacedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
}

export const updateBusinessSettings = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can update business settings.");
    }

    const profile = normalizeBusinessProfile(request.data || {});
    const db = admin.firestore();
    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const slot of ASSET_SLOTS) {
      const itemId = slot.itemIdField ? cleanString(profile[slot.itemIdField]) : "";
      const fileUrl = cleanString(request.data?.[slot.uploadUrlField]);
      if (!fileUrl) continue;
      if (slot.uploadUrlField === "aboutImageUploadedUrl") {
        profile.aboutImageUrl = fileUrl;
        continue;
      }
      if (!itemId) {
        throw new HttpsError(
          "failed-precondition",
          `Add an item ID before uploading ${slot.title}.`,
        );
      }
      await archiveExistingPurposeLinks({ batch, db, itemId, purpose: slot.purpose });
      uploadedAssetWrites({ batch, db, slot, itemId, fileUrl, request });
    }

    batch.set(db.collection("settings").doc("business"), {
      ...profile,
      updatedAt: now,
      updatedByUid: request.auth.uid,
      updatedByEmail: request.auth.token.email || "",
    }, { merge: true });

    await batch.commit();

    return { success: true, business: await getBusinessProfile() };
  },
);
