import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const clean = (value) => String(value || "").trim();
const numberOrNull = (value) => value === "" || value === null || value === undefined
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const stringArray = (value) => Array.isArray(value)
  ? [...new Set(value.map(clean).filter(Boolean))]
  : [];

function assertAdmin(request) {
  if (!request.auth?.uid || request.auth.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
}

function promotionPayload(input = {}) {
  const code = clean(input.code).toUpperCase();
  const name = clean(input.name);
  const discountType = clean(input.discountType || "percentage").toLowerCase();
  const discountValue = numberOrNull(input.discountValue) ?? 0;
  if (!code || !name) throw new HttpsError("invalid-argument", "Code and name are required.");
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    throw new HttpsError("invalid-argument", "Use 3-40 letters, numbers, hyphens or underscores for the code.");
  }
  if (!["percentage", "fixed", "free-shipping"].includes(discountType)) {
    throw new HttpsError("invalid-argument", "Choose a valid discount type.");
  }
  if (discountType === "percentage" && (discountValue <= 0 || discountValue > 100)) {
    throw new HttpsError("invalid-argument", "Percentage discounts must be between 0 and 100.");
  }
  if (discountType === "fixed" && discountValue <= 0) {
    throw new HttpsError("invalid-argument", "Enter a fixed discount amount.");
  }
  const startsAt = clean(input.startsAt);
  const endsAt = clean(input.endsAt);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new HttpsError("invalid-argument", "The promotion end must be after its start.");
  }
  return {
    code,
    name,
    discountType,
    discountValue: discountType === "free-shipping" ? 0 : discountValue,
    startsAt,
    endsAt,
    minimumOrder: Math.max(numberOrNull(input.minimumOrder) ?? 0, 0),
    maxUses: Math.max(numberOrNull(input.maxUses) ?? 0, 0),
    usesPerCustomer: Math.max(numberOrNull(input.usesPerCustomer) ?? 1, 1),
    audience: ["all", "retail", "affiliate"].includes(clean(input.audience))
      ? clean(input.audience)
      : "all",
    productIds: stringArray(input.productIds),
    variantIds: stringArray(input.variantIds),
    stackable: input.stackable === true,
    active: input.active !== false,
  };
}

export const managePromotions = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    assertAdmin(request);
    const db = admin.firestore();
    const action = clean(request.data?.action || "list").toLowerCase();
    if (action === "list") {
      const snapshot = await db.collection("promotions").orderBy("code").get();
      return { promotions: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) };
    }
    if (action === "upsert") {
      const payload = promotionPayload(request.data?.promotion);
      const requestedId = clean(request.data?.promotion?.id);
      const id = requestedId || `PROMO-${payload.code}`;
      const duplicate = await db.collection("promotions").where("code", "==", payload.code).get();
      if (duplicate.docs.some((doc) => doc.id !== id)) {
        throw new HttpsError("already-exists", "That promotion code already exists.");
      }
      const ref = db.collection("promotions").doc(id);
      const existing = await ref.get();
      await ref.set({
        promotionId: id,
        ...payload,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByUid: request.auth.uid,
        createdAt: existing.exists
          ? existing.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp()
          : admin.firestore.FieldValue.serverTimestamp(),
        usageCount: Number(existing.data()?.usageCount || 0),
      }, { merge: true });
      return { ok: true, id };
    }
    if (action === "archive") {
      const id = clean(request.data?.promotionId);
      if (!id) throw new HttpsError("invalid-argument", "Promotion ID is required.");
      await db.collection("promotions").doc(id).set({
        active: false,
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByUid: request.auth.uid,
      }, { merge: true });
      return { ok: true };
    }
    throw new HttpsError("invalid-argument", "Unsupported promotion action.");
  },
);
