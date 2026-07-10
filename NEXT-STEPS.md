# Recovery Tools — Next Steps

## Latest Session Handoff

Workbook-backed recovery product seeding is now implemented.

Confirmed today:

* `functions/scripts/seedRecoveryProducts.js` reads `Recovery Tools Master Database (3).xlsx`.
* Product seed data is joined from `ItemProduct`, `Items`, `ProductPrice`, `Inventory`, `ItemAsset`, and `Asset`.
* `ItemProductID` is used as the Firestore `products/{productId}` document ID.
* Active `ProductPrice` rows provide `price`, `retailPrice`, sale fields, and Stripe ID placeholders.
* Inventory rows are summed into `stock`.
* Product images are resolved through `ItemAsset -> Asset.FileURL`.
* `references` and `referenceStatus` are carried through from `Items`.
* `--dry-run` validates the generated product documents without writing to Firestore.
* ESLint passed for `functions/scripts/seedRecoveryProducts.js`.

Useful commands:

```powershell
cd "C:\Users\hello\Firebase project\functions"
node scripts/seedRecoveryProducts.js --dry-run --workbook "C:\Users\hello\Downloads\Recovery Tools Master Database (3).xlsx"
node scripts/seedRecoveryProducts.js --workbook "C:\Users\hello\Downloads\Recovery Tools Master Database (3).xlsx"
```

Remaining spreadsheet checks before a live upload:

* Keep `ProductPrice.Status` set to `Active` for the price row to import.
* Keep `ItemProduct.ItemProductID` stable; changing it creates a new Firestore product document.
* Replace placeholder/fallback image behavior only after every product has a production `Asset.FileURL`.
* Standardize `Reference Status` values: `Not required`, `Needs source`, `Draft source`, `Verified`.

Stripe checkout is now completing locally through the confirmation screen.

Confirmed today:

* Product/course data imports display in shop and course sections.
* Product images, prices, descriptions, and cart add flow work from imported `products`.
* Stripe test payment succeeds.
* Return to `/checkout?success=true&session_id=...` succeeds.
* `confirmStripePurchase` now returns an order summary.
* Cart clears after confirmation.
* Checkout success removes the `Confirm and Pay` controls so users cannot click payment again.

Tomorrow verify in Firestore Emulator UI:

```text
orders/{checkoutSessionId}
users/{uid}/orders/{checkoutSessionId}
orderItems/{checkoutSessionId}_1
customerAddresses/{checkoutSessionId}_billing
customerAddresses/{checkoutSessionId}_shipping
stripeEvents/{stripeEventId}
userAccess/{userId}_{accessType}_{accessId} for digital/access products
```

Known tomorrow checks:

* Confirm whether the Stripe webhook writes the new collections during local testing.
* Confirm whether `confirmStripePurchase` writes only the legacy order shape or needs to share the webhook writer.
* Fix affiliate list rule warning from cart: `Property admin is undefined on object`.
* Later: guest checkout/auth flow, dedicated course detail page, and shop tag refinements.

## Current Status

### Platform Foundation Complete

✅ Firebase local development environment operational

* Node 22
* Firebase Emulator Suite
* Vite build process
* App Check
* Firebase Auth
* Firestore connectivity

✅ User account system operational

* Signup
* Login
* Logout
* Profile page
* Profile editing
* Role architecture
* Custom claims architecture

✅ Shop operational

* Product loading
* Product detail pages
* Add to cart
* Cart drawer
* Quantity controls
* Pricing calculations
* GST calculations
* Shipping calculations

✅ Stripe checkout operational

* Checkout page
* Stripe session creation
* Stripe redirect
* Stripe customer create/reuse
* Customer details prefill
* Shipping address prefill

✅ Firebase Functions modernization complete

* Functions v2 migration
* Callable modernization
* Role normalization
* Payment validation
* Idempotency protection

---

# Current Blocker

## Priority 0 — Complete Stripe Purchase Pipeline

Current state:

✅ Checkout session created successfully

✅ Stripe test payment successful

✅ Redirect back to Recovery Tools successful

❌ confirmStripePurchase failing

❌ Order not created

❌ Cart not cleared

❌ Order history empty

Current error:

```text
401 Unauthorized
User must be logged in with a valid session
```

---

## Priority 0A — Standardize Stripe Live/Test Architecture

### Firebase Secret Manager

Verify:

```text
STRIPE_SECRET_KEY
STRIPE_SECRET_KEY_TEST
```

### Local Environment

Verify:

```env
VITE_STRIPE_PUBLISHABLE_KEY
VITE_STRIPE_PUBLISHABLE_KEY_TEST
```

### Backend Files To Update

Review and standardize:

```text
functions/affiliates/createStripeConnectLink.js
functions/affiliates/createStripeLoginLink.js
functions/orders/confirmStripePurchase.js
functions/orders/createCheckoutSession.js
functions/webhooks/handleStripeWebhook.js
```

Target:

