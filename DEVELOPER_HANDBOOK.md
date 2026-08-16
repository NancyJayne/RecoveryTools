# Recovery Tools Developer Handbook

---

> Production releases are manual and must follow `RELEASE-PROCESS.md`. The repository intentionally has no implicit default Firebase project; production commands must explicitly name `--project recovery-tools`.

# 1. Project Overview

## Tech Stack

```text
Frontend: Vite
Styling: Tailwind CSS
Backend: Firebase Functions v2
Database: Firestore
Authentication: Firebase Auth
Storage: Firebase Storage
Payments: Stripe
Node Version: 22
```

## Emulator Ports

```text
Auth: 9100
Functions: 5001
Firestore: 8080
Hosting: 5000
Storage: 9199
Tasks: 9499
```

---

# 2. Daily Development Workflow

## Open Project

```bash
cd "C:\Users\hello\Firebase project"
```

## Login (if required)

```bash
firebase login --reauth
gcloud auth application-default login
```

## Start Local Development

Use separate terminals so the emulators and Vite remain available:

```powershell
# Terminal 1
npm run emulators

# Terminal 2
npm run dev
```

Run `npm run seed:all` only when the active task explicitly requires the emulator seed data. Never seed production as part of routine development.

## Tailwind Watch Mode

```bash
npm run watch:css
```

## Preview Production Build

```bash
npm run build
npm run preview
```

## Fix Lint Issues

```bash
npx eslint . --fix
```

## Verify Imports

```bash
npm run check:imports
```

## Hard Refresh Browser

```text
Ctrl + Shift + R
```

---

# 3. Git Workflow

## Start A Feature Or Fix

Begin from an up-to-date, clean `main`, then create a focused branch:

```powershell
git switch main
git pull --ff-only
git switch -c codex/v2-short-feature-name
```

Use a short-lived `codex/v1-*` branch only for a narrow production maintenance fix.

## Check And Commit Intentionally

```powershell
git status --short
git diff --check
git diff -- path/to/file
git add -- path/to/file another/intended-file
git diff --cached --check
git commit -m "Describe the focused change"
```

Do not use `git add .` at the end of a long session. Existing unrelated changes belong to the active workspace and must not be swept into a feature commit.

Push the feature branch and merge through a pull request after verification. Do not push unfinished work directly to `main`.

## Common Warning

```text
LF will be replaced by CRLF
```

Safe to ignore on Windows.

---

# 4. Deployment Workflow

## Production Release Rule

Routine development does not deploy Firebase resources. Pull requests run verification only, and merging to `main` does not automatically release Hosting.

Before any local production release check:

```powershell
$env:RECOVERY_TOOLS_PRODUCTION_RELEASE='DEPLOY RECOVERY TOOLS'
npm run release:check
```

This guard requires `main`, a clean working tree, the expected Firebase project link, import verification, and a successful production build. It does not deploy anything.

## Hosting

Start **Manually deploy Firebase Hosting to production** from GitHub Actions. Enter a release note and approve the `production` environment. Do not deploy Hosting from an unfinished feature branch.

## Selective Backend Deployment

Deploy only reviewed resources and always name the production project:

### Firestore Indexes

```powershell
npx firebase-tools deploy --only firestore:indexes --project recovery-tools
```

### Firestore Rules

```powershell
npx firebase-tools deploy --only firestore:rules --project recovery-tools
```

