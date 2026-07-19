import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const ASSET_TYPES = new Set([
  "Image", "Video", "Audio", "PDF", "Document", "Illustration", "Presentation",
  "Canva Design", "Logo", "Icon", "Animation", "Download",
]);

function clean(value, limit = 2000) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function slugify(value) {
  return clean(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function normalizeRenditions(values = [], assetId = "") {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 50).map((value, index) => {
    const renditionName = clean(value?.renditionName || value?.name, 120);
    const fileUrl = clean(value?.fileUrl || value?.url, 4000);
    if (!renditionName || !fileUrl) return null;
    const assetRenditionId = clean(value?.assetRenditionId || value?.id, 200) ||
      `RENDITION-${slugify(assetId)}-${slugify(renditionName) || index + 1}`;
    return {
      assetRenditionId,
      assetId,
      renditionName,
      purpose: clean(value?.purpose, 120),
      fileUrl,
      storagePath: clean(value?.storagePath, 500),
      mimeType: clean(value?.mimeType, 120),
      fileExtension: clean(value?.fileExtension, 20),
      width: Number(value?.width || 0) || null,
      height: Number(value?.height || 0) || null,
      aspectRatio: clean(value?.aspectRatio, 30),
      cropMode: clean(value?.cropMode, 50),
      isDefault: value?.isDefault === true,
      sortOrder: Number(value?.sortOrder ?? index + 1),
      status: clean(value?.status, 30).toLowerCase() || "active",
    };
  }).filter(Boolean);
}

export const getAdminAssets = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) throw new HttpsError("permission-denied", "Admin access required.");
    const db = admin.firestore();
    const [assets, renditions, entityAssets] = await Promise.all([
      db.collection("assets").limit(1000).get(),
      db.collection("assetRenditions").limit(2000).get(),
      db.collection("entityAssets").limit(3000).get(),
    ]);
    const byAssetId = new Map();
    renditions.docs.forEach((doc) => {
      const data = doc.data() || {};
      const values = byAssetId.get(data.assetId) || [];
      values.push({ id: doc.id, ...data });
      byAssetId.set(data.assetId, values);
    });
    const linksByAssetId = new Map();
    entityAssets.docs.forEach((doc) => {
      const data = doc.data() || {};
      const values = linksByAssetId.get(data.assetId) || [];
      values.push({ id: doc.id, ...data });
      linksByAssetId.set(data.assetId, values);
    });
    return {
      assets: assets.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        renditions: (byAssetId.get(doc.id) || []).sort(
          (left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0),
        ),
        links: (linksByAssetId.get(doc.id) || [])
          .filter((link) => link.status !== "archived")
          .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0)),
      })),
    };
  },
);

