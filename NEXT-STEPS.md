# Recovery Tools — Next Steps

## Latest Session Handoff

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

## Current Website/Firebase Implementation Focus

Work on these next while the spreadsheet remains the prototype and initial seed source:

1. Create a mapping document from spreadsheet columns to Firestore fields.
2. Write a seed/import script that reads the workbook and writes Firestore docs.
3. Update Firestore rules for the target collections.
4. Build admin update functions for products, prices, assets, orders, shipping, and users.
5. Build the user profile update flow that writes back to `users/{userId}`.
6. Build the Stripe webhook flow that writes `Orders`, `OrderItem`, `CustomerAddresses`, `StripeEvents`, and `User Access`.

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

1. Add real product assets with `FileURL` values.
2. Fill the missing `ItemProduct` course/product descriptions.
3. Fill `ProductPrice.stripeProductId` and `ProductPrice.stripePriceId` once Stripe products/prices exist.
4. Decide whether blank `ProductPrice` formula rows should stay; import should only read rows with `ItemProductID`.
5. Add status values consistently; `ACTIVE`/`Active` should be normalized by import.
6. Add seed rows for your own admin user in `Users` and `Admin`.

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
