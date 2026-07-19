# Firestore Data Map

This document maps the Recovery Tools Master Database workbook to Firestore.
The spreadsheet is the initial seed/prototype source. After import, Firebase and
the website/admin panel become the live source of truth.

## Import Rules

- Skip blank workbook rows. For sheets with formulas filled down, only import rows
  where the primary ID field is filled.
- Normalize booleans:
  - `Yes`, `TRUE`, `true` -> `true`
  - `No`, `FALSE`, `false`, blank -> `false`
- Normalize statuses for app logic:
  - `ACTIVE`, `Active`, `active` -> `active`
  - `Draft`, `DRAFT` -> `draft`
  - `Archived`, `ARCHIVED` -> `archived`
- Store spreadsheet IDs as document IDs where practical.
- Store server timestamps for `createdAt` and `updatedAt` when workbook values are blank.
- Do not trust client writes for payments, orders, user access, Stripe IDs, or fulfilment timestamps.

## Write Ownership

| Owner | Meaning |
|---|---|
| `admin` | Admin panel or trusted admin callable function |
| `user` | Authenticated user updating their own allowed profile fields |
| `webhook` | Stripe webhook/function writes |
| `system` | Import script, scheduled function, or trusted backend process |

## Collections Overview

| Workbook sheet | Firestore collection | Primary document ID | Primary writer |
|---|---|---|---|
| `Items` | `items` | `ItemID` | `admin`, `system` |
| `ItemProduct` | `products` | `ItemProductID` | `admin`, `system` |
| `ProductPrice` | `productPrices` | `PriceID` | `admin`, `system` |
| `ItemVariants` | `itemVariants` | `VariantID` | `admin`, `system` |
| `Asset` | `assets` | `AssetID` | `admin`, `system` |
| `ItemAsset` | `itemAssets` | `ItemAssetID` | `admin`, `system` |
| `Inventory` | `inventory` | `Inventory ID` | `admin`, `system` |
| `Users` | `users` | `UserID` | `user`, `admin`, `system` |
| `Orders` | `orders` | `OrderID` | `webhook`, `admin`, `system` |
| `OrderItem` | `orderItems` | `OrderItemID` | `webhook`, `system` |
| `CustomerAddresses` | `customerAddresses` | `AddressID` | `webhook`, `user`, `system` |
| `Shipments` | `shipments` | `ShipmentID` | `admin`, `system` |
| `StripeEvents` | `stripeEvents` | `StripeEventID` | `webhook`, `system` |
| `User Access` | `userAccess` | `UserAccessID` | `webhook`, `admin`, `system` |

## Paid order snapshots

New paid orders use two parallel representations during the compatibility period:

- `orders.products` remains the legacy snapshot for older readers.
- `orders.orderLines` is the immutable canonical snapshot and is marked by
  `orderLineSchemaVersion: 2`.
- `orderItems/{orderId}_{lineNumber}` stores each canonical line independently for
  fulfilment, refund, reporting, and backup use.
- Order, Product stock, selected ProductVariant stock, and ProductComponent inventory
  deductions are committed transactionally. The root order is the replay lock.
- A replay may restore missing `orderItems`, nested customer orders, addresses, and
  `userAccess`, but it must never deduct inventory again.
- Readers should prefer `orderLines` and fall back to `products` for historical orders.

Canonical order lines preserve Product/variant identity, SKU, quantity, price/tax
totals, shipping and inventory flags, seller/creator identity, access targets, and
the component quantities required at purchase time. Later Product edits must not
rewrite these historical values.

`userAccess` uses deterministic IDs in the form
`{userId}_{accessEntityType}_{accessEntityId}`. ProductAccessGrant duration settings
are resolved to `expiresAt` when access is granted; permanent grants use `null`.

## items

Source sheet: `Items`

