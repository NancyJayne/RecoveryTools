import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedStatus(value) {
  return cleanString(value).toLowerCase();
}

function collectIds(value, prefix, output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectIds(entry, prefix, output));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectIds(entry, prefix, output));
  } else {
    const id = cleanString(value);
    if (id.startsWith(prefix)) output.push(id);
  }
  return output;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function accessIsActive(access) {
  if (!access || access.active !== true || access.revokedAt) return false;
  const expiry = access.expiresAt?.toDate?.() ||
    (access.expiresAt ? new Date(access.expiresAt) : null);
  return !expiry || Number.isNaN(expiry.getTime()) || expiry.getTime() > Date.now();
}

function publicContent(record, id) {
  return {
    id,
    name: record.name || record.title || id,
    type: record.type || record.itemType || record.blueprintType || record.planType || "",
    shortDescription: record.shortDescription || record.description || "",
    longDescription: record.longDescription || record.notes || "",
    durationMinutes: Number(record.durationMinutes || 0) || null,
    templateFieldValues: record.templateFieldValues || {},
  };
}

function publicAsset(asset, id) {
  return {
    id,
    type: normalizedStatus(asset.assetType || asset.type),
    title: asset.title || asset.assetName || asset.name || id,
    url: asset.fileUrl || asset.url || "",
    embedUrl: asset.embedUrl || "",
    altText: asset.altText || "",
  };
}

async function assetsForRecord(db, record, recordId, entityVariantId = "") {
  const linkedAssetsSnapshot = recordId
    ? await db.collection("entityAssets").where("entityId", "==", recordId).get()
    : null;
  const linkedAssetIds = linkedAssetsSnapshot?.docs
    .filter((snapshot) => {
      const link = snapshot.data() || {};
      const linkedVariantId = cleanString(link.entityVariantId);
      return !["archived", "inactive"].includes(normalizedStatus(link.status)) &&
        (!entityVariantId || !linkedVariantId || linkedVariantId === entityVariantId);
    })
    .map((snapshot) => cleanString(snapshot.data()?.assetId)) || [];
  const assetIds = unique([
    ...collectIds(record.templateFieldValues, "ASSET-"),
    ...collectIds(record.entityVariants, "ASSET-"),
    ...linkedAssetIds,
  ]);
  const snapshots = await Promise.all(assetIds.map((assetId) =>
    db.collection("assets").doc(assetId).get()));
  return snapshots
    .map((snapshot, index) => {
      if (!snapshot.exists) return null;
      const asset = snapshot.data() || {};
      if (["archived", "inactive"].includes(normalizedStatus(asset.status))) return null;
      return publicAsset(asset, assetIds[index]);
    })
    .filter((asset) => asset?.url || asset?.embedUrl);
}

async function purchasedProductVariant(db, access, accessId) {
  let variantId = cleanString(access.sourceProductVariantId);
  if (!variantId && access.sourceOrderId) {
    const orderSnapshot = await db.collection("orders").doc(access.sourceOrderId).get();
    const order = orderSnapshot.exists ? orderSnapshot.data() || {} : {};
    const lines = Array.isArray(order.orderLines) && order.orderLines.length
      ? order.orderLines
      : Array.isArray(order.products) ? order.products : [];
    const purchasedLine = lines.find((line) => {
      if (access.sourceProductId && line.productId !== access.sourceProductId) return false;
      const targets = Array.isArray(line.accessTargets)
        ? line.accessTargets
        : Array.isArray(line.accessGrants) ? line.accessGrants : [];
      return !targets.length || targets.some((target) =>
        cleanString(target.accessEntityId || target.accessId) === accessId);
    });
    variantId = cleanString(purchasedLine?.productVariantId || purchasedLine?.variantId);
  }
  if (!variantId) return null;
  const snapshot = await db.collection("productVariants").doc(variantId).get();
  if (!snapshot.exists) return null;
  let resolvedVariantId = variantId;
  let variant = snapshot.data() || {};
  const accessVariantId = cleanString(access.accessVariantId || access.accessEntityVariantId);
  const bundleComponents = Array.isArray(variant.bundleComponents) ? variant.bundleComponents : [];
  if (accessVariantId && cleanString(variant.contentVariantId) !== accessVariantId && bundleComponents.length) {
    const componentVariantIds = unique(bundleComponents.map((component) =>
      cleanString(component.componentProductVariantId || component.productVariantId)));
    const componentSnapshots = await Promise.all(componentVariantIds.map((componentVariantId) =>
      db.collection("productVariants").doc(componentVariantId).get()));
    const matchingIndex = componentSnapshots.findIndex((componentSnapshot) =>
      componentSnapshot.exists &&
      cleanString(componentSnapshot.data()?.contentVariantId) === accessVariantId);
    if (matchingIndex >= 0) {
      resolvedVariantId = componentVariantIds[matchingIndex];
      variant = componentSnapshots[matchingIndex].data() || {};
    }
  }
  const variantStatus = normalizedStatus(variant.status || "active");
  return {
    id: resolvedVariantId,
    name: variant.variantName || variant.name || access.sourceProductVariantName || resolvedVariantId,
    eventStartAt: cleanString(variant.eventStartAt),
    eventEndAt: cleanString(variant.eventEndAt),
    eventLocation: cleanString(variant.eventLocation),
    instructor: cleanString(variant.instructor),
    calendarBookingReference: cleanString(variant.calendarBookingReference),
    status: variantStatus,
  };
}

