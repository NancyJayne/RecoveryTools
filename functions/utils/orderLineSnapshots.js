function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function canonicalOrderLine(item, index, currency = "AUD") {
  const quantity = Math.max(Number(item.quantity || 1), 1);
  const lineTotal = money(item.lineTotal ?? item.total ?? item.price ?? item.unitPrice ?? 0);
  const unitPrice = money(item.unitPrice ?? (item.price !== undefined ? item.price : lineTotal / quantity));
  const taxAmount = money(item.taxAmount ?? lineTotal / 11);
  const accessTargets = (item.accessGrants || []).map((grant) => ({
    productAccessGrantId: grant.productAccessGrantId || grant.id || "",
    accessEntityType: grant.accessEntityType || grant.accessType || "",
    accessEntityId: grant.accessEntityId || grant.accessId || "",
    accessEntityVariantId: grant.accessEntityVariantId || "",
    productVariantId: grant.productVariantId || "",
    grantTiming: grant.grantTiming || "on-payment-confirmed",
    durationType: grant.durationType || "permanent",
    durationValue: grant.durationValue ?? null,
    revocable: grant.revocable !== false,
  })).filter((grant) => grant.accessEntityType && grant.accessEntityId);
  const components = (item.components || []).map((component) => ({
    productComponentId: component.productComponentId || component.id || "",
    itemId: component.itemId || "",
    quantityPerProduct: Number(component.quantity || 1),
    orderedQuantity: quantity,
    totalQuantity: Number(component.quantity || 1) * quantity,
    unit: component.unit || "each",
    inventoryAction: component.inventoryAction || "deduct",
  })).filter((component) => component.itemId);

  return {
    schemaVersion: 2,
    lineNumber: index + 1,
    productId: clean(item.productId),
    productName: clean(item.productName || item.productTitle || item.name || item.title),
    productType: clean(item.productType || item.type || "Product"),
    productVariantId: clean(item.productVariantId || item.variantId),
    variantName: clean(item.variantName),
    sku: clean(item.sku),
    quantity,
    currency: clean(currency).toUpperCase() || "AUD",
    unitPrice,
    subtotal: money(item.subtotal ?? unitPrice * quantity),
    discountAmount: money(item.discountAmount),
    taxAmount,
    lineTotal,
    requiresShipping: item.requiresShipping === true,
    inventoryTracked: item.inventoryTracked === true,
    sellerUserId: clean(item.sellerUserId),
    creatorUserId: clean(item.creatorUserId || item.creatorId),
    accessTargets,
    componentInventory: components,
  };
}

export function canonicalOrderLines(items = [], currency = "AUD") {
  return items.map((item, index) => canonicalOrderLine(item, index, currency));
}

export function preferredOrderLines(order = {}) {
  if (Array.isArray(order.orderLines) && order.orderLines.length) return order.orderLines;
  if (Array.isArray(order.products) && order.products.length) return order.products;
  if (Array.isArray(order.items) && order.items.length) return order.items;
  return [];
}

export function orderDueDate(purchasedAt, days = 14) {
  const source = purchasedAt instanceof Date
    ? purchasedAt
    : new Date(Number(purchasedAt || 0) * 1000);
  if (Number.isNaN(source.getTime())) return null;
  source.setUTCDate(source.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(source);
}