Purpose: master item/content record. This can represent a tool, course, workshop,
blueprint, exercise, glossary item, or other content.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `ItemID` | document ID, `itemId` |
| `Item Name` | `name` |
| `FirebaseType` | `type` |
| `ItemType` | `itemType` |
| `CategoryID` | `categoryId` |
| `TagID` | `tagIds` |
| `SoldByRecoveryTools` | `soldByRecoveryTools` |
| `IsShopProduct` | `isShopProduct` |
| `Supplier Type` | `supplierType` |
| `Website Visible` | `websiteVisible` |
| `Short Description` | `shortDescription` |
| `Long Description` | `longDescription` |
| `Unlocks access` | `unlocksAccess` |
| `Access Type` | `accessType` |
| `Related PlanID` | `relatedPlanId` |
| `Related PlanCourseDetailID` | `relatedCourseId` |
| `Related WorkshopID` | `relatedWorkshopId` |
| `Access Code Eligable` | `accessCodeEligible` |
| `inventoryTracked` | `inventoryTracked` |
| `StockStatus` | `stockStatus` |
| `createdAt` | `createdAt` |
| `updatedAt` | `updatedAt` |
| `Notes` | `notes` |

### Join Keys

- `Items.ItemID` -> `ItemProduct.ItemID`
- `Items.ItemID` -> `ItemVariants.ItemID`
- `Items.ItemID` -> `ItemAsset.ItemID`
- `Items.ItemID` -> `Inventory.ItemID`
- `Items.TagID` -> `Tags.TagID`
- `Items.CategoryID` -> `Category.CategoryID`

### Derived Fields

- `type`: lowercase normalized `FirebaseType`.
- `tagIds`: array. Split comma-separated values if multiple tags are added later.
- `visible`: `websiteVisible === true`.
- `searchKeywords`: optional generated array from name, type, category, tags.

### Validation Rules

- `itemId` is required and must start with `ITEM-`.
- `name` is required.
- `type` must be one of `tool`, `course`, `workshop`, `blueprint`, `exercise`, `resource`, or another documented app type.
- `categoryId` should exist in `Category`.
- `tagIds` should exist in `Tags`.

### Writers

- `admin`: create/update item metadata.
- `system`: initial import and batch maintenance.
- `user`: no direct writes.
- `webhook`: no direct writes.

## products

Source sheet: `ItemProduct` (legacy compatibility) or `Products` (canonical v10)

A canonical `Products` row with the same ProductID takes precedence. `ItemProduct`
remains readable during migration and must not be deleted before checkout/access parity passes.

Purpose: sellable product listing shown in the shop.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `ItemProductID` | document ID, `productId` |
| `ItemID` | `itemId` |
| `ProductTitle` | `name` |
| `Shop Status` | `shopStatus` |
| `SortOrder` | `sortOrder` |
| `Featured` | `featured` |
| `Requires Shipping` | `requiresShipping` |
| `SKU` | `sku` |
| `ProductShortDescription` | `shortDescription` |
| `ProductLongDescription` | `longDescription` |
| `Supplier Type` | `supplierType` |
| `Unlocks access` | `unlocksAccess` |
| `Access Type` | `accessType` |
| `Related PlanID` | `relatedPlanId` |
| `Related PlanCourseDetailID` | `relatedCourseId` |
| `Related WorkshopID` | `relatedWorkshopId` |
| `Access Code Eligible` | `accessCodeEligible` |
| `slug` | `slug` |
| `createdAt` | `createdAt` |
| `updatedAt` | `updatedAt` |
| `Notes` | `notes` |

### Join Keys

- `ItemProduct.ItemProductID` -> `ProductPrice.ItemProductID`
- `ItemProduct.ItemID` -> `Items.ItemID`
- `ItemProduct.ItemID` -> `ItemAsset.ItemID`
- `ItemProduct.ItemID` -> `ItemVariants.ItemID`
- `ProductPrice.VariantID` -> `ItemVariants.VariantID`

### Derived Fields

- `type`: from linked `Items.type`.
- `categoryId`: from linked `Items.categoryId`.
- `tagIds` and `tags`: from linked `Items.TagID` and `Tags`.
- `visible`: `shopStatus === "active" && linked Items.websiteVisible === true`.
- `price`: active linked `ProductPrice.EffectiveShopPrice` where `Status === active` and no `VariantID`, or lowest active variant price.
- `priceFrom`: lowest active linked price when variants exist.
- `hasVariants`: true when active `ItemVariants` exist for the linked `itemId`.
- `images`: active public image URLs derived from `ItemAsset -> Asset`.
- `media`: active public assets derived from `ItemAsset -> Asset`.

