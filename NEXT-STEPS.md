# Recovery Tools — Next Steps

## Current status

✅ Firebase CLI login fixed
✅ Local dev runs on Node 22
✅ Firebase emulators run
✅ `npm run build` passes
✅ Products load from Firestore emulator
✅ Product detail page works
✅ Add to Cart works
✅ Quantity selector works
✅ Cart drawer works
✅ Review crash fixed
✅ Placeholder product image fallback updated
✅ Shop page mostly works
✅ `getShippingTaxSettings` CORS/500 error fixed
✅ Signup creates Auth emulator user
✅ Login works after signup
✅ Logout redirects home
✅ Signup/login redirects to `/profile`
✅ Profile page renders after login
✅ Profile header name/email displays
✅ My Profile tab displays account details
✅ Update Profile saves name, phone, shipping address, billing address, and email preferences
✅ Firestore rules allow users to update their own safe profile fields
✅ Welcome email callable v2 payload issue fixed
✅ Cart checkout button navigates to `/checkout`
✅ Checkout section displays instead of blank page
✅ Duplicate `checkoutBtn` ID issue fixed by changing cart drawer button to `cartCheckoutBtn`

---

## Fixed today

* Fixed stale profile/auth rendering after login.

* Added `waitForAuth()` to profile loading.

* Made profile section visible after route load.

* Populated:

  * `data-profile-name`
  * `data-profile-email`
  * phone
  * role
  * shipping
  * billing
  * email preferences

* Added extra Update Profile fields:

  * billing address
  * email preferences

* Updated `updateUserProfile()` to save:

  * `name`
  * `phone`
  * `address`
  * `billingAddress`
  * `emailPreferences`

* Added Firestore `users/{userId}` rule for safe self-updates.

* Fixed logout so it redirects home.

* Fixed signup/login so user does not remain stuck on the logged-out profile page.

* Updated `sendWelcomeEmail` from old callable payload handling to v2 callable request handling:

  ```js
  async (request) => {
    const { to, firstName } = request.data || {};
  }
  ```

* Fixed cart drawer checkout button not navigating.

* Renamed cart drawer checkout button from:

  ```html
  id="checkoutBtn"
  ```

  to:

  ```html
  id="cartCheckoutBtn"
  ```

* Kept checkout page confirm button as:

  ```html
  id="checkoutBtn"
  ```

* Made checkout section visible on `/checkout` by removing `hidden` inside `setupCheckoutPage()`.

* Fixed frontend checkout shipping display from `$1000` to `$10` by treating display values as dollars, not cents.

---

## Known issues to fix next

### 1. Stripe checkout session currently fails

```text
FirebaseError: User must be logged in.
```

This is likely in:

```text
functions/orders/createCheckoutSession.js
```

Expected issue: old callable function pattern:

```js
async (data, context) => {
  const uid = context.auth?.uid;
}
```

Should become v2 callable pattern:

```js
async (request) => {
  const uid = request.auth?.uid;
  const data = request.data || {};
}
```

### 2. Inspect checkout function

```powershell
Get-Content functions\orders\createCheckoutSession.js
```

### 3. Checkout fields need final confirmation

* Name should prefill from:

  ```text
  users/{uid}.name
  ```

* Email should prefill from:

  ```text
  users/{uid}.email
  ```

  or:

  ```js
  auth.currentUser.email
  ```

* Phone should prefill from:

  ```text
  users/{uid}.phone
  ```

* Shipping should prefill from saved profile/checkout profile.

* Checkout input should save back to:

  ```text
  users/{uid}.checkoutProfile
  ```

### 4. SendGrid welcome email

SendGrid is now being reached but returns:

```text
ResponseError: Unauthorized
```

Likely:

```text
SENDGRID_API_KEY
```

is incorrect/missing in emulator configuration.

Signup flow itself appears fixed.

### 5. Shop filter buttons still need fixing

* Featured
* Back Pain
* Mobility
* Show All
* Sort dropdown

### 6. Vite warnings remain

Dynamic import warnings still appear during development.

Build currently passes.

### 7. ESLint warning remains

```text
src/shop/shop-products.js

'showSection' is defined but never used
```

### 8. Placeholder image

Replace temporary placeholder image with proper Recovery Tools asset.

---

## Signup/Profile decision

Keep signup simple for now.

Use one name field at signup:

```js
name: name
```

Later allow users to add/edit:

* First name
* Last name
* Phone
* Shipping address
* Billing address
* Profile image

Shipping details can be captured during checkout and optionally saved back to the profile.

Do not split first/last name unless required for:

* SendGrid
* Stripe
* Shipping labels

---

## Next session start

Run:

```powershell
npm run build
```

Then start emulators:

```powershell
npm run emulators
```

Then in another terminal:

```powershell
npm run dev
```

First debugging command:

```powershell
Get-Content functions\orders\createCheckoutSession.js
```

---

## Main goal for next session

1. Fix `createCheckoutSession` v2 callable auth pattern.
2. Retest `/checkout`.
3. Confirm Stripe checkout session opens.
4. Confirm checkout details save to Firestore.
5. Return to shop filters once checkout is working.

---

## End of session

Commit and push:

```powershell
git status
git add .
git commit -m "Fix profile flow and checkout route setup"
git push
```

Then stop all running processes:

```powershell
Ctrl + C
```

Do this in both:

* Emulator terminal
* Vite dev terminal
