const field = (workbook, type = "string") => ({
  workbook,
  firestore: workbook
    .replace(/IDs/g, "Ids")
    .replace(/ID/g, "Id")
    .replace(/URL/g, "Url")
    .replace(/SKU/g, "Sku")
    .replace(/MIME/g, "Mime")
    .replace(/^./, (char) => char.toLowerCase()),
  type,
});

export const PRODUCT_TYPES = [
  "Physical",
  "Digital Download",
  "Plan Access",
  "Course Access",
  "Workshop Registration",
  "Program Access",
  "Service",
  "Bundle",
  "Membership",
  "Mixed",
];

export const LINKED_ENTITY_TYPES = ["Item", "Blueprint", "Plan", "Asset"];
export const PRODUCT_LINK_ROLES = [
  "Represents", "ProducedBy", "Includes", "Component", "Delivers", "Unlocks",
  "Bonus", "RecommendedFor", "Related", "SourceContent",
];
export const ENTITY_ASSET_TYPES = [
  "Item", "Blueprint", "Plan", "Product", "Campaign", "UserProfile", "ProductVariant",
];
export const ASSET_TYPES = [
  "Image", "Video", "Audio", "PDF", "Document", "Illustration", "Presentation",
  "Canva Design", "Logo", "Icon", "Animation", "Download",
];

const commonAudit = [
  field("Status"), field("CreatedAt", "date"), field("UpdatedAt", "date"), field("Notes"),
];

export const CANONICAL_WORKBOOK_SCHEMAS = {
  products: {
    sheet: "Products",
    idField: "productId",
    fields: [
      field("ProductID"), field("ProductName"), field("ProductType"), field("ProductCategoryID"),
      field("Status"), field("ShopStatus"), field("ApprovalStatus"), field("MarketplaceVisibility"),
      field("WebsiteVisible", "boolean"), field("SoldByRecoveryTools", "boolean"),
      field("SellerUserID"), field("CreatorUserID"), field("OwnerUserID"), field("Featured", "boolean"),
      field("SortOrder", "number"), field("Slug"), field("ShortDescription"), field("LongDescription"),
      field("FulfilmentType"), field("RequiresShipping", "boolean"), field("IsDigital", "boolean"),
      field("IsFree", "boolean"), field("Currency"), field("BasePrice", "number"),
      field("CompareAtPrice", "number"), field("Taxable", "boolean"), field("TaxCode"),
      field("InventoryTracked", "boolean"), field("StockStatus"), field("StripeProductID"),
      field("DefaultStripePriceID"), field("PrimaryAssetID"), field("AccessCodeEligible", "boolean"),
      field("AvailableFrom", "date"), field("AvailableUntil", "date"), field("CreatedAt", "date"),
      field("UpdatedAt", "date"), field("ArchivedAt", "date"), field("Notes"),
    ],
    required: ["productId", "productName", "productType", "status"],
  },
  productLinks: {
    sheet: "ProductLinks", idField: "productLinkId",
    fields: [
      field("ProductLinkID"), field("ProductID"), field("LinkedEntityType"), field("LinkedEntityID"),
      field("LinkRole"), field("Quantity", "number"), field("IsPrimary", "boolean"),
      field("SortOrder", "number"), field("Required", "boolean"), field("VariantSpecific", "boolean"),
      field("ProductVariantID"), ...commonAudit,
    ],
    required: ["productLinkId", "productId", "linkedEntityType", "linkedEntityId", "linkRole"],
  },
  productOptions: {
    sheet: "ProductOptions", idField: "productOptionId",
    fields: [
      field("ProductOptionID"), field("ProductID"), field("OptionName"),
      field("SortOrder", "number"), ...commonAudit,
    ],
    required: ["productOptionId", "productId", "optionName"],
  },
  productOptionValues: {
    sheet: "ProductOptionValues", idField: "productOptionValueId",
    fields: [
      field("ProductOptionValueID"), field("ProductOptionID"), field("Value"),
      field("SortOrder", "number"), ...commonAudit,
    ],
    required: ["productOptionValueId", "productOptionId", "value"],
  },
  productVariants: {
    sheet: "ProductVariants", idField: "productVariantId",
    fields: [
      field("ProductVariantID"), field("ProductID"), field("VariantName"), field("VariantCode"), field("SKU"),
      field("Status"), field("IsDefault", "boolean"), field("OptionSummary"), field("PriceOverride", "number"),
      field("CompareAtPriceOverride", "number"), field("Currency"), field("TaxableOverride", "boolean"),
      field("RequiresShippingOverride", "boolean"), field("InventoryTracked", "boolean"),
      field("StockQuantity", "number"), field("StockStatus"), field("ReorderLevel", "number"),
      field("Weight", "number"), field("WeightUnit"), field("Barcode"), field("StripeProductID"),
      field("StripePriceID"), field("PrimaryAssetID"), field("SortOrder", "number"), ...commonAudit,
    ],
    required: ["productVariantId", "productId", "variantName", "status"],
  },
  productVariantValues: {
    sheet: "ProductVariantValues", idField: "productVariantValueId",
    fields: [field("ProductVariantValueID"), field("ProductVariantID"), field("ProductOptionValueID"), ...commonAudit],
    required: ["productVariantValueId", "productVariantId", "productOptionValueId"],
  },
  productComponents: {
    sheet: "ProductComponents", idField: "productComponentId",
    fields: [
      field("ProductComponentID"), field("ProductID"), field("ProductVariantID"), field("ItemID"),
      field("Quantity", "number"), field("Unit"), field("IsOptional", "boolean"),
      field("CanSubstitute", "boolean"), field("SortOrder", "number"), field("InventoryAction"), ...commonAudit,
    ],
    required: ["productComponentId", "productId", "itemId", "quantity"],
  },
  productAccessGrants: {
    sheet: "ProductAccessGrants", idField: "productAccessGrantId",
    fields: [
      field("ProductAccessGrantID"), field("ProductID"), field("ProductVariantID"),
      field("AccessEntityType"), field("AccessEntityID"), field("GrantTiming"), field("DurationType"),
      field("DurationValue", "number"), field("StartsAt", "date"), field("EndsAt", "date"),
      field("Revocable", "boolean"), ...commonAudit,
    ],
    required: ["productAccessGrantId", "productId", "accessEntityType", "accessEntityId", "status"],
  },
  assets: {
    sheet: "Assets", idField: "assetId",
    fields: [
      field("AssetID"), field("AssetName"), field("AssetType"), field("Title"), field("Description"),
      field("AltText"), field("FileURL"), field("StoragePath"), field("OriginalFilename"), field("MimeType"),
      field("FileExtension"), field("FileSizeBytes", "number"), field("Width", "number"),
      field("Height", "number"), field("AspectRatio"), field("DurationSeconds", "number"),
      field("OwnerUserID"), field("CreatorUserID"), field("Status"), field("ApprovalStatus"),
      field("Visibility"), field("CopyrightOwner"), field("LicenceType"), field("CreatedAt", "date"),
      field("UpdatedAt", "date"), field("ArchivedAt", "date"), field("Notes"),
    ],
    required: ["assetId", "assetName", "assetType", "status"],
  },
  entityAssets: {
    sheet: "EntityAssets", idField: "entityAssetId",
    fields: [
      field("EntityAssetID"), field("AssetID"), field("EntityType"), field("EntityID"), field("AssetRole"),
      field("FieldKey"), field("ProductVariantID"), field("IsPrimary", "boolean"), field("SortOrder", "number"),
      field("DisplayStatus"), field("Visibility"), ...commonAudit,
    ],
    required: ["entityAssetId", "assetId", "entityType", "entityId", "assetRole", "status"],
  },
  assetRenditions: {
    sheet: "AssetRenditions", idField: "assetRenditionId",
    fields: [
      field("AssetRenditionID"), field("AssetID"), field("RenditionName"), field("Purpose"), field("FileURL"),
      field("StoragePath"), field("MimeType"), field("FileExtension"), field("Width", "number"),
      field("Height", "number"), field("AspectRatio"), field("FileSizeBytes", "number"), field("CropMode"),
      field("FocalPointX", "number"), field("FocalPointY", "number"), field("Quality", "number"),
      field("IsDefault", "boolean"), ...commonAudit,
    ],
    required: ["assetRenditionId", "assetId", "renditionName", "status"],
  },
};

