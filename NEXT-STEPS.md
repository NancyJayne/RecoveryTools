# Recovery Tools — Next Steps

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

### Stripe Confirmation Failure

Payment succeeds.

Order confirmation fails.

Order not created.

Cart not cleared.

Primary investigation tomorrow.

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

### Placeholder Assets

Replace temporary images.

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
