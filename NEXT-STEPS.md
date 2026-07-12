# Recovery Tools - Next Steps

## Current Handoff

Last confirmed state:

* Workbook-backed product seeding works from `Recovery Tools Master Database.xlsx`.
* Shop products load from imported Firestore product data.
* Stripe test checkout completes locally.
* `confirmStripePurchase` creates orders after Stripe redirect.
* Customer profile order history shows created orders.
* Admin Orders shows order items, customer details, order totals, fulfilment status, tracking fields, assignment, and last-updated admin.
* Admin can move orders through packing/shipping statuses.
* Tracking email attempts are logged as sent, sandboxed, or failed.
* Admin Emails shows order confirmation, tracking, and broadcast email logs.
* Admin profile badge shows new unassigned physical orders and is hidden from non-admin users.
* Stripe secret selection is standardized for local/test vs production/live.
* Password reset now uses the email-sending callable and logs reset email attempts.

Latest useful commits:

```text
95b09ebe Next Steps update
5e26666c Improve admin fulfilment and email logging
7e490f38 Import recovery products from workbook
74c125d2 Add fulfilment tracking and checkout contact validation
```

## Completed Today

### Stripe Test/Live Architecture

Updated:

```text
functions/affiliates/createStripeConnectLink.js
functions/affiliates/createStripeLoginLink.js
functions/orders/confirmStripePurchase.js
functions/orders/createCheckoutSession.js
functions/webhooks/handleStripeWebhook.js
src/utils/firebase-config.js
.env.example
functions/utils/stripeEnvironment.js
```

Current behaviour:

```text
Local emulator / localhost -> Stripe test keys
Production -> Stripe live keys
```

Required secret/env names:

```text
STRIPE_SECRET_KEY
STRIPE_SECRET_KEY_TEST
STRIPE_WEBHOOK_SECRET
STRIPE_WEBHOOK_SECRET_TEST
VITE_STRIPE_PUBLISHABLE_KEY
VITE_STRIPE_PUBLISHABLE_KEY_TEST
```

### Password Reset

Updated:

```text
src/auth/reset-password.js
functions/emails/sendPasswordReset.js
```

Current behaviour:

```text
Customer reset form calls sendPasswordReset.
Live reset emails use SendGrid template d-96f4ed75c9ed4114a4ff41cb0516e22b.
Local emulator reset emails are sandboxed/skipped and logged.
Reset email attempts are written to emailLogs.
Admin users can still receive the generated reset link in the callable response.
```

## Start Here Next

### Run One Full Local V1 Test

Use emulator mode and seeded products.

Verify:

```text
Login as customer
Add physical product to cart
Create Stripe checkout session
Complete Stripe test payment
Return to checkout success page
Order created in Firestore
Customer profile shows order
Admin badge appears for unassigned new order
Admin Orders shows purchased item details
Admin changes order to packing
Admin marks order shipped with tracking
Tracking email logs as sandboxed/sent
Admin Emails shows confirmation and tracking logs
Cart clears
```

## V1 Launch Blockers

Do these before any public launch:

1. Run a full local V1 checkout/reset/admin fulfilment test after restarting emulators.
2. Decide V1 checkout auth rule.
3. Run a real SendGrid production smoke test.
4. Run one complete production-style Stripe test purchase.
5. Confirm public navigation hides unfinished features.
6. Polish V1 product content, product images, shipping text, returns text, and policy links.

## V1 Checkout Auth Decision

Recommended V1 approach:

```text
Require customers to log in before checkout.
```

Reason:

* Current order confirmation and profile order history depend on Firebase Auth.
* Guest checkout needs more account-linking work.
* A clear login-before-checkout rule is safer for V1.

Later guest checkout plan:

* If checkout email matches an existing user, prompt login before creating the Stripe checkout session.
* If checkout email does not match a user, create a Firebase Auth user/profile or offer account creation before payment.
* Preserve cart contents and entered checkout details through login/signup.
* Continue to Stripe checkout once authenticated.

## SendGrid Production Smoke Test

Local emulator email sends are sandboxed/skipped so fulfilment testing is not blocked by SendGrid account status.

Before deploy:

* Confirm `SENDGRID_API_KEY` is set in Firebase Secret Manager.
* Confirm `hello@recoverytools.au` or the sending domain is verified in SendGrid.
* Confirm the SendGrid plan/account can send after the trial period.
* Set `SENDGRID_SANDBOX_MODE=false` for the test environment if needed.
* Create a test order with your own email as the customer recipient.
* Confirm the order confirmation email arrives.
* Mark the order as shipped with a tracking number.
* Confirm the tracking email arrives.
* Check SendGrid Activity for accepted, delivered, bounced, or blocked status.

Emulator/local sandbox confirms the app flow and data shape only. It does not prove real SendGrid delivery.

## V1 Public Scope

Launch as a shop-first webapp.