### Validation Rules

- `productId` is required and should start with `PROD-`.
- `itemId` must exist in `items`.
- `name`, `sku`, and `slug` are required for shop products.
- `slug` must be unique across products.
- `shopStatus` must be one of `active`, `draft`, `archived`.
- At least one active price should exist before publishing.

### Writers

- `admin`: create/update products.
- `system`: initial import and derived field refresh.
- `user`: no direct writes.
- `webhook`: no direct writes.

## productPrices

Source sheet: `ProductPrice`

Purpose: source of truth for product/variant prices, GST, affiliate price data,
and Stripe product/price IDs.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `PriceID` | document ID, `priceId` |
| `ItemProductID` | `productId` |
| `VariantID` | `variantId` |
| `Currency` | `currency` |
| `RetailPrice` | `retailPrice` |
| `SalePrice` | `salePrice` |
| `OnSale` | `onSale` |
| `EffectiveShopPrice` | `effectiveShopPrice` |
| `WholesaleCost` | `wholesaleCost` |
| `GSTIncluded` | `gstIncluded` |
| `GSTAmount` | `gstAmount` |
| `RetailPriceExGST` | `retailPriceExGst` |
| `GrossProfit` | `grossProfit` |
| `GrossMarginPercent` | `grossMarginPercent` |
| `AffiliatePrice` | `affiliatePrice` |
| `AffiliateCommission` | `affiliateCommission` |
| `AffiliateProfit` | `affiliateProfit` |
| `DonationAmount` | `donationAmount` |
| `PartnerShareAffiliate` | `partnerShareAffiliate` |
| `PartnerShareRetail` | `partnerShareRetail` |
| `stripeProductId` | `stripeProductId` |
| `stripePriceId` | `stripePriceId` |
| `EffectiveFrom` | `effectiveFrom` |
| `EffectiveTo` | `effectiveTo` |
| `Status` | `status` |
| `Notes` | `notes` |

### Join Keys

- `ProductPrice.ItemProductID` -> `ItemProduct.ItemProductID`
- `ProductPrice.VariantID` -> `ItemVariants.VariantID`

### Derived Fields

- `active`: `status === "active"`.
- `effectiveShopPrice`: if sale is active, use `SalePrice`, otherwise `RetailPrice`.
- Product-level `products.price` or `products.priceFrom` is derived from active prices.

### Validation Rules

- Import only rows with `ItemProductID`.
- `priceId`, `productId`, `currency`, `retailPrice`, `effectiveShopPrice`, and `status` are required.
- `currency` should be `AUD`.
- Only one active non-variant price per `productId`.
- Only one active price per `productId + variantId`.
- Prices must be numbers greater than or equal to 0.

### Writers

- `admin`: manage pricing and Stripe IDs.
- `system`: initial import and Stripe synchronization.
- `user`: no direct writes.
- `webhook`: may update Stripe metadata only through trusted backend logic.

## itemVariants

Source sheet: `ItemVariants`

Purpose: product options such as colour, size, volume, weight, or pack size.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `VariantID` | document ID, `variantId` |
| `ItemID` | `itemId` |
| `Variant Name` | `name` |
| `Colour` | `colour` |
| `Size` | `size` |
| `SKU` | `sku` |
| `Price Override` | `priceOverride` |
| `ItemAssetID` | `itemAssetId` |
| `Status` | `status` |

### Join Keys

- `ItemVariants.ItemID` -> `Items.ItemID`
- `ItemVariants.VariantID` -> `ProductPrice.VariantID`
- `ItemVariants.VariantID` -> `Inventory.VariantID`
- `ItemVariants.ItemAssetID` -> `ItemAsset.ItemAssetID`

### Derived Fields

- `active`: `status === "active"`.
- `options`: object built from populated variant option columns, for example `{ colour, size }`.

### Validation Rules

- `variantId`, `itemId`, `name`, and `status` are required.
- `itemId` must exist in `items`.
- `sku` should be unique when populated.

### Writers

- `admin`: create/update variants.
- `system`: initial import.
- `user`: no direct writes.
- `webhook`: no direct writes.

## assets

Source sheet: `Asset` (legacy compatibility) or `Assets` (canonical v10)

