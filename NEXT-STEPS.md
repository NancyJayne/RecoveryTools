# Recovery Tools - Next Steps

## Current Handoff

Last updated after the July 13 build session.

The app is now moving from a basic shop into a scalable marketplace/admin system. The current architecture supports physical products, digital products, sessions, courses, workshops, programs, assets, policies, order fulfilment, customer feedback, reviews, and admin business settings.

## Confirmed Working Recently

* Stripe test checkout can complete locally through the listener/emulators.
* Stripe webhook listener returned `200` for checkout events once the correct local endpoint and webhook secret were used.
* Password reset works end to end in emulator and sends through SendGrid when sandbox mode is disabled.
* Order confirmation email sends and logs email status.
* Tracking email sends and logs email status.
* Admin can see orders, purchased items, customer details, fulfilment status, tracking, assigned admin, and latest updater.
* Admin dashboard counts open orders, new/unassigned orders, and open returns/complaints.
* Admin can update fulfilment status and tracking details.
* Delivered orders can send review/returns/help follow-up email.
* Customer profile order history shows invoice, tracking/review/help links, and purchased product lines.
* Invoice PDF generation works and now uses central business settings data.
* Customer order help form submits into the website rather than using `mailto:`.
* Product reviews can be submitted and reviewed/approved by admin.
* Admin Reviews & Feedback shows product reviews and order help/feedback requests.
* Business Settings can update Recovery Tools business details for generated content.
* Policy pages can render from database-managed policy assets/URLs.
* Marketplace category tags display on product cards so tools/courses/workshops/programs are easier to distinguish.
* Content Builder hides the shop product relationship tool unless `Shop product` is selected.
* Content Builder tags are now chosen from existing tags, with an add-new option and repeatable tag rows.

## Major Work Completed Since Last Proper Update

### Admin Order Lifecycle

Added or improved:

* Packing, packed, shipped, delivered, completed fulfilment flow.
* Open returns/swaps/complaints queue.
* Customer follow-up status and notes.
* Delivered follow-up email with review and help links.
* Auto-complete support for delivered orders after the waiting period when there is no open customer issue.
* Archive support for completed orders.
* Manual archive/unarchive action.
* Order timeline/audit data for status, archive, auto-complete, and customer issue changes.
* Admin process help modal.

Still to polish:

* Dedicated Claim order button.
* Filter tabs for Unassigned / Mine / Packing / Shipped / Complete.
* Print packing slip button.
* Copy buttons for address, tracking number, order ID, and customer email.

### Email Logging

Current:

* Email logs show confirmation, tracking, review/follow-up, password reset, and broadcast-style attempts where wired.
* Statuses distinguish sent, sandboxed, and failed.
* Local sandbox mode avoids blocking the app during emulator testing.

Production smoke test still needed:

* Send real password reset.
* Send real order confirmation.
* Send real tracking email.
* Send real delivered/review/help email.
* Confirm SendGrid Activity shows requests and delivery outcomes.

### Reviews, Feedback, Returns, Complaints

Current:

* Product reviews are submitted through the shop product page.
* New reviews remain hidden until admin approval.
* Admin Reviews & Feedback shows reviews and customer order help submissions.
* Customer order help supports feedback, return, replacement, damaged item, and complaint-style requests.
* Open returns/complaints are counted on the admin dashboard.

Next:

* Add stronger admin filters for review status and issue type.
* Add customer-visible status updates for submitted help requests.
* Add reply/follow-up email actions from the admin issue card.

### Business Settings

Current:

* Admin Business Settings manages central Recovery Tools details:
  * business name
  * ABN
  * address
  * phone
  * email
  * logo URL
  * policy URLs
  * about/SEO-style content fields
* Header logo/name and invoice data can use this central profile.
* About page content is connected to business settings.

Next:

* Consider adding favicon/OG image management to Business Settings.
* Add richer About page sections once final copy is ready.
* Keep policy PDFs as database assets/itemAssets where possible, with Business Settings only selecting which asset/URL is current.

### Content Builder

Current:

* Admin Content Builder can create:
  * items
  * assets
  * itemAssets
  * shop-ready products
* Item fulfilment types include:
  * Physical Product
  * Digital Product
  * Session
* Supports category/kind fields so shop products, policies, tests, digital assets, and sessions can be distinguished.
* Supports template defaults and custom templates.
* Supports uploaded assets/images.
* Uses one effective shop price field that maps back to the workbook-backed `ProductPrice.EffectiveShopPrice` data shape.
* Supports SKU, effective price, stock, variants, visibility, featured state, and archive state for shop products.
* Variants can include colour, size/weight, SKU, price override, and stock.
* Shop product relationship fields are hidden unless `Shop product` is selected, so digital assets/policies/non-shop items are cleaner to create.
* Tags are selected from existing tags or added one at a time to reduce redundant tag values.

Next:

* Test creating one physical product, one digital product, and one session from Content Builder.
* Add a better template editor layout once the data shape feels right.
* Add duplicate warnings by category/type, not just broad title similarity.
* Add a separate, fuller Template Manager view if template editing starts crowding the Builder.
* Confirm Builder-created products seed/export cleanly against `Recovery Tools Master Database.xlsx`.

### Products, Marketplace, Inventory

Current:

* Public shop can show more than physical tools.
* Products can be physical, digital, session/course/workshop/program-style listings.
* Product cards show a type/category label so mixed featured products are easier to scan.
* Digital/session products do not need shipping.
* Inventory tracking can be disabled for digital/session products.
* Products can be activated, hidden, or archived.
* Hidden/archived products are excluded from public shop results.
* Checkout blocks stale-cart purchases for hidden/archived products.
* Variant selection works in product detail and cart.
* Checkout validates selected variants server-side.
* Paid order confirmation now decrements stock automatically for tracked products and variants.
* Admin Products & Inventory lets admin manually update product or variant stock.