```text
Local Emulator
→ STRIPE_SECRET_KEY_TEST

Production
→ STRIPE_SECRET_KEY
```

### Frontend Files To Update

Review:

```text
.env.example
src/utils/firebase-config.js
```

Target:

```text
Localhost
→ VITE_STRIPE_PUBLISHABLE_KEY_TEST

Production
→ VITE_STRIPE_PUBLISHABLE_KEY
```

---

## Priority 0B — Fix confirmStripePurchase

Verify:

### Stripe initialization

Uses correct test key locally.

### Authentication

Confirm user auth state exists before:

```text
confirmStripePurchase
```

is called.

Investigate:

```text
shop-orders.js
confirmStripePurchase.js
```

Target flow:

```text
Stripe Payment
→ Redirect
→ Firebase Auth Restored
→ confirmStripePurchase
→ Firestore Order Created
→ Cart Cleared
→ Order History Updated
```

---

## Priority 1 — Order System Verification

Once Stripe pipeline works verify:

```text
orders/{orderId}
users/{uid}/orders/{orderId}
```

Confirm storage of:

* Order Number
* User
* Products
* Totals
* Shipping Address
* Billing Address
* Stripe IDs
* Affiliate Data
* Referral Data

---

## Priority 1A — Finish V1 Core Operations

Complete these before narrowing the public site to the V1 shop launch:

* Finish checkout confirmation and order creation.
* Verify shipping address, billing address, order item, and fulfilment data writes.
* Verify admin order flow for packing, shipping, tracking number, and status updates.
* Finalise the customer profile: profile details, addresses, order history, update profile, and change password.
* Finalise the admin profile/admin access flow so admin users can manage the shop and orders without exposing unfinished areas to customers.

---

## Priority 1B — V1 Shop-Only Public Launch Scope

Goal:

```text
Launch Version 1 as a usable shop first.
Keep courses, workshops, Anato-me, and programs in development, but hidden from public users.
```

Public V1 navigation should show:

* Home
* Shop
* About
* Cart/checkout
* Profile
* Policy links

Hide from public navigation until ready:

* Courses
* Workshops
* Anato-me
* Programs

Implementation plan:

1. Add a central feature visibility config for public sections.
2. Hide disabled sections from desktop and mobile navigation.
3. Add route guards so direct visits to disabled routes redirect to `/shop` or a simple unavailable page.
4. Hide unfinished profile tabs from customers:
   * My Courses
   * My Workshops
   * My Programs
5. Keep admin/internal build paths available so these features can continue being developed.
6. Add an About page.
7. Add policy links that open the policy PDFs already included in the database.
8. Make public shop queries show only V1-ready products, such as active/visible shop products.
9. Keep courses, workshops, Anato-me, and programs in the database/codebase with draft/hidden visibility until they are ready to introduce.

Do not delete the existing course, workshop, Anato-me, or program code. Treat them as built-but-hidden features controlled by visibility flags.

---

## Current Website/Firebase Implementation Focus

Work on these next while the spreadsheet remains the prototype and initial seed source:

1. Extend the workbook import beyond product seeding into plans, blueprints, assets, prices, and access rows.
2. Update Firestore rules for the target collections.
3. Build admin update functions for products, prices, assets, orders, shipping, and users.
4. Build the user profile update flow that writes back to `users/{userId}`.
5. Build the Stripe webhook flow that writes `Orders`, `OrderItem`, `CustomerAddresses`, `StripeEvents`, and `User Access`.
6. Add an admin-only import validation screen or report before any live workbook upload.

---

## Priority 2 — Order Architecture

Design:

```text
paymentStatus
fulfillmentStatus
accessStatus
```

Implement:

* Pending
* Paid
* Packing
* Shipped
* Delivered
* Complete
* Refunded

---

## Priority 3 — Unlock Engine

Implement:

```text
Product
→ Plan
→ Blueprint
→ Item
→ Additional Plan
```

Create:

```text
userAccess
```

collection.

Implement:

```js
grantAccess(uid, sourceProductId)
```

---

## Priority 4 — Order Fulfillment

Admin workflow:

```text
Pending
Packing
Ready For Pickup
Shipped
Delivered
Completed
```

Add:

* Tracking numbers
* Click & Collect
* Australia Post integration (future)

---

## Priority 5 — Digital Delivery

Implement:

* Order confirmations
* Access emails
* Workshop emails
* Membership emails

---

## Priority 6 — Tax Invoices

Implement:

```js
generateOrderPDF()
```

Include:

* ABN
* GST
* Invoice Number
* Order Number

---

## Priority 7 — Review Automation

Physical:

```text
Delivered
→ Wait 7 days
→ Review email
```

Digital:

```text
Access granted
→ Wait 7–14 days
→ Review email
```

---

## Priority 8 — Returns

Implement:

```text
returns/{returnId}
```

Workflow:

```text
Request
Approve
Receive
Refund
```

---

## Priority 9 — Membership Engine

Reuse existing unlock architecture for:

* Memberships
* Exercise Library
* Recovery Plans
* Audio Library

---

## Known Issues

### Local Admin Login vs Product Seed Workflow

Current local testing has an awkward split:

* Real Firebase mode allows signup/login and admin claims, but checkout needs seeded/imported products.
* Emulator mode can use seeded products and seeded admin users, but requires `VITE_USE_FIREBASE_EMULATORS=true` and the Firebase emulators running.
* Confirm the preferred local workflow so admin login, product seed data, checkout, and order creation all target the same Firebase environment.

### Password Reset Email

Send reset link email is not working. Verify the callable/export path, reCAPTCHA verification, SendGrid template/content, and whether the frontend is calling the intended reset function.

### SendGrid Production Smoke Test

Local emulator tracking emails are sandboxed/skipped so fulfilment testing is not blocked by SendGrid account status.

Before deploy, run one real SendGrid smoke test:

* Confirm `SENDGRID_API_KEY` is set in Firebase Secret Manager.
* Confirm the sending address/domain, currently `hello@recoverytools.au`, is verified in SendGrid.
* Confirm the SendGrid plan/account is allowed to send after the trial period.
* Set `SENDGRID_SANDBOX_MODE=false` for the test environment if needed.
* Create a test order with your own email as the customer recipient.
* Mark the order as shipped with a tracking number from the admin Orders panel.
* Confirm the email arrives and check SendGrid Activity for accepted/delivered/bounced status.

Emulator/local sandbox confirms order and fulfilment data shape only; it does not prove real SendGrid delivery.

### Stripe Confirmation Failure

Payment succeeds.

Order confirmation fails.

Order not created.

Cart not cleared.

Primary investigation tomorrow.

### Guest Checkout Auth Flow

Checkout currently fails with `401 Unauthorized` if a customer adds items to cart while logged out and then enters checkout details.

Later fix:

* If checkout email matches an existing user, prompt login before creating the Stripe checkout session.
* If checkout email does not match a user, create a new Firebase Auth user/profile or offer account creation before payment.
* Preserve cart contents and entered checkout details through login/signup.
* Then continue to Stripe checkout once authenticated.

### Affiliate Collection Access

Review public vs private affiliate data.

### Admin Dashboard Layout

Navigation/content layout issue.

### Admin Packing And Shipping Workflow

Admin Orders now shows order items, assignment/last-updated details, fulfilment status, tracking number, tracking email status, and the admin badge for new unassigned orders. Admin Emails now shows confirmation/tracking/broadcast email logs.

Next improvements:

* Add a dedicated Claim order button so admins can assign themselves before changing status.
* Add Unassigned / Mine / Packing / Shipped / Complete filter tabs.
* Add a print packing slip button with items, recipient details, phone/email, and notes.
* Add copy buttons for address, tracking number, order ID, and customer email.
* Add a simple order timeline so every status change is visible, not just the latest update.
* Add an automated review request email approximately two weeks after an order is marked delivered.
* Add a returns/complaints workflow so admins can record return requests, complaint notes, resolution status, and customer follow-up.

### Profile Role Display

Role rendering inconsistency.

### Profile Address Display

Full address rendering incomplete.

### Shop Filters

Still required.

Refine visible filter tags at top of shop:

```text
Featured
Pain
Mobility
Stability
```

### Course Detail Page

Courses currently display in the Courses section, but clicking a course opens the shared shop product detail page.

Build a dedicated course detail page with:

* More detailed course information than physical product pages
* Course-specific layout and copy sections
* Add to cart / buy flow that preserves referral tracking
* Access course button for users who already have `userAccess`
* Correct handling of affiliate commission values from the new imported product/order structure

### Placeholder Assets

Replace temporary images.

---

## Later Spreadsheet Cleanup

Do these after the website/Firebase work is underway:

1. Fill `ProductPrice.stripeProductId` and `ProductPrice.stripePriceId` once Stripe products/prices exist.
2. Decide whether blank `ProductPrice` formula rows should stay; import currently only uses active rows with `ItemProductID`.
3. Add status values consistently; import currently normalizes common casing such as `ACTIVE`/`Active`.
4. Add seed rows for your own admin user in `Users` and `Admin`.
5. Fill `Reference Status` consistently for Items and Blueprints.
6. Add `Features` fields if the product detail bullet list should be populated from the workbook.

---

## Next Session

### Startup

```bash
npm run build
npm run emulators
npm run dev
```

### First Task

Review and update:

```text
functions/affiliates/createStripeConnectLink.js
functions/affiliates/createStripeLoginLink.js
functions/orders/confirmStripePurchase.js
functions/orders/createCheckoutSession.js
functions/webhooks/handleStripeWebhook.js

src/utils/firebase-config.js
.env.example
```

### Then

Run complete Stripe test purchase.

Verify:

```text
Order Created
Order History Updated
Cart Cleared
```

### End Of Session

```bash
git status
git add .
git commit -m "Standardize Stripe test/live architecture"
git push
```
