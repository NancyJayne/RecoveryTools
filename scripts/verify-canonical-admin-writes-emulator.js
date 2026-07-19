import admin from "firebase-admin";
import { createContentBuilderRecord } from "../functions/admin/createContentBuilderRecord.js";
import { updateContentControlRecord } from "../functions/admin/updateContentControlRecord.js";
import { createProduct } from "../functions/products/createProduct.js";
import { updateProduct } from "../functions/products/updateProduct.js";
import { getAdminAssets, upsertAdminAsset } from "../functions/admin/manageAssets.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(process.env.FIRESTORE_EMULATOR_HOST, "Run this check through the Firestore emulator.");
  if (!admin.apps.length) admin.initializeApp({ projectId: "recovery-tools" });
  const db = admin.firestore();
  const suffix = Date.now();
  const itemId = `TEST-CANONICAL-ITEM-${suffix}`;
  const planId = `TEST-CANONICAL-PLAN-${suffix}`;
  const itemProductId = `TEST-CANONICAL-PRODUCT-${suffix}`;
  const planProductId = `TEST-CANONICAL-PLAN-PRODUCT-${suffix}`;
  const selectedAssetId = `TEST-CANONICAL-ASSET-${suffix}`;
  const standaloneProductId = `TEST-STANDALONE-PRODUCT-${suffix}`;
  const linkedPlanId = `TEST-LINK-EXISTING-PLAN-${suffix}`;
  const managedAssetId = `TEST-MANAGED-ASSET-${suffix}`;
  const request = {
    auth: {
      uid: "emulator-admin",
      token: { admin: true, email: "admin@example.test" },
    },
  };
  const cleanup = [];

  try {
    const standaloneResult = await createProduct.run({
      ...request,
      data: {
        productId: standaloneProductId,
        name: "Standalone canonical Product",
        productType: "Digital Download",
        price: 15,
        status: "draft",
      },
    });
    assert(standaloneResult.id === standaloneProductId, "Standalone Product ID was not preserved.");
    cleanup.push(
      ["products", standaloneProductId],
      ["productPrices", `PRICE-${standaloneProductId}-BASE`],
    );
    const standalone = await db.collection("products").doc(standaloneProductId).get();
    assert(standalone.data()?.productType === "Digital Download", "Standalone canonical Product type was not written.");
    assert(standalone.data()?.status === "draft" && standalone.data()?.visible === false, "New Product was not Draft.");
    await updateProduct.run({
      ...request,
      data: {
        id: standaloneProductId,
        updates: { name: "Updated standalone Product", productType: "Service", price: 20, status: "draft" },
      },
    });
    const updatedStandalone = await db.collection("products").doc(standaloneProductId).get();
    assert(updatedStandalone.data()?.productType === "Service", "Standalone Product update lost canonical type.");
    assert(updatedStandalone.data()?.basePrice === 20, "Standalone Product update did not write canonical price.");

    const linkedPlanResult = await createContentBuilderRecord.run({
      ...request,
      data: {
        recordType: "plan",
        id: linkedPlanId,
        name: "Plan linked to existing Product",
        type: "course",
        status: "draft",
        createsProduct: true,
        productId: standaloneProductId,
        productRelation: {
          existingProductId: standaloneProductId,
          productId: standaloneProductId,
          linkRole: "Unlocks",
        },
      },
    });
    assert(linkedPlanResult.success === true, "Link-existing Product create did not succeed.");
    cleanup.push(["plans", linkedPlanId]);
    const existingLinks = await db.collection("productLinks").where("linkedEntityId", "==", linkedPlanId).get();
    assert(existingLinks.docs.some((doc) => doc.data()?.linkRole === "Unlocks"), "ProductLink role was not saved.");
    existingLinks.docs.forEach((doc) => cleanup.push(["productLinks", doc.id]));
    const existingGrants = await db.collection("productAccessGrants")
      .where("accessEntityId", "==", linkedPlanId).get();
    assert(
      existingGrants.docs.some((doc) => doc.data()?.productId === standaloneProductId),
      "Linked Product grant missing.",
    );
    existingGrants.docs.forEach((doc) => cleanup.push(["productAccessGrants", doc.id]));
    const preservedStandalone = await db.collection("products").doc(standaloneProductId).get();
    assert(
      preservedStandalone.data()?.productName === "Updated standalone Product",
      "Linking an existing Product overwrote its Product data.",
    );

    await upsertAdminAsset.run({
      ...request,
      data: {
        assetId: managedAssetId,
        assetName: "Managed reusable Asset",
        assetType: "Image",
        fileUrl: "https://example.test/managed.jpg",
        status: "draft",
        renditions: [{
          renditionName: "Thumbnail",
          purpose: "thumbnail",
          fileUrl: "https://example.test/managed-thumb.jpg",
          isDefault: true,
        }],
        replaceRenditions: true,
      },
    });
    cleanup.push(["assets", managedAssetId]);
    const managedAssets = await getAdminAssets.run(request);
    const managedAsset = managedAssets.assets.find((asset) => asset.id === managedAssetId);
    assert(managedAsset?.renditions?.length === 1, "Asset rendition was not returned by the Asset manager.");
    managedAsset.renditions.forEach((rendition) => cleanup.push(["assetRenditions", rendition.id]));
    await upsertAdminAsset.run({
      ...request,
      data: {
        assetId: managedAssetId,
        assetName: "Managed reusable Asset",
        assetType: "Image",
        fileUrl: "https://example.test/managed.jpg",
        status: "active",
        renditions: [],
        replaceRenditions: true,
      },
    });
    const archivedRendition = await db.collection("assetRenditions").doc(managedAsset.renditions[0].id).get();
    assert(archivedRendition.data()?.status === "archived", "Removed rendition was not archived.");
    assert((await db.collection("assets").doc(managedAssetId).get()).exists, "Rendition edit deleted its Asset.");

    await db.collection("assets").doc(selectedAssetId).set({
      assetId: selectedAssetId,
      assetName: "Reusable test asset",
      assetType: "Image",
      title: "Reusable test asset",
      fileUrl: "https://example.test/reusable.jpg",
      status: "active",
    });
    cleanup.push(["assets", selectedAssetId]);

    const itemResult = await createContentBuilderRecord.run({
      ...request,
      data: {
        recordType: "item",
        id: itemId,
        name: "Canonical writer test item",
        type: "faq",
        status: "draft",
        isShopProduct: true,
        createsProduct: true,
        productId: itemProductId,
        price: 25,
        inventoryTracked: true,
        requiresShipping: true,
        stockQty: 3,
        variants: [{
          variantId: `${itemProductId}-VARIANT`,
          name: "Default",
          sku: "TEST-SKU",
          priceOverride: 25,
          stockQty: 3,
        }],
      },
    });
    assert(itemResult.success === true, "Item create callable did not succeed.");
    cleanup.push(["items", itemId], ["products", itemProductId]);

    const itemProduct = await db.collection("products").doc(itemProductId).get();
    assert(itemProduct.data()?.productName === "Canonical writer test item", "Canonical Product name was not written.");
    assert(itemProduct.data()?.productType === "Physical", "Canonical Product type was not written.");
    await upsertAdminAsset.run({
      ...request,
      data: {
        assetId: managedAssetId,
        assetName: "Managed reusable Asset",
        assetType: "Image",
        fileUrl: "https://example.test/managed.jpg",
        status: "active",
        newLinks: [{ entityType: "Item", entityId: itemId, assetRole: "Hero" }],
      },
    });
    const linkedManagedAssets = await getAdminAssets.run(request);
    const linkedManagedAsset = linkedManagedAssets.assets.find((asset) => asset.id === managedAssetId);
    const managedLink = linkedManagedAsset?.links?.find((link) => link.entityId === itemId);
    assert(managedLink?.assetRole === "Hero", "Asset editor did not create the EntityAsset link.");
    cleanup.push(["entityAssets", managedLink.id]);
    await upsertAdminAsset.run({
      ...request,
      data: {
        assetId: managedAssetId,
        assetName: "Managed reusable Asset",
        assetType: "Image",
        fileUrl: "https://example.test/managed.jpg",
        status: "active",
        unlinkEntityAssetIds: [managedLink.id],
      },
    });
    const archivedManagedLink = await db.collection("entityAssets").doc(managedLink.id).get();
    assert(archivedManagedLink.data()?.status === "archived", "Asset link was not archived on unlink.");
    assert((await db.collection("assets").doc(managedAssetId).get()).exists, "Asset unlink deleted the Asset.");
    const itemLinks = await db.collection("productLinks").where("productId", "==", itemProductId).get();
    assert(itemLinks.docs.some((doc) => doc.data()?.linkedEntityId === itemId), "Item ProductLink was not written.");
    itemLinks.docs.forEach((doc) => cleanup.push(["productLinks", doc.id]));
    const canonicalVariant = await db.collection("productVariants").doc(`${itemProductId}-VARIANT`).get();
    const compatibilityVariant = await db.collection("itemVariants").doc(`${itemProductId}-VARIANT`).get();
    assert(canonicalVariant.data()?.stockQuantity === 3, "Canonical ProductVariant was not written.");
    assert(compatibilityVariant.data()?.stock === 3, "Compatibility ItemVariant was not retained.");
    cleanup.push(
      ["productVariants", `${itemProductId}-VARIANT`],
      ["itemVariants", `${itemProductId}-VARIANT`],
      ["productPrices", `PRICE-${itemProductId}-BASE`],
      ["productPrices", `PRICE-${itemProductId}-1`],
      ["inventory", `INV-${itemProductId}-VARIANT`],
    );

    await updateContentControlRecord.run({
      ...request,
      data: {
        recordType: "item",
        recordId: itemId,
        updates: {
          hasAssetTemplateFields: true,
          templateAssetLinks: [{ assetId: selectedAssetId, fieldKey: "hero", fieldName: "Hero" }],
          originalTemplateAssetIds: [],
        },
      },
    });
    const entityAssets = await db.collection("entityAssets").where("entityId", "==", itemId).get();
    assert(entityAssets.docs.some((doc) => doc.data()?.assetId === selectedAssetId), "EntityAsset was not written.");
    entityAssets.docs.forEach((doc) => cleanup.push(["entityAssets", doc.id]));
    const itemAssets = await db.collection("itemAssets").where("itemId", "==", itemId).get();
    itemAssets.docs.forEach((doc) => cleanup.push(["itemAssets", doc.id]));

    await updateContentControlRecord.run({
      ...request,
      data: {
        recordType: "item",
        recordId: itemId,
        updates: {
          hasAssetTemplateFields: true,
          templateAssetLinks: [],
          originalTemplateAssetIds: [selectedAssetId],
        },
      },
    });
    assert((await db.collection("assets").doc(selectedAssetId).get()).exists, "Unlink deleted the reusable Asset.");

    const planResult = await createContentBuilderRecord.run({
      ...request,
      data: {
        recordType: "plan",
        id: planId,
        name: "Canonical writer test plan",
        type: "course",
        status: "draft",
        createsProduct: true,
        productId: planProductId,
        price: 49,
      },
    });
    assert(planResult.success === true, "Plan create callable did not succeed.");
    cleanup.push(["plans", planId], ["products", planProductId], ["productPrices", `PRICE-${planProductId}-BASE`]);
    const planLinks = await db.collection("productLinks").where("productId", "==", planProductId).get();
    assert(planLinks.docs.some((doc) => doc.data()?.linkedEntityType === "Plan"), "Plan ProductLink was not written.");
    planLinks.docs.forEach((doc) => cleanup.push(["productLinks", doc.id]));
    const grants = await db.collection("productAccessGrants").where("productId", "==", planProductId).get();
    assert(grants.docs.some((doc) => doc.data()?.accessEntityId === planId), "Plan access grant was not written.");
    grants.docs.forEach((doc) => cleanup.push(["productAccessGrants", doc.id]));

    await updateContentControlRecord.run({
      ...request,
      data: { recordType: "plan", recordId: planId, updates: { createsProduct: false } },
    });
    assert((await db.collection("products").doc(planProductId).get()).exists, "Unlink deleted the Product.");
    const preservedLinks = await db.collection("productLinks").where("productId", "==", planProductId).get();
    assert(
      preservedLinks.docs.some((doc) => doc.data()?.status === "active"),
      "Turning off CreatesProduct silently removed an existing ProductLink.",
    );
    await updateContentControlRecord.run({
      ...request,
      data: {
        recordType: "plan",
        recordId: planId,
        updates: { createsProduct: false, unlinkProductIds: [planProductId] },
      },
    });
    const unlinked = await db.collection("productLinks").where("productId", "==", planProductId).get();
    assert(
      unlinked.docs.every((doc) => doc.data()?.status === "archived"),
      "Explicit unlink did not archive ProductLinks.",
    );
    assert((await db.collection("products").doc(planProductId).get()).exists, "Explicit unlink deleted the Product.");

    console.log("Canonical admin write verification passed.");
  } finally {
    await Promise.all(cleanup.map(([collection, id]) =>
      db.collection(collection).doc(id).delete().catch(() => {})));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