export const upsertAdminAsset = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) throw new HttpsError("permission-denied", "Admin access required.");
    const data = request.data || {};
    const assetName = clean(data.assetName || data.name, 200);
    const assetType = ASSET_TYPES.has(data.assetType) ? data.assetType : "Document";
    const fileUrl = clean(data.fileUrl, 4000);
    if (!assetName || !fileUrl) throw new HttpsError("invalid-argument", "Asset name and file are required.");
    const assetId = clean(data.assetId, 200) || `ASSET-${slugify(assetName)}-${Date.now()}`;
    const db = admin.firestore();
    const ref = db.collection("assets").doc(assetId);
    const existing = await ref.get();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const renditions = normalizeRenditions(data.renditions, assetId);
    const existingRenditions = data.replaceRenditions === true
      ? await db.collection("assetRenditions").where("assetId", "==", assetId).get()
      : null;
    const unlinkEntityAssetIds = new Set(
      Array.isArray(data.unlinkEntityAssetIds) ? data.unlinkEntityAssetIds.map((value) => clean(value, 200)) : [],
    );
    const newLinks = Array.isArray(data.newLinks) ? data.newLinks.slice(0, 20) : [];
    const entityCollections = {
      Item: "items",
      Blueprint: "blueprints",
      Plan: "plans",
      Product: "products",
      ProductVariant: "productVariants",
    };
    const normalizedLinks = [];
    for (const [index, link] of newLinks.entries()) {
      const entityType = clean(link?.entityType, 30);
      const entityId = clean(link?.entityId, 200);
      const collection = entityCollections[entityType];
      if (!collection || !entityId) continue;
      const target = await db.collection(collection).doc(entityId).get();
      if (!target.exists) throw new HttpsError("invalid-argument", `${entityType} ${entityId} does not exist.`);
      const entityAssetId = `ENTITYASSET-${slugify(entityType)}-${slugify(entityId)}-${slugify(assetId)}`;
      normalizedLinks.push({
        entityAssetId,
        assetId,
        entityType,
        entityId,
        assetRole: clean(link?.assetRole || link?.role, 120) || "Related",
        fieldKey: clean(link?.fieldKey, 100),
        productVariantId: entityType === "ProductVariant" ? entityId : "",
        isPrimary: link?.isPrimary === true,
        sortOrder: Number(link?.sortOrder ?? index + 1),
        displayStatus: "active",
        visibility: clean(link?.visibility, 30) || "private",
        status: "active",
      });
    }
    const selectedIds = new Set(renditions.map((rendition) => rendition.assetRenditionId));
    const batch = db.batch();
    batch.set(ref, {
      assetId,
      assetName,
      assetType,
      name: assetName,
      type: assetType.toLowerCase(),
      title: clean(data.title || assetName, 200),
      description: clean(data.description, 10000),
      altText: clean(data.altText, 500),
      fileUrl,
      storagePath: clean(data.storagePath, 500),
      originalFilename: clean(data.originalFilename, 255),
      mimeType: clean(data.mimeType, 120),
      ownerUserId: clean(data.ownerUserId, 200) || request.auth.uid,
      creatorUserId: existing.data()?.creatorUserId || request.auth.uid,
      status: clean(data.status, 30).toLowerCase() || "draft",
      approvalStatus: clean(data.approvalStatus, 30).toLowerCase() || "draft",
      visibility: clean(data.visibility, 30).toLowerCase() || "private",
      contentOrigin: "app",
      managedByWorkbook: false,
      createdAt: existing.data()?.createdAt || now,
      updatedAt: now,
      updatedByUid: request.auth.uid,
      updatedByEmail: request.auth.token.email || "",
      notes: clean(data.notes, 5000),
    }, { merge: true });
    renditions.forEach((rendition) => {
      const renditionRef = db.collection("assetRenditions").doc(rendition.assetRenditionId);
      batch.set(renditionRef, {
        ...rendition,
        contentOrigin: "app",
        managedByWorkbook: false,
        createdAt: now,
        updatedAt: now,
        updatedByUid: request.auth.uid,
      }, { merge: true });
    });
    existingRenditions?.docs.forEach((doc) => {
      if (selectedIds.has(doc.id)) return;
      batch.set(doc.ref, { status: "archived", updatedAt: now, updatedByUid: request.auth.uid }, { merge: true });
    });
    normalizedLinks.forEach((link) => {
      batch.set(db.collection("entityAssets").doc(link.entityAssetId), {
        ...link,
        contentOrigin: "app",
        managedByWorkbook: false,
        createdAt: now,
        updatedAt: now,
        updatedByUid: request.auth.uid,
      }, { merge: true });
    });
    unlinkEntityAssetIds.forEach((entityAssetId) => {
      if (!entityAssetId) return;
      batch.set(db.collection("entityAssets").doc(entityAssetId), {
        status: "archived",
        displayStatus: "archived",
        updatedAt: now,
        updatedByUid: request.auth.uid,
      }, { merge: true });
    });
    await batch.commit();
    return { success: true, assetId };
  },
);
