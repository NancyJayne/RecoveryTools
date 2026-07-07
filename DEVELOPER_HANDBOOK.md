# Recovery Tools Developer Handbook

---

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

```bash
npm run build
npm run emulators
npm run seed:all
npm run dev
```

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

## Check Status

```bash
git status
```

## Commit Changes

```bash
git add .
git commit -m "🛠 Description"
git push origin main
```

## Common Warning

```text
LF will be replaced by CRLF
```

Safe to ignore on Windows.

---

# 4. Deployment Workflow

## Build

```bash
npm install
npm update
npm run build
```

## Deploy Firestore Indexes

```bash
firebase deploy --only firestore:indexes
```

## Deploy Firestore Rules

```bash
firebase deploy --only firestore:rules
```

## Deploy Functions

```bash
firebase deploy --only functions
```

## Deploy Hosting

```bash
firebase deploy --only hosting
```

## Full Deploy

```bash
firebase deploy
```

---

# 5. Deployment Checklist

## Before Deploy

```text
□ Build passes
□ No console errors
□ Firestore rules tested
□ Functions tested
□ Checkout tested
□ Admin tested
□ Profile tested
□ Git committed
□ Backup exported (major changes only)
```

## Deploy

```text
□ Functions
□ Rules
□ Indexes
□ Hosting
```

## After Deploy

```text
□ Shop loads
□ Login works
□ Checkout works
□ Admin works
□ Order flow works
□ Stripe webhooks working
□ Access unlocks working
```

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
1. Update Firestore Schema
2. Update Functions
3. Update Firestore Rules
4. Update Admin UI
5. Update Frontend UI
6. Test In Emulator
7. Test Purchase Flow
8. Deploy Functions
9. Deploy Rules
10. Deploy Hosting
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

```bash
firebase deploy --only functions
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

```bash
firebase emulators:start
```

Or stop and restart all emulators.

---

# 17. Current Priority TODO

## Checkout

* Phone prefill
* Order persistence
* PDF receipts
* Order history

## Shop

* Related products
* Filters
* Sorting
* Sale pricing

## Admin

* CRM improvements
* Analytics dashboard
* CSV exports
* Approval workflows

## Therapist

* Therapist dashboard
* Client management

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
