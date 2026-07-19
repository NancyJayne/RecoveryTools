# Product and Asset Refactor Migration Plan

Status: planning and dependency audit only. No legacy collection or field may be removed until the emulator migration, checkout, access, inventory, import/export, and order-history gates in this document pass.

## 1. Confirmed current architecture

The application already has independent Firestore `products` and `assets` collections, but the workbook and several code paths still use legacy Item-centred relationships:

- Workbook `ItemProduct` rows import into Firestore `products`.
- Workbook `ItemVariants` rows import into `itemVariants`; variants are still joined through Item IDs in parts of the importer.
- Workbook `ItemAsset` rows import into `itemAssets`, which only links an Asset to an Item.
- `productPrices` is a separate compatibility collection and is folded into product responses.
- Checkout reads commercial, inventory, shipping and access fields directly from `products`.
- Checkout and webhook access still infer grants from `type`, `unlocksAccess`, `accessType`, `relatedPlanId`, `relatedCourseId`, and `relatedWorkshopId`.
- Confirmed orders store purchased-product snapshots in `orders.products`; these snapshots must remain immutable.
- Business-profile files such as logos and policy documents resolve through `itemAssets`.
- The Content Builder currently creates and synchronises `itemAssets` only for Item records.

The target model is therefore an additive normalisation of existing first-class Product and Asset records, not a destructive rename.

## 2. Target collection model

### Core content

- `items`: reusable things, resources, components and equipment.
- `blueprints`: reusable methods, lessons, activities and production processes.
- `plans`: ordered reusable experiences and workflows.
- Add `createsProduct` to all three. It is an editor affordance only; `productLinks` remains relationship truth.

### Commerce

- `products`
- `productLinks`
- `productOptions`
- `productOptionValues`
- `productVariants`
- `productVariantValues`
- `productComponents`
- `productAccessGrants`

### Media

- `assets`
- `entityAssets`
- `assetRenditions`

### Compatibility during migration

- Keep `productPrices`, `itemVariants`, `itemAssets`, and workbook `ItemProduct` readable.
- Do not delete or rewrite historical `orders`, `orderItems`, user order copies, Stripe events, purchases, workshop tickets, or `userAccess`.
- Add compatibility adapters at repository/service boundaries. New writes move to the target collections only after validation gates pass.

## 3. Legacy dependency inventory

### Workbook and import/export

- `functions/scripts/importMasterDatabase.js`: maps `ItemProduct` to `products`, `ItemVariants` to `itemVariants`, `ItemAsset` to `itemAssets`; derives product images/media and access fields.
- `functions/scripts/seedRecoveryProducts.js`: reads `ItemProduct`, `ItemAsset`, Items access fields, and legacy fallback products.
- `functions/scripts/exportFirestoreBackup.js`: exports existing product, price, variant, asset and item-asset collections.
- `docs/firestore-data-map.md` and `docs/import-export-workflow.md`: document the legacy workbook mappings.

### Admin and Content Builder

- `functions/admin/createContentBuilderRecord.js`: creates Assets and ItemAsset relationships for Item uploads and linked Asset template fields.
- `functions/admin/updateContentControlRecord.js`: synchronises ItemAsset relationships.
- `functions/admin/getContentBuilderData.js`: hydrates product and Asset relationships into content records.
- `functions/admin/contentTemplateDefinitions.js` and `functions/admin/upsertContentBuilderTemplate.js`: define linked-Asset template behaviour.
- `src/admin/admin-content-builder.js`, `src/admin/admin-content-controls.js`, `src/admin/admin-products.js`, and `index.html`: expose Item commerce fields and current product/asset controls.
- `functions/admin/updateBusinessSettings.js` and `functions/utils/businessProfile.js`: create and resolve business files through Items and ItemAssets.

### Shop and commerce

- `functions/products/getFirestoreProducts.js`: combines `products`, `productPrices`, and `itemVariants`; accepts legacy product `type`, price, stock, visibility and embedded media.
- `functions/products/createProduct.js`, `updateProduct.js`, `updateProductInventory.js`, and `deleteProduct.js`: write the current flat Product model and itemVariants.
- `src/shop/shop-products.js`, `shop-checkout.js`, `shop-orders.js`, `shop-related.js`, `src/content/product-catalog.js`, and `src/content/homepage.js`: consume the current normalised Product response.
- Affiliate course/workshop screens write directly to `products` and use product type as the content classification.
- Product reviews and review emails use `products/{productId}/reviews`; this subcollection path should remain stable even when Product fields are normalised.
- Homepage, related-product, catalogue and structured-data rendering depend on the current flattened Product response, so the catalogue adapter must preserve that response contract during migration.

### Checkout, orders, access and fulfilment