### One Function

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT='30000'
npx firebase-tools deploy --only functions:functionName --project recovery-tools
```

### Storage Rules

```powershell
npx firebase-tools deploy --only storage --project recovery-tools
```

Do not use an unqualified or broad `firebase deploy` for routine releases. Only actual exported Functions belong in `--only`; do not include internal helper names.

---

# 5. Deployment Checklist

## Before Deploy

```text
□ Feature branch diff reviewed against main
□ Acceptance checklist completed in the Firebase Emulator Suite
□ Disposable test users and records used
□ Import verification passes
□ Focused regression scripts pass
□ Production build passes
□ git diff --check passes
□ NEXT-STEPS.md reflects changed priorities or handoff state
□ Release is committed and the working tree is clean
□ Firestore backup/export prepared for a material data migration
□ Rollback path and previous known-working release identified
□ Maintenance mode is ready if the release is not backward compatible
```

## Deploy

```text
□ Production project is explicitly recovery-tools
□ Maintenance mode enabled only when required
□ Backward-compatible rules, indexes, and Functions deployed first
□ Controlled data migration completed, if required
□ Hosting deployed manually after backend compatibility is ready
□ Firebase reports Deploy complete before deployment is claimed
```

## After Deploy

```text
□ Shop loads
□ Login, logout, and Profile work
□ Cart and checkout initiation work
□ Changed customer workflow works
□ Admin navigation and changed admin module work
□ Browser console and failed network requests reviewed
□ Relevant Function logs reviewed
□ Stripe webhooks and email logs checked when affected
□ Inventory and access grants checked when affected
□ Maintenance mode disabled after successful smoke testing
□ NEXT-STEPS.md and release notes updated
```

See `RELEASE-PROCESS.md` for the authoritative release and rollback procedure.

---

# 6. Firebase Scripts

## Seed User Roles

```bash
cd functions
node scripts/seedUserRoles.js
```

## Verify Auth Export

```bash
firebase auth:export users.json --format=json
```

---

## Master Database Import

Use the versioned master workbook as the seed source for Firestore. Always run a
dry-run first:

```bash
cd functions
node scripts/importMasterDatabase.js --dry-run "C:\Users\hello\Downloads\Recovery Tools Master Database (5).xlsx"
node scripts/importMasterDatabase.js --emulator "C:\Users\hello\Downloads\Recovery Tools Master Database (5).xlsx"
```

Live import/export is guarded and requires:

```bash
--live --confirm-live
```

Reference docs:

```text
docs/firestore-data-map.md
docs/import-export-workflow.md
```

---

# 7. Firestore Naming Conventions

## Collections

```text
camelCase
```

Examples:

```text
users
itemProducts
userAccess
discountCodes
```

## IDs

```text
UPPERCASE-WITH-DASHES
```

Examples:

```text
ITEM-TRIGGER-BALL-001
BLUE-RIB-MOBILITY-001
PLAN-CALM-001
COURSE-TRIGGER-BALL-001
```

---

# 8. Recovery Tools Data Model

```text
Product
 ↓
Plan
 ↓
Blueprint
 ↓
Item
```

### Definitions

**Item**
Smallest reusable building block.

Examples:

* Trigger Ball
* PDF
* Video
* Audio Track
* Ear Seeds
* Glass of Water

**Blueprint**
A method, technique, exercise, assessment, treatment or activity.

Examples:

* Rib Mobility
* Pec Release
* Median Nerve Slider
* Gargling

**Plan**
A complete session, course, recovery plan, treatment plan or exercise plan.

Examples:

* Calm Session 1
* Sleep Session 1
* Trigger Ball Neck Routine

**Product**
Sellable item that grants access.

Examples:

* Recovery Tools Calm
* Trigger Ball Mastery
* Sleep Recovery System

---

# 9. Architecture Decisions

## Golden Rule

```text
Products unlock Plans.
Plans contain Blueprints.
Blueprints contain Items.
```

## Access Logic

```text
Purchase
 ↓
Unlock Plan
 ↓
Scan Blueprints
 ↓
Scan Items
 ↓
Grant Additional Access
```

### Access is granted:

✅ Immediately after purchase/enrolment

### Access is NOT granted:

❌ When a blueprint is viewed

❌ When an item is clicked

❌ When a lesson is opened

---

## Exercise Plan Logic

Exercise Plans are Items that unlock Plans.

Example:

```text
Item:
Trigger Ball Neck Routine

Item Type:
Exercise Plan

Linked Plan:
PLAN-TRIGGER-BALL-NECK

Unlocks Access:
True
```

This avoids Plan-to-Plan relationships.

---

## Membership Logic

Memberships use the exact same unlock engine.

Only difference:

```text
Source = Membership

instead of

