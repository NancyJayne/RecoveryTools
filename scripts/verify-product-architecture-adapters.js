import assert from "node:assert/strict";
import {
  accessGrantsForProduct,
  activePriceForProduct,
  bundleComponentsForProduct,
  inventoryForProduct,
  mediaForProduct,
  mediaForProductVariant,
  variantsForProduct,
} from "../functions/utils/productArchitecture.js";

const architecture = {
  pricesByProductId: new Map([["PROD-1", [
    { id: "PRICE-OLD", status: "inactive", effectiveShopPrice: 12 },
    { id: "PRICE-1", status: "active", effectiveShopPrice: 20 },
  ]]]),
  canonicalVariantsByProductId: new Map([["PROD-1", [
    { id: "PV-1", productVariantId: "PV-1", variantName: "Canonical", stockQuantity: 4, status: "active",
      bundleComponents: [{ bundleComponentId: "BC-1", componentProductId: "PROD-2",
        componentProductVariantId: "PV-2", quantity: 2 },
      { bundleComponentId: "BC-SAME-PRODUCT", componentProductId: "PROD-1",
        componentProductVariantId: "PV-SESSION-2", quantity: 1 },
      { bundleComponentId: "BC-SELF", componentProductId: "PROD-1",
        componentProductVariantId: "PV-1", quantity: 1 },
      { bundleComponentId: "BC-NO-VARIANT", componentProductId: "PROD-2",
        componentProductVariantId: "", quantity: 1 }] },
  ]]]),
  legacyVariantsByProductId: new Map([["PROD-1", [
    { id: "IV-IGNORED", variantId: "IV-IGNORED", name: "Legacy", stock: 9, status: "active" },
  ]]]),
  legacyVariantsByItemId: new Map([["ITEM-2", [
    { id: "IV-2", variantId: "IV-2", name: "Legacy fallback", stock: 3, status: "active" },
  ]]]),
  inventoryByProductId: new Map([["PROD-1", [
    { id: "INV-PROD-1", productId: "PROD-1", variantId: "", stockQty: 7 },
    { id: "INV-PV-1", productId: "PROD-1", variantId: "PV-1", stockQty: 4 },
  ]]]),
  inventoryByVariantId: new Map([["PV-1", [
    { id: "INV-WRONG-PRODUCT", productId: "PROD-OTHER", variantId: "PV-1", stockQty: 99 },
    { id: "INV-PV-1", productId: "PROD-1", variantId: "PV-1", stockQty: 4 },
  ]]]),
  inventoryByItemId: new Map([["ITEM-1", [
    { id: "INV-ITEM-1", itemId: "ITEM-1", productId: "", variantId: "", stockQty: 50 },
  ]]]),
  entityAssetsByEntityId: new Map([["PROD-1", [
    { id: "EA-1", entityId: "PROD-1", entityType: "Product", assetId: "ASSET-1", status: "active" },
  ]], ["PLAN-IMAGE", [
    { id: "EA-IMAGE", entityId: "PLAN-IMAGE", entityType: "Plan",
      assetId: "ASSET-ENTITY-IMAGE", status: "active" },
  ]]]),
  renditionsByAssetId: new Map([["ASSET-1", [
    { id: "REN-1", purpose: "thumbnail", fileUrl: "https://example.test/thumb.jpg", status: "active" },
  ]]]),
  accessGrantsByProductId: new Map([["PROD-1", [
    { id: "PAG-1", accessEntityType: "Plan", accessEntityId: "PLAN-1", status: "active" },
  ]]]),
  assetsById: new Map([["ASSET-1", {
    id: "ASSET-1",
    assetType: "image",
    fileUrl: "https://example.test/image.jpg",
    status: "active",
  }], ["ASSET-PRIVATE", {
    id: "ASSET-PRIVATE", assetType: "video", fileUrl: "https://example.test/private.mp4", status: "active",
  }], ["ASSET-PUBLIC", {
    id: "ASSET-PUBLIC", assetType: "video", fileUrl: "https://example.test/public.mp4", status: "active",
  }], ["ASSET-ENTITY-IMAGE", {
    id: "ASSET-ENTITY-IMAGE", assetType: "image",
    fileUrl: "https://example.test/entity-image.jpg", status: "active",
  }]]),
  productLinksByProductId: new Map([["PROD-PRIVATE", [{
    entityType: "Plan", linkedEntityType: "Plan", linkedEntityId: "PLAN-PRIVATE", status: "active",
  }]], ["PROD-IMAGE", [{
    entityType: "Plan", linkedEntityType: "Plan", linkedEntityId: "PLAN-IMAGE", status: "active",
  }]]]),
  plansById: new Map([["PLAN-PRIVATE", {
    id: "PLAN-PRIVATE", planId: "PLAN-PRIVATE", templateFieldValues: { teachingVideo: "ASSET-PRIVATE" },
    entityVariants: [{ entityVariantId: "PLAN-V1", templateFieldValues: { preparation: "ASSET-PRIVATE" } }],
  }], ["PLAN-IMAGE", {
    id: "PLAN-IMAGE", planId: "PLAN-IMAGE", status: "active",
  }]]),
  itemsById: new Map(),
  blueprintsById: new Map(),
};