A canonical `Assets` row with the same AssetID takes precedence. The singular
`Asset` sheet remains readable until EntityAssets migration is validated.

Purpose: one row per actual media/file asset. The same asset can be linked to
many items through `itemAssets`.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `AssetID` | document ID, `assetId` |
| `AssetName` | `name` |
| `AssetType` | `type` |
| `Title` | `title` |
| `AltText` | `altText` |
| `FileURL` | `fileUrl` |
| `ThumbnailURL` | `thumbnailUrl` |
| `Status` | `status` |
| `OwnerUserID` | `ownerUserId` |
| `CreatedDate` | `createdAt` |
| `Notes` | `notes` |

### Join Keys

- `Asset.AssetID` -> `ItemAsset.AssetID`
- `Asset.OwnerUserID` -> `Users.UserID`

### Derived Fields

- `publicUrl`: `fileUrl` when the asset is active and linked with public display status.

### Validation Rules

- `assetId`, `type`, `title`, and `status` are required.
- `fileUrl` is required before public display.
- `type` should be one of `image`, `video`, `pdf`, `audio`, `document`, or another documented type.

### Writers

- `admin`: create/update assets.
- `system`: import and storage synchronization.
- `user`: no direct writes unless a future upload feature is explicitly built.
- `webhook`: no direct writes.

## itemAssets

Source sheet: `ItemAsset`

Purpose: linking table that says where/how an asset is used.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `ItemAssetID` | document ID, `itemAssetId` |
| `ItemID` | `itemId` |
| `AssetID` | `assetId` |
| `Purpose` | `purpose` |
| `SortOrder` | `sortOrder` |
| `DisplayStatus` | `displayStatus` |
| `ContextTitle` | `contextTitle` |
| `ContextAltText` | `contextAltText` |
| `Notes` | `notes` |

### Join Keys

- `ItemAsset.ItemID` -> `Items.ItemID`
- `ItemAsset.AssetID` -> `Asset.AssetID`
- Product media joins through `ItemProduct.ItemID -> ItemAsset.ItemID -> Asset.AssetID`.

### Derived Fields

- Product `images`: linked assets where asset type is image and display status is public/active.
- Product `media`: all linked public assets sorted by `sortOrder`.

### Validation Rules

- `itemAssetId`, `itemId`, `assetId`, and `displayStatus` are required.
- `itemId` must exist in `items`.
- `assetId` must exist in `assets`.

### Writers

- `admin`: link/unlink assets.
- `system`: initial import.
- `user`: no direct writes.
- `webhook`: no direct writes.

## inventory

Source sheet: `Inventory`

Purpose: stock and inventory part tracking.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `Inventory ID` | document ID, `inventoryId` |
| `InventoryItemName` | `name` |
| `ItemID` | `itemId` |
| `VariantID` | `variantId` |
| `Part Cost` | `partCost` |
| `Part 1 Supplier` | `supplier` |
| `Stock Qty` | `stockQty` |

### Join Keys

- `Inventory.ItemID` -> `Items.ItemID`
- `Inventory.VariantID` -> `ItemVariants.VariantID`

### Derived Fields

- Product `stock`: sum linked inventory stock for the product's `itemId`.
- Variant `stock`: sum linked inventory stock for the `variantId`.

### Validation Rules

- `inventoryId`, `name`, and `stockQty` are required.
- `stockQty` must be a number greater than or equal to 0.
- `variantId` is optional for non-variant inventory.

### Writers

- `admin`: update stock.
- `system`: initial import and future stock adjustments.
- `webhook`: may decrement stock through trusted order processing.
- `user`: no direct writes.

## users

Source sheet: `Users`

Purpose: user profile document. `Users.UserID` is the Firebase Auth UID and the
Firestore document ID.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `UserID` | document ID, `userId` |
| `Name` | `name` |
| `Phone` | `phone` |
| `Email` | `email` |
| `Shipping Address Line 1` | `defaultShippingAddress.line1` |
| `Shipping Address Line 2` | `defaultShippingAddress.line2` |
| `City` | `defaultShippingAddress.city` |
| `Post Code` | `defaultShippingAddress.postcode` |
| `Billing Address Same as Shipping?` | `billingSameAsShipping` |
| `ABN` | `business.abn` |
| `Business Type` | `business.type` |
| `Business Address` | `business.address` |
| `Business Phone` | `business.phone` |
| `Business Email` | `business.email` |
| `StripeCustomerID` | `stripeCustomerId` |
| `UserStatus` | `status` |
| `CreatedAt` | `createdAt` |
| `UpdatedAt` | `updatedAt` |
| `LastLoginAt` | `lastLoginAt` |
| `Notes` | `notes` |