Next:

* Retest a paid purchase and confirm stock decrements in:
  * `products.stock`
  * `itemVariants.stock`
  * `inventory.stockQty`
* Decide low-stock thresholds and add admin warnings.
* Add out-of-stock hiding rules if wanted.
* Add stock movement/audit log later if inventory accuracy becomes important.

### Public Navigation

Current header target:

* Home
* Marketplace - acquire something
  * Shop
  * Courses
  * Workshops
  * Programs
* Library - learn something
  * Anato-me
  * future free resources
* About
* Profile

Next:

* Visually test the desktop dropdown and mobile menu.
* Decide whether V1 should show all Marketplace/Library sublinks or hide unfinished sections with feature flags.
* Add a proper Marketplace landing/filter page later so `/shop`, `/courses`, `/workshops`, and `/programs` feel like filtered views of one marketplace.

## Start Here Next

### 1. Restart And Retest The Latest Changes

Restart:

```powershell
firebase emulators:start
npm run dev
stripe listen --forward-to http://127.0.0.1:5001/recovery-tools/australia-southeast1/handleStripeWebhook
```

Then verify:

* Admin menu shows Products & Inventory.
* Admin can edit stock manually.
* Admin Builder hides product relationship fields until `Shop product` is selected.
* Admin Builder tag picker shows existing tags and allows one new tag at a time.
* Create or select a tracked physical product with stock.
* Buy it through Stripe test checkout.
* Confirm order is created.
* Confirm product stock decrements once.
* Confirm variant stock decrements if a variant was purchased.
* Refresh checkout success/profile and confirm stock does not decrement a second time.
* Hide a product and confirm it disappears from the public shop.
* Archive a product and confirm stale cart checkout is blocked.
* Buy a digital/session product and confirm no shipping is required.

### 2. Content Builder Dry Run

Create one test record for each:

* Physical product with image, price, stock, and variant.
* Digital product with PDF/image asset and no shipping.
* Session product with seat/ticket fields and no shipping.

Confirm:

* Firestore product shape is correct.
* `ProductPrice.EffectiveShopPrice` is the value used for public product price and cart price.
* Shop display is correct.
* Cart and checkout do not break.
* Inventory only tracks what should be tracked.
* Non-shop items do not create/update product relationship data.
* Tags are not duplicated when saving existing/new tags.

### 3. Full Order Lifecycle Test

Run one order through:

* New
* Packing
* Packed
* Shipped with tracking
* Delivered
* Customer review
* Customer help/feedback request
* Resolve issue
* Completed
* Archived

Confirm dashboard counts update after each relevant step.

## V1 Launch Blockers

Do these before public launch:

1. Run a full local V1 test from product creation through order archive.
2. Run a real SendGrid production smoke test.
3. Run one complete Stripe test purchase against deployed functions.
4. Decide V1 public navigation visibility.
5. Confirm policies open correctly in deployed mode.
6. Confirm PDF invoice links work from email and profile.
7. Confirm admin-only routes do not redirect incorrectly.
8. Confirm stock cannot decrement twice for the same paid order.
9. Polish product images, product copy, shipping text, returns text, and About page copy.

## V1 Public Scope Decision

Recommended V1:

* Home
* Marketplace
* About
* Cart/checkout
* Profile
* Policy links

Keep unfinished areas built but hidden if they are not ready:

* Courses
* Workshops
* Anato-me
* Programs
* Library extras

Use feature flags/visibility controls rather than deleting code.

## Workbook Product Import

Current:

* Workbook source file name: `Recovery Tools Master Database.xlsx`.
* Import supports item/product/price/inventory/assets relationships.
* `ItemProductID` should stay stable because it maps to Firestore product docs.
* Inventory rows can seed stock.
* Assets and itemAssets remain the preferred architecture for reusable files like logos, policies, PDFs, and images.

Useful commands:

```powershell
cd "C:\Users\hello\Firebase project\functions"
node scripts/seedRecoveryProducts.js --dry-run --workbook "C:\Users\hello\Downloads\Recovery Tools Master Database.xlsx"
node scripts/seedRecoveryProducts.js --workbook "C:\Users\hello\Downloads\Recovery Tools Master Database.xlsx"
```

Remaining workbook checks:

* Keep `ProductPrice.Status` active for prices that should import.
* Keep `ItemProduct.ItemProductID` stable.
* Add production asset URLs for all products/policies.
* Standardize reference status values.
* Add Stripe product/price IDs later if the workbook remains the Stripe source of truth.

## Known Issues / Watch List

* Some text encoding in older files still shows corrupted symbols in comments/toasts.
* Need to verify admin route redirects after the new navigation changes.
* Need to verify policy PDF preview/download in deployed mode, not only local.
* Need to verify order help link after login in deployed mode.
* Need SendGrid production delivery confirmation, not just local logs.
* Need low-stock and out-of-stock admin warnings.
* Need product/session/course detail pages to feel unified under Marketplace.

## Validation Commands Used Recently

```powershell
node --check functions/orders/confirmStripePurchase.js
node --check functions/products/updateProductInventory.js
node --check src/admin/admin-products.js
node --check src/admin/admin-navigation.js

node .\node_modules\eslint\bin\eslint.js functions/orders/confirmStripePurchase.js functions/products/updateProductInventory.js functions/index.js src/admin/admin-products.js src/admin/admin-navigation.js

node .\node_modules\tailwindcss\lib\cli.js -i .\src\style.css -o .\public\output.css --minify
node .\node_modules\vite\bin\vite.js build
```

## End Of Session Checklist

```powershell
git status
git diff --check
npm run build
git add <changed files>
git commit -m "<clear scoped message>"
```
