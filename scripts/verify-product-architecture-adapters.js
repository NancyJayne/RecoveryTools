import assert from "node:assert/strict";
import {
  accessGrantsForProduct,
  activePriceForProduct,
  mediaForProduct,
  variantsForProduct,
} from "../functions/utils/productArchitecture.js";

const architecture = {
  pricesByProductId: new Map([["PROD-1", [
    { id: "PRICE-OLD", status: "inactive", effectiveShopPrice: 12 },
    { id: "PRICE-1", status: "active", effectiveShopPrice: 20 },
  ]]]),
  canonicalVariantsByProductId: new Map([["PROD-1", [
    { id: "PV-1", productVariantId: "PV-1", variantName: "Canonical", stockQuantity: 4, status: "active" },
  ]]]),
  legacyVariantsByProductId: new Map([["PROD-1", [
    { id: "IV-IGNORED", variantId: "IV-IGNORED", name: "Legacy", stock: 9, status: "active" },
  ]]]),
  legacyVariantsByItemId: new Map([["ITEM-2", [
    { id: "IV-2", variantId: "IV-2", name: "Legacy fallback", stock: 3, status: "active" },
  ]]]),
  entityAssetsByEntityId: new Map([["PROD-1", [
    { id: "EA-1", entityId: "PROD-1", entityType: "Product", assetId: "ASSET-1", status: "active" },
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
  }]]),
};

assert.equal(activePriceForProduct("PROD-1", architecture)?.id, "PRICE-1");

const canonicalVariants = variantsForProduct("PROD-1", "ITEM-1", architecture);
assert.deepEqual(canonicalVariants.map((variant) => variant.id), ["PV-1"]);
assert.equal(canonicalVariants[0].stock, 4);

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

const canonicalGrants = accessGrantsForProduct("PROD-1", {}, architecture);
assert.equal(canonicalGrants[0].accessEntityId, "PLAN-1");
assert.equal(canonicalGrants[0].source, "canonical");

const legacyGrants = accessGrantsForProduct("PROD-2", {
  relatedCourseId: "PLAN-COURSE",
}, architecture);
assert.equal(legacyGrants[0].accessEntityId, "PLAN-COURSE");
assert.equal(legacyGrants[0].source, "legacy");

console.log("Product architecture adapter verification passed.");