Source = Purchase
```

---

# 10. Firestore Collections

```text
users
items
itemAssets
itemProducts
blueprints
plans
workshops
orders
orderItems
userAccess
accessCodes
discountCodes
settings
```

---

# 11. Product Creation Checklist

```text
□ Create Item
□ Add Item Assets
□ Add Item Product
□ Upload Images
□ Add Stripe Product
□ Add Stripe Price
□ Link Stripe IDs
□ Add Category
□ Add Tags
□ Configure Unlock Logic
□ Test Purchase
□ Test Access Grant
```

---

# 12. New Feature Workflow

Whenever building a new feature:

```text
1. Confirm the acceptance criteria and affected customer/admin journeys.
2. Create a focused feature branch from an up-to-date main.
3. Update the schema, Functions, rules, admin UI, and frontend as required.
4. Keep data changes backward compatible with the currently deployed client.
5. Test with disposable data in the Firebase Emulator Suite.
6. Run focused regression scripts, import checks, lint where applicable, and the production build.
7. Review the complete diff and update NEXT-STEPS.md.
8. Commit intentionally and open a pull request.
9. Merge only after verification passes; merging does not deploy.
10. Manually deploy only the reviewed resources when the module is release-ready.
11. Complete the production smoke test and monitor affected logs.
```

---

# 13. Stripe Checkout Flow

```text
Cart
 ↓
Create Checkout Session
 ↓
Stripe Checkout
 ↓
Success Page
 ↓
confirmStripePurchase()
 ↓
Create Order
 ↓
Grant Access
 ↓
Send Emails
```

---

# 14. Admin Dashboard Structure

```text
Dashboard

Products
Items
Blueprints
Plans
Courses
Workshops

Orders
Users
Affiliates

Reports
Settings
```

---

# 15. Useful Development Notes

## Lazy Loading Images

```html
<img src="..." alt="Product Image" loading="lazy">
```

## Deep Link Example

```text
https://yourdomain.com/?tab=shop
```

## Firebase Storage

```text
storage/images/
storage/videos/
```

Use generated download URLs.

---

# 16. Troubleshooting

## Build Fails

```bash
npm install
npm run build
```

## Reinstall Dependencies

```bash
rm -rf node_modules
npm install
```

## Functions Not Updating

Confirm that the intended Function is exported from `functions/index.js`, then deploy only that Function:

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT='30000'
npx firebase-tools deploy --only functions:functionName --project recovery-tools
```

## Frontend Not Updating

```text
Ctrl + Shift + R
```

## Import Issues

```bash
npm run check:imports
```

## Emulator Problems

```powershell
npm run emulators
```

Or stop and restart all emulators.

---

# 17. Current Priorities

`NEXT-STEPS.md` is the source of truth for current priorities, completed work, acceptance gaps, known issues, and the next safe development sequence. Do not maintain a second task list in this handbook.

“V2” is a figure of speech for the next major set of modules built on the existing `recovery-tools` Firebase project. It does not mean replacing or deleting the current Firebase project. V2 modules remain on focused branches and use the emulators until individually ready for a controlled production release.

---

# 18. Future Features (Parking Lot)

* Membership system
* Exercise library
* Workshop templates
* LMS editor
* Affiliate analytics
* Therapist portal
* User tagging
* User notes
* Account flags
* Activity logs

---

# 19. Important Project Rules

### Never deploy without testing in emulator first.

### Never deploy from an unfinished feature branch.

### Never rely on an implicit Firebase project; production commands must include `--project recovery-tools`.

### Never use a broad production deploy when a targeted Function, rule, index, or Hosting release is sufficient.

### Keep schema and Function changes backward compatible with the currently deployed browser client.

### Use maintenance mode only for releases that cannot safely support both old and new clients.

### Never create duplicate unlock logic.

### Keep all access grants inside one unlock engine.

### Products should never directly unlock Blueprints.

### Plans remain the central access object.

### Reuse existing structures before creating new collections.

### Keep business logic in Functions, not Frontend.

---

# Documents

```text
DEVELOPER-HANDBOOK.md
```

Permanent project reference.

```text
NEXT-STEPS.md
```

Active development tasks only.


# 20. Firestore Schema Reference

---

## users

Purpose:

Stores user profiles, permissions, settings, and account information.

Key Fields:

