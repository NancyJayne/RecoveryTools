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
