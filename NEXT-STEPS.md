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

roles: {
admin: false,
affiliate: false,
therapist: false
}

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

(data, context)

to:

(request)

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

## Current Priority

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

orders/{orderId}

and

users/{uid}/orders/{orderId}

Verify:

* Customer order history
* Admin order history
* Order totals
* Shipping details
* Billing details
* Stripe IDs
* Product list

---

### Priority 2 — Unlock Engine

Design unified access system.

Target flow:

Product
→ Plan

Plan
→ Blueprints

Blueprints
→ Items

Items
→ Additional Plans

Purchases should unlock content automatically through inheritance.

Create:

userAccess collection

and

grantAccess(uid, sourceProductId)

helper function.

---

### Priority 3 — Profile Address Structure

Current profile uses a mix of:

address
billingAddress

and

defaultShippingAddress
defaultBillingAddress

Need a single structure.

Profile page should:

* Display full address
* Edit full address
* Prefill checkout

---

## Known Issues

### Affiliate Collection Access

Affiliate dropdown attempts to load:

affiliates/{uid}

Current Firestore rules prevent non-affiliate users from reading affiliate records.

Need to:

* Review affiliate collection security
* Separate public affiliate directory from private affiliate data if required
* Ensure cart referral selector can load safely

---

### Admin Dashboard Layout

Admin content renders below navigation instead of beside navigation.

Same issue appears in Affiliate Dashboard.

Investigate:

* index.html
* admin-dashboard.js
* affiliate-dashboard.js

Not blocking functionality.

---

### Profile Role Display

Admin users currently display:

Role: user

or

Role: multi

even though:

roles.admin = true

and custom claims are correct.

Investigate:

* getUserRoleWithPermissions
* profile-init.js
* role rendering logic

Not blocking functionality.

---

### Profile Address Display

Structured addresses save correctly.

Profile UI still only shows partial address information.

Need to support:

* line1
* line2
* city
* state
* postcode
* country

---

### Billing Address Save Logic

Need decision:

Save default shipping only

OR

Save shipping + billing defaults

when checkbox is selected.

---

### Stripe Phone Prefill

Phone saves to Stripe Customer.

Phone still not visibly prefilling in Stripe Checkout.

Not blocking checkout.

---

### SendGrid Emulator Testing

Welcome email currently returns:

Unauthorized

Need to verify:

SENDGRID_API_KEY

inside local emulator environment.

Production deployment may already be correct.

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

npm run build

npm run emulators

npm run dev

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

---

### After That

1. Design userAccess collection
2. Implement grantAccess()
3. Implement Product → Plan unlock flow
4. Build unlock inheritance system

---

## End Of Session

git status

git add .

git commit -m "Standardize roles architecture and normalize custom claims"

git push