- `functions/orders/createCheckoutSession.js`: reads flat price, stock, shipping, itemVariant and legacy access fields; copies them into Stripe metadata.
- `functions/orders/confirmStripePurchase.js`: decrements Product/itemVariant stock, creates inventory entries, snapshots product lines, and grants course/workshop access from Product type.
- `functions/webhooks/handleStripeWebhook.js`: independently snapshots Product data and creates `userAccess` from legacy Product/access metadata.
- Order views, emails, PDFs and fulfilment functions read the immutable `orders.products` snapshot and must keep that fallback.
- Review eligibility, affiliate commission classification, referrals, invoices and customer order history also consume the purchased Product type/snapshot and require regression coverage.

### Rules and indexes

- `firestore.rules`: has rules for `products`, `productPrices`, `itemVariants`, `assets`, and `itemAssets`; target collections are currently denied by the catch-all.
- `firestore.indexes.json`: does not yet contain the required ProductLink, EntityAsset, ProductVariant or marketplace compound indexes.

## 4. Staged migration

### Phase 0 - Baseline and backups

1. Export a full emulator backup and a versioned workbook copy.
2. Produce counts and ID hashes for all affected collections.
3. Capture checkout fixtures for physical, digital/course, workshop and variant products.
4. Capture access fixtures for existing users and order snapshots.
5. Do not use reconcile/delete mode during migration development.

Gate: backups restore successfully and baseline tests reproduce current behaviour.

### Phase 1 - Add schemas without changing reads

1. Add target workbook sheets and importer parsers.
2. Add target Firestore rules and indexes.
3. Add schema validators and shared normalisers.
4. Add `createsProduct` to Item, Blueprint and Plan documents.
5. Keep all shop, checkout and Content Builder reads on the legacy-compatible adapter.

Gate: existing workbook/import, app build and checkout tests remain unchanged.

This repository currently uses JavaScript modules rather than TypeScript application interfaces. Implement runtime schema validators and JSDoc typedefs now; add TypeScript interfaces only if/when the affected module is migrated to TypeScript.

### Phase 2 - Idempotent migration command

Implementation status: complete in the isolated Firestore emulator on 2026-07-17.
The first verified run created 63 canonical records and added canonical fields to 23
existing records. The second run produced zero creates and zero updates. Legacy
Product, ProductPrice, ItemVariant, ItemAsset, Asset, Order and OrderItem counts were
unchanged. Ten missing legacy Plan/Course access targets were reported and skipped
rather than creating invalid relationships.

Create a migration with `--dry-run`, `--emulator`, report output and repeat-safe IDs. It must:

1. Convert each `ItemProduct`/legacy Product into a canonical Product without changing a valid ProductID or Stripe ID.
2. Create `productLinks` for represented Items and unlocked Plans/Blueprints/Assets.
3. Convert `itemVariants` into `productVariants`; create options and option values where source data permits.
4. Convert Product bill-of-material relationships into `productComponents` without treating Blueprints as stock.
5. Convert `itemAssets` into `entityAssets` and preserve role, order, visibility and context.
6. Create `productAccessGrants` from legacy access fields.
7. Set `createsProduct = true` where active ProductLinks exist.
8. Mark legacy workbook rows `LegacyMigrated`, `MigratedProductID`, and `ReadOnly`; do not delete them.
9. Report duplicates, missing targets, conflicting primary links, missing Stripe IDs, missing media, and access mismatches.

Gate: a second migration run produces zero new documents and no changed business values.

### Phase 3 - Dual-read adapters

Introduce shared services used by admin, shop, checkout and webhook code:

- Product catalogue adapter: canonical Product + active/default ProductVariant + EntityAssets, with fallback to productPrices/itemVariants/embedded media.
- Product relationship adapter: ProductLinks first, then legacy `itemId` and access fields.
- Product access adapter: ProductAccessGrants first, then legacy access metadata.
- Asset adapter: EntityAssets/AssetRenditions first, then itemAssets/original Asset URL.
- Inventory adapter: ProductVariant/ProductComponents first, then itemVariants/Product stock.

Gate: old and migrated fixtures return equivalent shop cards, checkout totals, shipping decisions, images and access outcomes.

### Phase 4 - Admin UI and new writes

1. Add Product and Asset as top-level admin entities.
2. Add `createsProduct` and Linked Products panels to Item, Blueprint and Plan editors.
3. Build the Product editor sections specified in the refactor brief.
4. Build Asset links and renditions in the Asset editor.
5. New Product, ProductVariant, EntityAsset and access writes target canonical collections.
6. Unlink actions must never delete the Product, Asset or linked content entity.
7. New Products default to Draft.

Gate: admin tests cover all required create/link/unlink cases and no legacy write is required for new records.

### Phase 5 - Checkout, inventory and access cutover

1. Resolve checkout price, shipping, seller, variant and inventory from canonical Product/ProductVariant data.
2. Store immutable purchased title, SKU, unit price, tax, variant, shipping and access-target snapshots on order lines.
3. Use ProductAccessGrants after confirmed payment; keep webhook processing idempotent.
4. Deduct ProductVariant inventory and component inventory transactionally.
5. Preserve existing `orders.products` readers and add a versioned canonical order-line shape for new orders.