```text
uid
email
displayName
phone
roles
permissions
stripeAccountId
defaultShippingAddress
checkoutProfile
emailPreferences

createdAt
updatedAt
```

Relationships:

```text
users
 ├─ orders
 ├─ userAccess
 └─ affiliate data
```

---

## items

Purpose:

Smallest reusable building block in the system.

Examples:

```text
Trigger Ball
PDF
Video
Audio Track
Glass of Water
MCT Recovery Balm
Exercise Plan Item
```

Key Fields:

```text
itemId
itemName
itemType
category
description

unlocksAccess
accessType
relatedPlanId

createdAt
updatedAt
```

Relationships:

```text
Blueprints contain Items
```

---

## itemAssets

Purpose:

Stores media attached to Items.

Examples:

```text
Images
Videos
PDFs
Audio
Downloads
```

Key Fields:

```text
assetId
itemId

assetType
assetUrl
title
sortOrder
```

Relationships:

```text
Item
 └─ Item Assets
```

---

## itemProducts

Purpose:

Sellable versions of Items.

Only records with:

```text
isShopProduct = true
```

appear in the store.

Key Fields:

```text
productId
itemId

price
salePrice

stripeProductId
stripePriceId

isShopProduct
soldByRecoveryTools

requiresShipping
inventoryTracked

slug
tags
featured
```

Relationships:

```text
Item Product
 └─ Creates access to Plans
```

---

## blueprints

Purpose:

Reusable modules.

A Blueprint contains:

```text
Instructions
Assets
Items
Contraindications
Duration
Notes
```

Examples:

```text
Median Nerve Slider
Pec Release
Gargling
Rib Mobility
```

Key Fields:

```text
blueprintId
name
category
description

duration
contraindications

published
```

Relationships:

```text
Blueprint
 └─ Items
```

---

## plans

Purpose:

Courses, exercise plans, recovery plans, treatment plans, workshops.

Examples:

```text
Calm Session 1
Trigger Ball Mastery
Sleep Recovery
```

Key Fields:

```text
planId
planName
planType

audience
visibility

createsProduct
productId

published
approvalStatus
```

Relationships:

```text
Plan
 └─ Ordered Blueprints
```

---

## workshops

Purpose:

Live events.

Key Fields:

```text
workshopId
title

startDateTime
endDateTime

location
capacity

creatorId

productId

approvalStatus
```

Relationships:

```text
Workshop
 └─ Product
```

---

## orders

Purpose:

Stores completed purchases.

Key Fields:

```text
orderId
userId

stripeSessionId
stripePaymentIntentId

subtotal
shipping
tax
total

status

createdAt
```

Relationships:

```text
Order
 └─ Order Items
```

---

## orderItems

Purpose:

Stores products purchased within an order.

Key Fields:

```text
orderItemId
orderId

productId
productName

quantity
price
```

Relationships:

```text
Order
 └─ Order Items
```

---

## userAccess

Purpose:

Central access control collection.

Determines what content a user can access.

Key Fields:

```text
uid

accessType
accessId

source
sourceId

grantedAt
expiresAt
```

Examples:

```text
Plan Access
Blueprint Access
Membership Access
Course Access
```

---

## accessCodes

Purpose:

Codes that grant access to content.

Examples:

```text
Workshop handout code
Printed product code
Bonus content code
```

Key Fields:

```text
code

accessType
accessId

usageLimit
usageCount

active
```

---

## discountCodes

Purpose:

Store promotional pricing rules.

Key Fields:

```text
code

discountType
discountAmount

startDate
endDate

usageLimit
```

---

## settings

Purpose:

Application-wide settings.

Examples:

```text
Shipping rates
Tax settings
Email settings
Affiliate settings
```

Key Fields:

```text
shipping
tax
email
affiliate
```

---

# Access Hierarchy

```text
Product
 ↓
Plan
 ↓
Blueprint
 ↓
Item
```

---

# Unlock Rules

```text
Products unlock Plans.

Plans contain Blueprints.

Blueprints contain Items.

Items may unlock additional Plans.

Memberships use the same unlock engine.

Access is granted at purchase/enrolment,
not when content is viewed.
```