export const getUnlockedCourse = onCall({
  region: "australia-southeast1",
}, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in to view this course.");
  }
  const contentType = normalizedStatus(request.data?.contentType) === "workshop" ? "workshop" : "course";
  const contentLabel = contentType === "workshop" ? "workshop" : "course";
  const courseId = cleanString(request.data?.courseId || request.data?.workshopId);
  const requestedAccessVariantId = cleanString(request.data?.accessVariantId);
  if (!courseId) throw new HttpsError("invalid-argument", `${contentLabel} ID is required.`);

  const db = admin.firestore();
  const accessId = `${request.auth.uid}_Plan_${courseId}`;
  const [directAccessSnapshot, userAccessSnapshot, courseSnapshot] = await Promise.all([
    db.collection("userAccess").doc(accessId).get(),
    db.collection("userAccess").where("userId", "==", request.auth.uid).get(),
    db.collection("plans").doc(courseId).get(),
  ]);
  const variantAccessSnapshot = userAccessSnapshot.docs.find((snapshot) => {
    const candidate = snapshot.data() || {};
    return cleanString(candidate.accessType).toLowerCase() === "plan" &&
      cleanString(candidate.accessId) === courseId && accessIsActive(candidate) &&
      (requestedAccessVariantId
        ? cleanString(candidate.accessVariantId || candidate.accessEntityVariantId) === requestedAccessVariantId
        : true);
  });
  const accessSnapshot = !requestedAccessVariantId &&
    directAccessSnapshot.exists && accessIsActive(directAccessSnapshot.data() || {})
    ? directAccessSnapshot
    : variantAccessSnapshot;
  const access = accessSnapshot?.data() || {};
  if (!accessSnapshot || !accessIsActive(access)) {
    throw new HttpsError("permission-denied", `This ${contentLabel} is not unlocked for your account.`);
  }
  if (!courseSnapshot.exists) throw new HttpsError("not-found", `${contentLabel} not found.`);

  const course = courseSnapshot.data();
  if (normalizedStatus(course.type || course.planType || course.planTypeName) !== contentType) {
    throw new HttpsError("failed-precondition", `The unlocked content is not a ${contentLabel}.`);
  }
  const courseStatus = normalizedStatus(course.status || course.approvalStatus);
  if (course.archived === true || ["archived", "paused"].includes(courseStatus)) {
    throw new HttpsError("failed-precondition", `This ${contentLabel} is not currently available.`);
  }

  const accessVariantId = cleanString(access.accessVariantId || access.accessEntityVariantId);
  const courseVariants = Array.isArray(course.entityVariants) ? course.entityVariants : [];
  const selectedCourseVariant = accessVariantId
    ? courseVariants.find((variant) =>
      cleanString(variant.entityVariantId || variant.id) === accessVariantId) || null
    : null;
  if (accessVariantId && !selectedCourseVariant) {
    throw new HttpsError("failed-precondition", `The unlocked ${contentLabel} option is no longer available.`);
  }
  const contentScope = selectedCourseVariant || course;
  const blueprintIds = unique([
    ...collectIds(contentScope.linkedBlueprintIds, "BLUEPRINT-"),
    ...collectIds(contentScope.templateFieldValues, "BLUEPRINT-"),
    ...collectIds(contentScope, "BLUEPRINT-"),
  ]);
  const blueprintSnapshots = await Promise.all(blueprintIds.map((blueprintId) =>
    db.collection("blueprints").doc(blueprintId).get()));
  const modules = await Promise.all(blueprintSnapshots.map(async (snapshot, moduleIndex) => {
    if (!snapshot.exists) return null;
    const blueprint = snapshot.data();
    const blueprintStatus = normalizedStatus(blueprint.status || blueprint.approvalStatus);
    if (blueprint.archived === true || ["archived", "paused"].includes(blueprintStatus)) return null;
    const itemIds = unique([
      ...collectIds(blueprint.linkedItemIds, "ITEM-"),
      ...collectIds(blueprint.linkedItemComponents, "ITEM-"),
      ...collectIds(blueprint.templateFieldValues, "ITEM-"),
      ...collectIds(blueprint.entityVariants, "ITEM-"),
    ]);
    const itemSnapshots = await Promise.all(itemIds.map((itemId) =>
      db.collection("items").doc(itemId).get()));
    const items = await Promise.all(itemSnapshots.map(async (itemSnapshot, itemIndex) => {
      if (!itemSnapshot.exists) return null;
      const item = itemSnapshot.data();
      const itemStatus = normalizedStatus(item.status || item.approvalStatus);
      if (item.archived === true || ["archived", "paused"].includes(itemStatus)) return null;
      return {
        ...publicContent(item, itemIds[itemIndex]),
        media: await assetsForRecord(db, item, itemIds[itemIndex]),
      };
    }));
    return {
      ...publicContent(blueprint, blueprintIds[moduleIndex]),
      sortOrder: moduleIndex + 1,
      media: await assetsForRecord(db, blueprint, blueprintIds[moduleIndex]),
      items: items.filter(Boolean),
    };
  }));

  const booking = contentType === "workshop"
    ? await purchasedProductVariant(db, access, courseId)
    : null;
  if (booking && ["draft", "paused", "archived", "cancelled"].includes(booking.status)) {
    throw new HttpsError(
      "failed-precondition",
      "This workshop session has been cancelled or is not currently available. Contact Recovery Tools for help.",
    );
  }

  const baseCourse = publicContent(course, courseId);
  const publicSelectedVariant = selectedCourseVariant
    ? publicContent(selectedCourseVariant, accessVariantId)
    : null;
  return {
    course: {
      ...baseCourse,
      ...(publicSelectedVariant || {}),
      id: courseId,
      type: baseCourse.type,
      selectedVariant: publicSelectedVariant,
      media: await assetsForRecord(db, contentScope, courseId, accessVariantId),
    },
    modules: modules.filter(Boolean),
    booking,
  };
});