Gate: Stripe test checkout, webhook replay, duplicate confirmation, physical stock, variant stock, course access, workshop ticketing, refunds/fulfilment views and existing user access all pass in the emulator.

### Phase 6 - Read cutover and deprecation

1. Switch shop/admin reads to canonical adapters with migration telemetry.
2. Stop new writes to ItemProduct, itemVariants and itemAssets.
3. Remove Product-only fields from Item forms and hide deprecated ItemType choices.
4. Retain compatibility reads until production reports show no unresolved legacy documents.
5. Only then consider archival—not deletion—of legacy structures.

Gate: zero unresolved legacy fallbacks for an agreed observation period and a verified rollback export.

## 5. Workbook changes

Add these canonical sheets:

- `Products`
- `ProductLinks`
- `ProductOptions`
- `ProductOptionValues`
- `ProductVariants`
- `ProductVariantValues`
- `ProductComponents`
- `ProductAccessGrants`
- `Assets`
- `EntityAssets`
- `AssetRenditions`

Update `Items`, `Blueprints`, and `Plan` with `CreatesProduct`. Deprecate Product-only Item fields only after migration validation. Retain `ItemProduct`, `ItemVariants`, `ProductPrice`, `Asset`, and `ItemAsset` during the compatibility period with migration status columns.

Workbook import defaults to merge/upsert and must not delete Firestore-only records. Blank workbook values must not erase populated ownership, Stripe, access, inventory or audit fields unless an explicit clear operation is supported.

## 6. Before and after examples

### Trigger Ball retail pack

Before:

```text
Item ITEM-TRIGGER-BALL-6CM
  IsShopProduct = true
ItemProduct PROD-TRIGGER-BALL
  ItemID = ITEM-TRIGGER-BALL-6CM
ItemVariants
  colour/SKU/stock records tied to Item
```

After:

```text
Item ITEM-TRIGGER-BALL-6CM
  CreatesProduct = true
Product PROD-TRIGGER-BALL
  ProductType = Physical
ProductLink
  Product -> Item, Represents, primary
ProductLink
  Product -> assembly Blueprint, ProducedBy
ProductOptions / Values
  Colour -> Black, Grey, Blue, Green, Purple
ProductVariants
  one variant per colour with SKU/Stripe/inventory
ProductComponents
  Trigger Ball + Box + Sticker + Instruction Card
EntityAssets
  Product/variant -> reusable Asset records
```

### Course Plan access

Before:

```text
Product type = course
unlocksAccess = true
relatedPlanId = PLAN-TRIGGER-BALL-BASICS
```

After:

```text
Plan PLAN-TRIGGER-BALL-BASICS
  Type = course
  CreatesProduct = true
Product PROD-TRIGGER-BALL-MASTERY
  ProductType = Course Access
ProductLink
  Product -> Plan, Represents or Unlocks
ProductAccessGrant
  Product -> Plan, grant timing/duration/revocation rules
```

No Course Item is required merely to sell the Plan.

### Reusable photograph

Before:

```text
Asset ASSET-TRIGGER-BALL-PHOTO
ItemAsset -> Trigger Ball Item
```

After:

```text
Asset ASSET-TRIGGER-BALL-PHOTO
EntityAsset -> Item / Hero
EntityAsset -> Product / Gallery
EntityAsset -> Green ProductVariant / Hero
EntityAsset -> Blueprint / EquipmentImage
AssetRenditions -> Square, Portrait, Story, Thumbnail
```

## 7. Validation report requirements

Every dry run and emulator migration report must include:

- source and target counts by collection;
- stable-ID and Stripe-ID preservation;
- migrated/unresolved/duplicate/skipped rows;
- ProductLink primary and duplicate validation;
- orphaned ProductComponents and EntityAssets;
- ProductVariant option and inventory reconciliation;
- access target parity;
- shop visibility and availability parity;
- before/after checkout totals and shipping decisions;
- historical order snapshot checksum comparison;
- second-run idempotency result.

## 8. Required test matrix

The implementation is not complete until all 20 tests in the refactor brief pass. Add explicit regression cases for:

- webhook replay and duplicate checkout confirmation;
- legacy-only Product fallback;
- migrated Product canonical read;
- mixed legacy/canonical catalogue during transition;
- blank workbook fields preserving Firestore data;
- no cascading deletes when ProductLinks or EntityAssets are removed;
- historical invoice/PDF rendering after current Product data changes.

## 9. Immediate implementation sequence

1. Add shared Product/Asset schema and validation modules.
2. Add canonical workbook sheets and import/export parsing without removing legacy mappings.
3. Add Firestore rules and indexes for target collections.
4. Build the dry-run/idempotent emulator migration plus validation report.
5. Add dual-read Product, Asset, access and inventory adapters.
6. Run baseline and migrated emulator test suites.
7. Only after those gates, change admin forms and stop legacy writes.