### Join Keys

- `Users.UserID` -> Firebase Auth UID.
- `Users.UserID` -> `Affiliates.UserID`, `Therapists.UserID`, `Instructors.UserID`, `Admin.UserID`.
- `Users.UserID` -> `User Access.UserID`.
- `Users.UserID` -> `Orders.FirebaseUserID`.

### Derived Fields

- `roles`: derived by active role profile rows in role-specific sheets/collections.
- `defaultBillingAddress`: if billing same as shipping, copy shipping address.

### Validation Rules

- `userId` and `email` are required for real users.
- Users can only update allowed profile fields.
- Users cannot set their own status, role, Stripe IDs, access grants, or order data.

### Writers

- `user`: own profile fields only.
- `admin`: status and admin-managed profile support fields.
- `system`: auth/profile creation, login timestamp, import.
- `webhook`: may set `stripeCustomerId` through trusted backend only.

## orders

Source sheet: `Orders`

Purpose: order summary and admin/user-facing order status.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `OrderID` | document ID, `orderId` |
| `FirebaseUserID` | `userId` |
| `StripeCheckoutSessionID` | `stripeCheckoutSessionId` |
| `StripePaymentIntentID` | `stripePaymentIntentId` |
| `StripeCustomerID` | `stripeCustomerId` |
| `InvoiceID` | `invoiceId` |
| `OrderDate` | `orderDate` |
| `OrderStatus` | `orderStatus` |
| `PaymentStatus` | `paymentStatus` |
| `FulfilmentStatus` | `fulfilmentStatus` |
| `Subtotal` | `subtotal` |
| `ShippingAmount` | `shippingAmount` |
| `GSTAmount` | `gstAmount` |
| `Total` | `total` |
| `Currency` | `currency` |
| `CustomerName` | `customerName` |
| `CustomerEmail` | `customerEmail` |
| `CustomerPhone` | `customerPhone` |
| `ShippingAddressID` | `shippingAddressId` |
| `BillingAddressID` | `billingAddressId` |
| `TrackingID` | `trackingId` |
| `ShippingCarrier` | `shippingCarrier` |
| `ShippingURL` | `shippingUrl` |
| `PackedAt` | `packedAt` |
| `ShippedAt` | `shippedAt` |
| `DeliveredAt` | `deliveredAt` |
| `AdminNotes` | `adminNotes` |
| `CreatedAt` | `createdAt` |
| `UpdatedAt` | `updatedAt` |

### Join Keys

- `Orders.OrderID` -> `OrderItem.OrderID`
- `Orders.OrderID` -> `CustomerAddresses.OrderID`
- `Orders.OrderID` -> `Shipments.OrderID`
- `Orders.OrderID` -> `StripeEvents.OrderID`
- `Orders.FirebaseUserID` -> `Users.UserID`

### Derived Fields

- `itemsSummary`: denormalized short product list for admin/user order tables.
- `hasPhysicalItems`: true when any order item requires shipping.
- `accessStatus`: derived from user access grants for digital products.

### Validation Rules

- `orderId`, `userId`, `orderStatus`, `paymentStatus`, `fulfilmentStatus`, `total`, and `currency` are required.
- Users cannot create or edit orders directly.
- Admin can update fulfilment and notes, but not payment totals.

### Writers

- `webhook`: creates orders and payment state.
- `admin`: fulfilment, tracking, admin notes.
- `system`: import/maintenance.
- `user`: read own orders only.

## orderItems

Source sheet: `OrderItem`

