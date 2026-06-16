# Recovery Tools — Next Steps

## Current Status

### Core Platform

✅ Firebase CLI login fixed
✅ Local dev runs on Node 22
✅ Firebase emulators run
✅ npm run build passes
✅ Signup creates Auth emulator user
✅ Login works after signup
✅ Logout redirects home
✅ Signup/login redirects to /profile
✅ Profile page renders after login
✅ Profile header name/email displays
✅ My Profile tab displays account details

✅ Update Profile saves:

* Name
* Phone
* Shipping address
* Billing address
* Email preferences

✅ Firestore rules allow users to update their own safe profile fields

---

### Shop

✅ Products load from Firestore emulator
✅ Product detail page works
✅ Add to Cart works
✅ Quantity selector works
✅ Cart drawer works
✅ Review crash fixed
✅ Placeholder product image fallback updated
✅ Shop tools visible again
✅ Shop page mostly works

---

### Checkout & Stripe

✅ Cart checkout button navigates to /checkout
✅ Checkout section displays instead of blank page
✅ Duplicate checkoutBtn ID fixed
✅ Checkout callable auth v2 pattern fixed
✅ Stripe checkout session creates successfully
✅ Stripe unit_amount fixed from dollars to cents
✅ Stripe Connect application fee calculation fixed to cents
✅ Stripe session now returns session.url
✅ Frontend redirects using session.url
✅ Stripe back/cancel button works locally

✅ Stripe Customer create/reuse added
✅ users/{uid}.stripeCustomerId saves to Firestore
✅ Existing Stripe Customer reused on future checkouts

✅ Stripe Checkout now prefills:

* Name
* Email
* Shipping Address

✅ Checkout "Save as default shipping address" checkbox added

✅ Product/cart/checkout price mismatch fixed
✅ Shipping standardized to $10
✅ GST calculation confirmed correct

---

### Roles & Permissions

✅ Standardized role architecture

All users now use:

```js
roles: {
  admin: false,
  affiliate: false,
  therapist: false
}
```

✅ Updated:

* seedUserRoles.js
* auth-logic.js
* setUserRoles.js
* registerAffiliate.js
* setAdminClaim.cjs
* authHelpers.js

✅ Custom claims now normalized

All custom claims now contain:

* admin
* affiliate
* therapist

No missing-role claim structures remain.

---

### Functions Modernization

✅ Migrated callable functions from:

```js
(data, context)
```

to:

```js
(request)
```

for Firebase Functions v2

✅ Updated:

* Affiliates
* Orders
* Courses
* Workshops
* Anato-Me
* Reviews
* Password Reset
* Transactional Emails
* Contact Form
* Welcome Emails
* Workshop Emails
* Affiliate Emails
* Referral Functions

✅ Added idempotency protection to confirmStripePurchase

✅ Added payment status verification

✅ Added order ownership checks for PDF generation

---

## Current Priorities

### Priority 0 — Verify Purchase Pipeline

Complete end-to-end purchase test.

Confirm:

Product
→ Stripe Checkout
→ confirmStripePurchase
→ Firestore Order Creation

Verify:

* Stripe payment succeeds
* confirmStripePurchase executes
* No function errors
* No Firestore write errors

---

### Priority 1 — Order Creation Verification

Confirm successful payment creates:

```text
orders/{orderId}
```

and

```text
users/{uid}/orders/{orderId}
```

Verify:

* Customer order history
* Admin order history
* Order totals
* Shipping details
* Billing details
* Stripe IDs
* Product list

---

### Priority 1A — Order Lifecycle Verification

Verify what is currently stored when Stripe payment succeeds.

Confirm orders contain:

* Order Number
* User ID
* Customer Name
* Customer Email
* Shipping Address
* Billing Address
* Stripe Session ID
* Stripe Payment Intent ID
* Stripe Customer ID
* Affiliate ID
* Referral ID
* Product List
* Order Totals
* Payment Status

Determine whether current order documents already support:

* Fulfillment Status
* Tracking Number
* Pickup Orders
* Access Status

---

### Priority 1B — Order Status Architecture

Separate order tracking into:

```text
paymentStatus
fulfillmentStatus
accessStatus
```

#### paymentStatus

```text
pending
paid
failed
refunded
partially_refunded
```

#### fulfillmentStatus

```text
not_required
pending
packing
ready_for_pickup
picked_up
shipped
delivered
completed
return_requested
returned
cancelled
```

#### accessStatus

```text
not_required
pending
granted
revoked
```

---

### Priority 1C — Shipping vs Digital Fulfillment Logic

Verify product structure supports:

* Requires Shipping
* Unlocks Access
* Access Type
* Workshop
* Digital Product
* Physical Product

Target behaviour:

#### Physical Product

Collect shipping.

#### Digital Product

No shipping required.

#### Workshop

No shipping required.

#### Physical Product + Course

Collect shipping and unlock content.

---

### Priority 1D — Click & Collect Design

Checkout options:

```text
Ship To Me
Pick Up From Affiliate
```

Investigate:

* Affiliate pickup location structure
* Pickup notifications
* Shipping cost removal
* Pickup status updates

---

### Priority 2 — Unlock Engine

Design unified access system.

Target flow:

```text
Product
→ Plan

Plan
→ Blueprints

Blueprints
→ Items

Items
→ Additional Plans
```

Create:

```text
userAccess
```

collection and:

```js
grantAccess(uid, sourceProductId)
```

helper function.

---

### Priority 2A — Post Purchase Access Automation

Target flow:

```text
Payment Success
→ Create Order
→ Grant Access
→ Send Confirmation Email
→ Send Access Email
```

Verify confirmStripePurchase can support automatic unlocks.

---

### Priority 2B — Mixed Product Unlocks

Support:

```text
Physical Product + Attached Course
Physical Product + Attached Exercise Plan
Workshop + Bonus Course
Membership + Content Library
```

Verify unlock inheritance works regardless of product type.

---

### Priority 3 — Profile Address Structure

Current profile uses:

```text
address
billingAddress
```

and

```text
defaultShippingAddress
defaultBillingAddress
```

Need a single structure.

Profile page should:

* Display full address
* Edit full address
* Prefill checkout

---

### Priority 4 — Order Fulfillment System

Build admin fulfillment workflow.

Admin actions:

```text
Mark Packing
Mark Ready For Pickup
Mark Shipped
Mark Delivered
Mark Complete
```

Store:

```text
packedAt
shippedAt
deliveredAt
completedAt
```

Create Admin Orders dashboard filters:

* New Orders
* Packing
* Pickup
* Shipped
* Completed
* Returns

---

### Priority 5 — Tracking Integration

Store:

```text
trackingCarrier
trackingNumber
trackingUrl
```

Version 1:

Manual tracking entry.

Version 2:

Australia Post integration.

---

### Priority 6 — Digital Delivery Emails

Design:

#### Order Confirmation

Immediately after payment.

#### Access Granted

Immediately after unlock.

#### Workshop Confirmation

Workshop purchases.

#### Membership Welcome

Membership purchases.

---

### Priority 7 — Tax Invoice System

Verify current Stripe behaviour.

Determine:

* Stripe receipt only
* Stripe invoice
* Recovery Tools PDF invoice

Potential function:

```js
generateOrderPDF()
```

Requirements:

* ABN
* GST
* Invoice Number
* Order Number
* Customer Details

---

### Priority 8 — Review Automation

#### Physical Products

```text
Delivered
→ Wait 7 Days
→ Review Email
```

#### Digital Products

```text
Access Granted
→ Wait 7–14 Days
→ Review Email
```

Investigate:

* Firebase Scheduled Functions
* Cloud Tasks

---

### Priority 9 — Returns & Refunds

Create:

```text
returns/{returnId}
```

Statuses:

```text
requested
approved
rejected
received
refunded
```

Customer flow:

```text
Order History
→ Request Return
```

Admin flow:

```text
Approve
Reject
Refund
```

Verify Stripe refund integration.


### Priority 10 — Membership Engine
access architecture you've designed for Products → Plans → Blueprints → Items → Additional Plans will also be the foundation for memberships later, so you'll avoid redesigning the unlock system twice.
---

## Known Issues

### Affiliate Collection Access

Affiliate dropdown attempts to load:

```text
affiliates/{uid}
```

Current rules prevent non-affiliate users from reading affiliate records.

Need to:

* Review security
* Separate public affiliate directory if required
* Ensure cart referral selector loads safely

---

### Admin Dashboard Layout

Admin content renders below navigation instead of beside navigation.

Same issue in Affiliate Dashboard.

Investigate:

* index.html
* admin-dashboard.js
* affiliate-dashboard.js

---

### Profile Role Display

Admin users currently display:

```text
Role: user
```

or

```text
Role: multi
```

Need to investigate:

* getUserRoleWithPermissions
* profile-init.js
* role rendering logic

---

### Profile Address Display

Structured addresses save correctly.

UI still only shows partial address information.

Need support for:

* line1
* line2
* city
* state
* postcode
* country

---

### Billing Address Save Logic

Need decision:

* Save shipping only
* Save shipping + billing

when checkbox selected.

---

### Stripe Phone Prefill

Phone saves to Stripe Customer.

Still not visibly prefilling in Stripe Checkout.

---

### Checkout Fulfillment Logic

Need confirmation checkout correctly handles:

* Physical Products
* Digital Products
* Workshops
* Memberships
* Mixed Orders

---

### Order Number Generation

Need verification every completed purchase receives:

```text
RT-YYYY-XXXXXX
```

or similar unique order number.

---

### Order Confirmation Emails

Need verification purchase currently sends:

* Customer confirmation email
* Admin notification email

---

### SendGrid Emulator Testing

Welcome email currently returns:

```text
Unauthorized
```

Verify:

```text
SENDGRID_API_KEY
```

inside emulator environment.

---

### Shop Filters

Still required:

* Featured
* Back Pain
* Mobility
* Show All
* Sort Dropdown

---

### Vite Warnings

Dynamic import warnings remain.

Build passes.

---

### Placeholder Images

Replace temporary placeholder images with Recovery Tools assets.

---

## Next Session

### Start Up

```bash
npm run build
npm run emulators
npm run dev
```

---

### Main Goal

1. Re-seed users
2. Sign in again
3. Test cart
4. Complete Stripe test purchase
5. Confirm confirmStripePurchase executes
6. Verify orders/{orderId}
7. Verify users/{uid}/orders/{orderId}
8. Verify Order History page
9. Verify Admin Orders page
10. Verify order fields stored
11. Verify Stripe Customer reuse
12. Verify shipping data persistence

---

### After That

1. Build final order schema
2. Implement fulfillment statuses
3. Design userAccess collection
4. Implement grantAccess()
5. Implement Product → Plan unlock flow
6. Implement unlock inheritance system

---

## End Of Session

```bash
git status

git add .

git commit -m "Verify purchase pipeline and begin order architecture"

git push
```