Public navigation for V1:

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
3. Add route guards so direct visits to disabled routes redirect to `/shop` or an unavailable page.
4. Hide unfinished profile tabs from customers.
5. Keep admin/internal build paths available for continued development.
6. Add or polish the About page.
7. Add policy links that open the policy PDFs already included in the database.
8. Make public shop queries show only V1-ready products.

Do not delete course, workshop, Anato-me, or program code. Treat them as built-but-hidden features controlled by visibility flags.

## Admin Packing And Shipping Workflow

Current:

* Admin Orders shows order items.
* Admin Orders shows assigned admin and last-updated admin.
* Admin Orders supports fulfilment status updates.
* Admin Orders supports tracking number and carrier.
* Admin tracking email status shows sent, sandboxed locally, failed, or not sent.
* Admin badge shows new unassigned physical orders.
* Admin Emails shows confirmation, tracking, and broadcast email logs.

Next improvements:

* Add a dedicated Claim order button so admins can assign themselves before changing status.
* Add Unassigned / Mine / Packing / Shipped / Complete filter tabs.
* Add a print packing slip button with items, recipient details, phone/email, and notes.
* Add copy buttons for address, tracking number, order ID, and customer email.
* Add a simple order timeline so every status change is visible, not just the latest update.
* Add an automated review request email approximately two weeks after an order is marked delivered.
* Add a returns/complaints workflow so admins can record return requests, complaint notes, resolution status, and customer follow-up.

## Workbook Product Import

Current:

* `functions/scripts/seedRecoveryProducts.js` reads `Recovery Tools Master Database.xlsx`.
* Product seed data joins `ItemProduct`, `Items`, `ProductPrice`, `Inventory`, `ItemAsset`, and `Asset`.
* `ItemProductID` is the Firestore `products/{productId}` document ID.
* Active `ProductPrice` rows provide price, retail price, sale fields, and Stripe ID placeholders.
* Inventory rows are summed into `stock`.
* Product images resolve through `ItemAsset -> Asset.FileURL`.
* `references` and `referenceStatus` are carried through from `Items`.
* `--dry-run` validates generated product documents without writing to Firestore.

Useful commands:

```powershell
cd "C:\Users\hello\Firebase project\functions"
node scripts/seedRecoveryProducts.js --dry-run --workbook "C:\Users\hello\Downloads\Recovery Tools Master Database.xlsx"
node scripts/seedRecoveryProducts.js --workbook "C:\Users\hello\Downloads\Recovery Tools Master Database.xlsx"
```

Remaining spreadsheet checks before live upload:

* Keep `ProductPrice.Status` set to `Active` for the price row to import.
* Keep `ItemProduct.ItemProductID` stable; changing it creates a new Firestore product document.
* Replace placeholder/fallback image behavior after every product has a production `Asset.FileURL`.
* Standardize `Reference Status` values: `Not required`, `Needs source`, `Draft source`, `Verified`.
* Fill `ProductPrice.stripeProductId` and `ProductPrice.stripePriceId` once Stripe products/prices exist.
* Add seed rows for your own admin user in `Users` and `Admin` if workbook-backed user seeding is kept.

## Remaining Known Issues

### Local Admin Login vs Product Seed Workflow

Confirm the preferred local workflow so admin login, product seed data, checkout, and order creation all target the same Firebase environment.

Current working approach:

```text
VITE_USE_FIREBASE_EMULATORS=true
Firebase emulators running
Seeded products
Seeded admin user/custom claims
```

### Affiliate Collection Access

Review public vs private affiliate data and fix any Firestore rule warnings.

### Profile Role Display

Role rendering inconsistency.

### Profile Address Display

Full address rendering incomplete.

### Shop Filters

Refine visible filter tags at top of shop:

```text
Featured
Pain
Mobility
Stability
```

### Course Detail Page

Courses currently display in the Courses section, but clicking a course opens the shared shop product detail page.

Build a dedicated course detail page later with:

* Course-specific layout and copy sections.
* Add to cart / buy flow that preserves referral tracking.
* Access course button for users who already have `userAccess`.
* Correct handling of affiliate commission values from the imported product/order structure.

### Placeholder Assets

Replace temporary product and page images.

## Later Architecture Backlog

Order status model:

```text
paymentStatus
fulfilmentStatus
accessStatus
```

Future order states:

```text
Pending
Paid
Packing
Packed
Shipped
Delivered
Completed
Refunded
Cancelled
```

Future collections/workflows:

* `userAccess` unlock engine for digital products.
* Stripe webhook writer for final production order reconciliation.
* Tax invoice PDF generation with ABN, GST, invoice number, and order number.
* Review automation after delivery/access.
* Returns workflow in `returns/{returnId}`.
* Membership engine for memberships, exercise library, recovery plans, and audio library.

## End Of Session Checklist

```powershell
npm run build
git status
git add <changed files>
git commit -m "<clear scoped message>"
```