assert.equal(activePriceForProduct("PROD-1", architecture)?.id, "PRICE-1");

const canonicalVariants = variantsForProduct("PROD-1", "ITEM-1", architecture);
assert.deepEqual(canonicalVariants.map((variant) => variant.id), ["PV-1"]);
assert.equal(canonicalVariants[0].stock, 4);
assert.deepEqual(bundleComponentsForProduct("PROD-1", "PV-1", architecture), [
  {
    bundleComponentId: "BC-1",
    componentProductId: "PROD-2",
    componentProductVariantId: "PV-2",
    quantity: 2,
    inventoryAction: "deduct",
  },
  {
    bundleComponentId: "BC-SAME-PRODUCT",
    componentProductId: "PROD-1",
    componentProductVariantId: "PV-SESSION-2",
    quantity: 1,
    inventoryAction: "deduct",
  },
]);

assert.equal(inventoryForProduct("PROD-1", "", architecture)?.id, "INV-PROD-1");
assert.equal(inventoryForProduct("PROD-1", "PV-1", architecture)?.id, "INV-PV-1");
assert.equal(inventoryForProduct("PROD-MISSING", "", architecture), null);

const legacyVariants = variantsForProduct("PROD-2", "ITEM-2", architecture);
assert.deepEqual(legacyVariants.map((variant) => variant.id), ["IV-2"]);
assert.equal(legacyVariants[0].sourceCollection, "itemVariants");

const canonicalMedia = mediaForProduct("PROD-1", { itemId: "ITEM-1" }, architecture);
assert.equal(canonicalMedia[0].url, "https://example.test/image.jpg");
assert.equal(canonicalMedia[0].thumbnailUrl, "https://example.test/thumb.jpg");

const embeddedMedia = mediaForProduct("PROD-2", {
  name: "Fallback",
  images: ["https://example.test/fallback.jpg"],
}, architecture);
assert.equal(embeddedMedia[0].url, "https://example.test/fallback.jpg");

const privateBoundary = mediaForProduct("PROD-PRIVATE", {}, architecture);
assert.deepEqual(privateBoundary, []);
const inheritedEntityImage = mediaForProduct("PROD-IMAGE", {}, architecture);
assert.deepEqual(inheritedEntityImage.map((asset) => asset.assetId), ["ASSET-ENTITY-IMAGE"]);
const explicitVariantMedia = mediaForProductVariant("PROD-PRIVATE", {}, {
  variantId: "PV-PUBLIC", contentVariantId: "PLAN-V1", primaryAssetId: "ASSET-PUBLIC",
}, architecture);
assert.deepEqual(explicitVariantMedia.map((asset) => asset.assetId), ["ASSET-PUBLIC"]);

const canonicalGrants = accessGrantsForProduct("PROD-1", {}, architecture);
assert.equal(canonicalGrants[0].accessEntityId, "PLAN-1");
assert.equal(canonicalGrants[0].source, "canonical");

const legacyGrants = accessGrantsForProduct("PROD-2", {
  relatedCourseId: "PLAN-COURSE",
}, architecture);
assert.equal(legacyGrants[0].accessEntityId, "PLAN-COURSE");
assert.equal(legacyGrants[0].source, "legacy");

console.log("Product architecture adapter verification passed.");
