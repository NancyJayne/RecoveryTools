Recovery Tools — Next Steps
Current status

✅ Firebase CLI login fixed
✅ Local dev runs on Node 22
✅ Firebase emulators run
✅ npm run build passes
✅ Products load from Firestore emulator
✅ Product detail page works
✅ Add to Cart works
✅ Quantity selector works
✅ Cart drawer works
✅ Review crash fixed
✅ Placeholder product image fallback updated
✅ Shop page mostly works
✅ Signup creates Auth emulator user
✅ Login works after signup
✅ Logout redirects home
✅ Signup/login redirects to /profile
✅ Profile page renders after login
✅ Profile header name/email displays
✅ My Profile tab displays account details
✅ Update Profile saves name, phone, shipping address, billing address, and email preferences
✅ Firestore rules allow users to update their own safe profile fields
✅ Welcome email callable v2 payload issue fixed
✅ Cart checkout button navigates to /checkout
✅ Checkout section displays instead of blank page
✅ Duplicate checkoutBtn ID fixed by changing cart drawer button to cartCheckoutBtn
✅ Checkout callable auth v2 pattern fixed
✅ Stripe checkout session creates successfully
✅ Stripe unit_amount fixed from dollars to cents
✅ Stripe Connect application fee calculation fixed to cents
✅ Stripe session now returns session.url
✅ Frontend redirects using session.url
✅ Stripe back/cancel button works locally
✅ Stripe Customer create/reuse added
✅ users/{uid}.stripeCustomerId saves to Firestore
✅ Stripe Checkout now prefills name, email and shipping address
✅ Checkout “Save this as my default shipping address” checkbox added
✅ Checkout sends saveAsDefaultShipping to backend
✅ Product/cart/checkout price unit mismatch fixed
✅ Product prices now treated as dollars in Firestore/frontend
✅ Stripe amounts converted to cents only in backend
✅ Cart, checkout and Stripe totals now match
✅ Shipping standardized to $10
✅ GST display confirmed correct for GST-inclusive pricing using total / 11

Fixed today
Cleared stale cart/localStorage issue.
Confirmed checkout opens Stripe successfully.
Fixed Stripe cancel/back URL for local emulator testing.
Added/reused Stripe Customer logic in createCheckoutSession.js.
Stores Stripe Customer ID on:
users/{uid}.stripeCustomerId
Uses existing Stripe Customer on future checkouts.
Updated Stripe customer with:
email
name
phone
shipping.name
shipping.phone
shipping.address
metadata.firebaseUID
Replaced customer_email with:
customer: stripeCustomerId
Added checkout checkbox:
Save this as my default shipping address
Frontend now sends:
saveAsDefaultShipping
Removed automatic frontend checkout profile save.
Added conditional backend profile save only when saveAsDefaultShipping === true.
Fixed product price display by removing incorrect / 100 from:
shop-cart.js
shop-checkout.js
shop-products.js
Fixed product schema price so it uses dollar values.
Updated shipping settings seed rate to $10.
Confirmed:
shop prices correct
cart prices correct
checkout totals correct
Stripe product total correct
Stripe shipping correct
GST correct for GST-inclusive pricing
Current issue
1. Default shipping profile save is incomplete

When the user ticks:

Save this as my default shipping address

the backend currently saves:

address: customerInfo.shippingAddress_line1
defaultShippingAddress: shippingAddress
checkoutProfile: customerInfo

Phone saves correctly into the user profile.

However, the visible profile fields only show address line 1. Address line 2, city, state and postcode are not showing in the profile UI yet.

Need to confirm whether the profile page reads from:

users/{uid}.address
users/{uid}.billingAddress

or from:

users/{uid}.defaultShippingAddress
users/{uid}.checkoutProfile

Likely fix: update profile display/prefill logic to support structured address objects.

2. Billing address does not update from checkout

Checkout collects billing address, but profile billing address is not updating when default checkbox is selected.

Need to decide whether checkbox should save:

defaultShippingAddress

only, or both:

defaultShippingAddress
defaultBillingAddress

Recommended next fix:

Save shipping default and billing default separately if billing is present.
3. Phone does not prefill into Stripe Checkout

Phone is saving/logging in the user profile, but it still does not prefill visually into Stripe Checkout.

Backend currently sets:

customer.phone
customer.shipping.phone
phone_number_collection.enabled = true

Need to check whether Stripe Checkout requires customer confirmation/entry when phone collection is enabled.

This is not blocking checkout.

Known issues to fix next
1. Profile address structure mismatch

Current user profile likely expects simple strings:

address
billingAddress

but checkout now saves structured data:

defaultShippingAddress: {
  line1,
  line2,
  city,
  state,
  postal_code,
  country
}

Need to update profile display and update form to support full structured addresses.

2. Confirm completed order creation

Every paid checkout should save order data to:

orders/{orderId}

This should happen in:

confirmStripePurchase

not in createCheckoutSession.

Need to confirm order record includes:

buyerUid
stripeCustomerId
stripeSessionId
paymentIntentId
products
subtotal
shipping
total
shippingName
shippingPhone
shippingAddress
billingAddress
saveAsDefaultShipping
status
createdAt
3. Checkout success confirmation

Confirm /checkout?success=true calls:

confirmStripePurchase

and creates a usable customer/admin order record.

4. SendGrid welcome email

SendGrid is reached but returns:

ResponseError: Unauthorized

Likely:

SENDGRID_API_KEY

is incorrect or missing in emulator configuration.

5. Shop filter buttons still need fixing
Featured
Back Pain
Mobility
Show All
Sort dropdown
6. Vite warnings remain

Dynamic import warnings still appear during development.

Build currently passes.

7. ESLint warning remains
src/shop/shop-products.js

'showSection' is defined but never used
8. Placeholder image

Replace temporary placeholder image with proper Recovery Tools asset.

Signup/Profile decision

Keep signup simple for now.

Use one name field at signup:

name: name

Later allow users to add/edit:

First name
Last name
Phone
Full shipping address
Full billing address
Profile image

Do not split first/last name unless required for:

SendGrid
Stripe
Shipping labels
Checkout/Profile decision

Use this rule:

Checkout address = address for this order
Default profile address = only updates when checkbox is ticked
Order history = every completed paid checkout

Do not automatically overwrite user profile address from every checkout.

For affiliates:

Stripe Customer = the buyer/payer
Shipping address = the recipient for this order

Future affiliate feature:

users/{affiliateUid}/shippingRecipients/{recipientId}

for saved customer/recipient addresses.

Next session start

Run:

npm run build

Then start emulators:

npm run emulators

Then in another terminal:

npm run dev

Optional browser console clear if cart looks stale:

localStorage.removeItem("recovery_cart");
localStorage.removeItem("cart");
sessionStorage.removeItem("cartBackup");
Main goal for next session
Check profile page read/write logic for address fields.
Update profile UI to display full structured shipping address.
Update profile UI to display full structured billing address.
Confirm default checkbox saves full address data correctly.
Confirm confirmStripePurchase creates complete order records.
Confirm order history shows shipping/billing details.
Revisit Stripe phone prefill only after order/profile save is stable.
End of session

Commit and push:

git status
git add .
git commit -m "Add Stripe customer reuse and fix checkout pricing"
git push

Then stop all running processes:

Ctrl + C

Do this in both:

Emulator terminal
Vite dev terminal