Purpose: purchased item snapshot. This preserves what was bought, even if the
product later changes.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `OrderItemID` | document ID, `orderItemId` |
| `OrderID` | `orderId` |
| `ItemProductID` | `productId` |
| `ItemID` | `itemId` |
| `VariantID` | `variantId` |
| `ProductTitle` | `productTitle` |
| `VariantName` | `variantName` |
| `SKU` | `sku` |
| `Quantity` | `quantity` |
| `UnitPrice` | `unitPrice` |
| `LineTotal` | `lineTotal` |
| `ProductType` | `productType` |
| `RequiresShipping` | `requiresShipping` |
| `AccessGranted` | `accessGranted` |
| `AccessType` | `accessType` |
| `RelatedPlanID` | `relatedPlanId` |
| `RelatedCourseID` | `relatedCourseId` |
| `RelatedWorkshopID` | `relatedWorkshopId` |
| `RefundStatus` | `refundStatus` |
| `Notes` | `notes` |

### Join Keys

- `OrderItem.OrderID` -> `Orders.OrderID`
- `OrderItem.ItemProductID` -> `ItemProduct.ItemProductID`
- `OrderItem.ItemID` -> `Items.ItemID`
- `OrderItem.VariantID` -> `ItemVariants.VariantID`

### Derived Fields

- `lineTotal`: `quantity * unitPrice`.
- User access grants can be created from order items with access fields.

### Validation Rules

- `orderItemId`, `orderId`, `productTitle`, `quantity`, `unitPrice`, and `lineTotal` are required.
- Store snapshot values from checkout, not live product lookups only.

### Writers

- `webhook`: creates from Stripe/order confirmation.
- `system`: import/maintenance.
- `admin`: no normal edits except support corrections through backend.
- `user`: read own order items only.

## customerAddresses

Source sheet: `CustomerAddresses`

Purpose: order-specific shipping and billing address snapshots.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `AddressID` | document ID, `addressId` |
| `OrderID` | `orderId` |
| `FirebaseUserID` | `userId` |
| `AddressType` | `addressType` |
| `Name` | `name` |
| `Email` | `email` |
| `Phone` | `phone` |
| `Line1` | `line1` |
| `Line2` | `line2` |
| `City` | `city` |
| `State` | `state` |
| `Postcode` | `postcode` |
| `Country` | `country` |
| `CreatedAt` | `createdAt` |

### Join Keys

- `CustomerAddresses.OrderID` -> `Orders.OrderID`
- `CustomerAddresses.FirebaseUserID` -> `Users.UserID`

### Derived Fields

- `formattedAddress`: optional generated display string.

### Validation Rules

- Shipping addresses require name, email, phone, line1, city, state, postcode, and country for domestic parcels.
- Users can update profile/default addresses, but order address snapshots should be created by webhook/system.

### Writers

- `webhook`: creates order address snapshots.
- `user`: may update own default profile address, not historic order snapshots.
- `admin`: support corrections through backend.
- `system`: import/maintenance.

## shipments

Source sheet: `Shipments`

Purpose: shipment and fulfilment tracking. One order may have multiple shipments.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `ShipmentID` | document ID, `shipmentId` |
| `OrderID` | `orderId` |
| `FulfilmentStatus` | `fulfilmentStatus` |
| `Carrier` | `carrier` |
| `TrackingID` | `trackingId` |
| `TrackingURL` | `trackingUrl` |
| `ShippingLabelURL` | `shippingLabelUrl` |
| `PackedBy` | `packedByUserId` |
| `PackedAt` | `packedAt` |
| `ShippedAt` | `shippedAt` |
| `DeliveredAt` | `deliveredAt` |
| `ShippingCost` | `shippingCost` |
| `PackageWeight` | `packageWeight` |
| `PackageNotes` | `packageNotes` |
| `CreatedAt` | `createdAt` |
| `UpdatedAt` | `updatedAt` |

### Join Keys

- `Shipments.OrderID` -> `Orders.OrderID`
- `Shipments.PackedBy` -> `Users.UserID`

### Derived Fields

- Update parent order `fulfilmentStatus`, `trackingId`, `shippingCarrier`, and `shippingUrl` from latest shipment when appropriate.

### Validation Rules

- `shipmentId`, `orderId`, and `fulfilmentStatus` are required.
- Tracking fields are required once status becomes shipped.

### Writers

- `admin`: fulfilment and tracking updates.
- `system`: shipment sync/import.
- `webhook`: no direct writes unless a shipping provider webhook is added later.
- `user`: read own shipment status only.

