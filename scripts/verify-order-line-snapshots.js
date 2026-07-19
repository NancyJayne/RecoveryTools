import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  canonicalOrderLines,
  preferredOrderLines,
} from "../functions/utils/orderLineSnapshots.js";

function checksum(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const legacyProducts = [{
  productId: "PROD-LEGACY",
  name: "Legacy product title",
  type: "tool",
  price: 55,
  quantity: 2,
  lineTotal: 110,
}];
const legacyChecksum = checksum(legacyProducts);
const source = [{
  productId: "PROD-CANONICAL",
  name: "Canonical product title",
  productType: "Physical",
  variantId: "PV-BLUE",
  variantName: "Blue",
  sku: "SKU-BLUE",
  unitPrice: 55,
  quantity: 2,
  lineTotal: 110,
  requiresShipping: true,
  inventoryTracked: true,
  sellerUserId: "SELLER-1",
  accessGrants: [{
    productAccessGrantId: "PAG-1",
    accessEntityType: "Plan",
    accessEntityId: "PLAN-1",
    durationType: "permanent",
  }],
  components: [{
    productComponentId: "PC-1",
    itemId: "ITEM-BOX",
    quantity: 2,
    unit: "each",
    inventoryAction: "deduct",
  }],
}];

const lines = canonicalOrderLines(source, "AUD");
assert.equal(lines[0].schemaVersion, 2);
assert.equal(lines[0].productName, "Canonical product title");
assert.equal(lines[0].productVariantId, "PV-BLUE");
assert.equal(lines[0].unitPrice, 55);
assert.equal(lines[0].lineTotal, 110);
assert.equal(lines[0].taxAmount, 10);
assert.equal(lines[0].accessTargets[0].accessEntityId, "PLAN-1");
assert.equal(lines[0].componentInventory[0].totalQuantity, 4);

source[0].name = "Product renamed after purchase";
source[0].unitPrice = 99;
assert.equal(lines[0].productName, "Canonical product title");
assert.equal(lines[0].unitPrice, 55);

const mixedOrder = { products: legacyProducts, orderLines: lines, orderLineSchemaVersion: 2 };
assert.equal(preferredOrderLines(mixedOrder), lines);
assert.equal(preferredOrderLines({ products: legacyProducts }), legacyProducts);
assert.equal(checksum(legacyProducts), legacyChecksum, "Canonical snapshots mutated legacy order products.");

console.log("Versioned order-line snapshot verification passed.");
