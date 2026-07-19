# Master Database Import and Backup Workflow

Use versioned `.xlsx` files as the seed source for Firestore.

## Import From Workbook

Always dry-run first:

```bash
cd functions
node scripts/importMasterDatabase.js --dry-run "C:\path\Recovery Tools Master Database v001.xlsx"
```

Import into the emulator:

```bash
cd functions
node scripts/importMasterDatabase.js --emulator "C:\path\Recovery Tools Master Database v001.xlsx"
```

Live import is intentionally guarded:

```bash
cd functions
node scripts/importMasterDatabase.js --live --confirm-live "C:\path\Recovery Tools Master Database v001.xlsx"
```

The import script:

- skips blank formula rows,
- normalizes `Yes`/`No` values,
- normalizes `ACTIVE`/`Active` status values,
- validates key relationships,
- prints document counts by collection,
- prints warnings for missing assets, descriptions, prices, or joins,
- writes with merge semantics,
- never deletes existing Firestore documents.

### Canonical Product and Asset sheets

`Recovery Tools Master Database (10).xlsx` adds canonical `Products`, `ProductLinks`,
Product option/variant/component/access sheets, `Assets`, `EntityAssets`, and
`AssetRenditions`. These are additive during migration:

- canonical rows import into the corresponding lower-camel Firestore collection;
- a canonical Product or Asset row takes precedence over a legacy row with the same stable ID;
- `ItemProduct`, `ProductPrice`, `ItemVariants`, `Asset`, and `ItemAsset` remain readable;
- empty canonical sheets do not remove or replace legacy Firestore records;
- backup export includes canonical and compatibility collections.

Use `--dry-run` before every emulator import. Do not use a destructive reconciliation
workflow to migrate these relationships.

## Product and Asset migration

The canonical migration only supports the local Firestore emulator:

```bash
cd functions
npm run migrate:product-assets:dry-run -- --report ../outputs/product-asset-dry-run.json
npm run migrate:product-assets:emulator -- --report ../outputs/product-asset-emulator.json
```

Run the complete isolated verification with a v10 workbook:

```bash
node scripts/verify-product-asset-migration-emulator.js "C:\path\Recovery Tools Master Database (10).xlsx"
```

The migration uses deterministic IDs and additive merge writes. A successful second
run reports zero creates and zero updates. Missing access targets are warnings and are
not converted into invalid ProductLinks or ProductAccessGrants.

### Runtime dual-read verification

Runtime reads now prefer canonical Product/Asset relationship records and fall back
to their legacy equivalents when canonical records do not exist. Run the fast,
Firestore-independent adapter checks after changing these mappings:

```bash
npm run verify:product-adapters
```

This checks canonical precedence and legacy fallback for prices, variants, media,
renditions, and access grants. It does not replace the isolated Firestore migration
verification or checkout/webhook emulator testing.

Run the canonical admin-write regression while the Firestore emulator is available:

```bash
npm run verify:canonical-admin-writes:emulator
```

It verifies canonical and compatibility variant writes, Item and Plan ProductLinks,
Plan access grants, EntityAsset creation, safe Asset unlinking, non-destructive
`CreatesProduct` toggling, explicit Product unlinking, standalone Product writes,
link-existing Product preservation, Asset renditions, and Asset-to-entity links.

### Checkout and historical-order compatibility

Run the fast immutable snapshot check and the Firestore emulator parity gate after
changing checkout, access, inventory, fulfilment, invoice, or order-history code:

```bash
npm run verify:order-lines
npm run verify:phase5:emulator
```

The emulator gate verifies canonical ProductVariant and ProductComponent inventory,
deterministic access grants with expiry, legacy `orders.products` compatibility,
schema-version-2 order lines, and webhook replay recovery. It deliberately removes
post-transaction side effects and replays the event to prove they are restored while
stock remains deducted exactly once.

## Backup From Firestore

Export emulator data:

```bash
cd functions
node scripts/exportFirestoreBackup.js --emulator
```

Export selected collections:

```bash
cd functions
node scripts/exportFirestoreBackup.js --emulator --collections products,orders,users
```

Live export is also guarded:

```bash
cd functions
node scripts/exportFirestoreBackup.js --live --confirm-live --out backups/firestore
```

Backups are written as timestamped JSON files with a `manifest.json`.

## Recommended Routine

1. Save a versioned workbook file.
2. Run import dry-run.
3. Fix warnings that matter for the current release.
4. Import into the emulator.
5. Run the app against the emulator.
6. Export an emulator backup if useful.
7. Only run live import/export with explicit `--live --confirm-live`.