## stripeEvents

Source sheet: `StripeEvents`

Purpose: audit and idempotency log for Stripe webhook processing.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `StripeEventID` | document ID, `stripeEventId` |
| `EventType` | `eventType` |
| `StripeCreatedAt` | `stripeCreatedAt` |
| `ProcessedAt` | `processedAt` |
| `ProcessingStatus` | `processingStatus` |
| `OrderID` | `orderId` |
| `StripeCheckoutSessionID` | `stripeCheckoutSessionId` |
| `StripePaymentIntentID` | `stripePaymentIntentId` |
| `StripeCustomerID` | `stripeCustomerId` |
| `RawEventStored` | `rawEventStored` |
| `ErrorMessage` | `errorMessage` |
| `Notes` | `notes` |

### Join Keys

- `StripeEvents.OrderID` -> `Orders.OrderID`
- `StripeEvents.StripeCheckoutSessionID` -> `Orders.StripeCheckoutSessionID`

### Derived Fields

- Used to prevent duplicate processing of the same Stripe event.

### Validation Rules

- `stripeEventId`, `eventType`, and `processingStatus` are required.
- Never write raw sensitive card data.

### Writers

- `webhook`: create/update event logs.
- `system`: maintenance.
- `admin`: read/debug only.
- `user`: no access.

## userAccess

Source sheet: `User Access`

Purpose: records content access granted to a user.

### Column Map

| Sheet column | Firestore field |
|---|---|
| `UserAccessID` | document ID, `userAccessId` |
| `UserID` | `userId` |
| `AccessType` | `accessType` |
| `AccessID` | `accessId` |
| `GrantedDate` | `grantedAt` |
| `ExpiryDate` | `expiresAt` |
| `SourceItemID` | `sourceItemId` |

### Join Keys

- `User Access.UserID` -> `Users.UserID`
- `User Access.SourceItemID` -> `Items.ItemID`
- `User Access.AccessID` -> target plan/course/workshop/blueprint depending on `AccessType`.

### Derived Fields

- `active`: true when not expired and not revoked.
- Can be generated from paid `OrderItem` rows or access code redemption.

### Validation Rules

- `userAccessId`, `userId`, `accessType`, `accessId`, and `grantedAt` are required.
- Users cannot grant their own access.

### Writers

- `webhook`: grants access after successful purchase.
- `admin`: manual grants/revocations.
- `system`: access code redemption and import.
- `user`: read own access only.

## Product and Asset runtime compatibility

During the migration window, runtime Product reads use canonical-first adapters:

- `productVariants` precedes `itemVariants` for a Product; Item-linked legacy variants remain a fallback.
- `entityAssets` + `assets` + `assetRenditions` precede embedded Product media and image arrays.
- `productAccessGrants` precedes legacy related Plan, Course, and Workshop fields.
- Active, non-variant `productPrices` rows supply the canonical effective price before flat Product price fields.
- The legacy Product `type` remains available for existing filters and commission settings; canonical `productType` is a separate field.

Checkout, confirmation, Stripe webhook processing, admin Content Builder hydration,
catalogue reads, and inventory editing all use this compatibility layer. Do not remove
legacy collections until parity tests and the rollback gates in the migration plan pass.

### Canonical admin writes

Content Builder saves now create or update canonical Product identity fields and write
`productLinks`, `productVariants`, `productAccessGrants`, and `entityAssets` where the
corresponding relationship exists. Compatibility `itemVariants` and `itemAssets` writes
remain during the migration window.

`CreatesProduct = false` does not automatically remove existing ProductLinks. The
explicit unlink action archives matching ProductLinks only; it never deletes the
Product or linked Item, Blueprint, Plan, or Asset.

The admin Asset Library treats `assets` as first-class records. Renditions are
upserted in `assetRenditions`; omitted saved renditions are archived. Linked usage
is read from `entityAssets`, and explicit link/unlink actions create or archive only
the EntityAsset relationship. Asset files and linked entities are not deleted.

Content editors may select an existing Product and a ProductLink role. This writes
only the relationship (plus a Plan access grant for an access-delivery role) and
does not overwrite the selected Product's commercial fields.