export function validateCanonicalRecord(collection, data) {
  const schema = CANONICAL_WORKBOOK_SCHEMAS[collection];
  if (!schema) return [`Unknown canonical collection: ${collection}`];
  const errors = schema.required
    .filter((key) => data[key] === undefined || data[key] === null || data[key] === "")
    .map((key) => `${key} is required`);

  if (collection === "products" && data.productType && !PRODUCT_TYPES.includes(data.productType)) {
    errors.push(`productType must be one of: ${PRODUCT_TYPES.join(", ")}`);
  }
  if (collection === "productLinks") {
    if (data.linkedEntityType && !LINKED_ENTITY_TYPES.includes(data.linkedEntityType)) {
      errors.push(`linkedEntityType must be one of: ${LINKED_ENTITY_TYPES.join(", ")}`);
    }
    if (data.linkRole && !PRODUCT_LINK_ROLES.includes(data.linkRole)) {
      errors.push(`linkRole must be one of: ${PRODUCT_LINK_ROLES.join(", ")}`);
    }
  }
  if (collection === "assets" && data.assetType && !ASSET_TYPES.includes(data.assetType)) {
    errors.push(`assetType must be one of: ${ASSET_TYPES.join(", ")}`);
  }
  if (collection === "entityAssets" && data.entityType && !ENTITY_ASSET_TYPES.includes(data.entityType)) {
    errors.push(`entityType must be one of: ${ENTITY_ASSET_TYPES.join(", ")}`);
  }
  return errors;
}
