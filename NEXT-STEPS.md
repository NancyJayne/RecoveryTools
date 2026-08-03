# Recovery Tools - Next Steps

## Production Readiness - August 3, 2026

### Confirmed working

- [x] Every public policy PDF link opens the selected document correctly.
- [x] Content Builder works for Item types `content`, `part`, and `tool`, including Assets.
- [x] Physical Products and Course Products work through Marketplace and checkout.
- [x] Manufacturing Blueprints, component recipes, manufacturing stock movements, Course modules, and Course Plans work.
- [x] Purchased Course access appears in CRM and the customer profile/player.
- [x] Repeated unlocks are deduplicated: the test customer retained one active Course access record.
- [x] Hybrid orders show both the physical fulfilment and digital-access workflows.
- [x] Product hide, activate, and archive actions produce the expected Marketplace visibility.
- [x] Paused Course Plans are unavailable in the customer Course player.
- [x] Admin CRM now supports removing and restoring individual Course, Workshop, or Program access without deleting its history.
- [x] Marketplace now hides Products whose primary linked content is paused or archived.
- [x] Inventory Stocktake now lists only Items and Products explicitly marked as inventory tracked.
- [x] Reopening Inventory Stocktake or Record Manufacturing now refreshes current tracked records automatically.
- [x] Existing Products now persist newly added Product variants instead of returning after the Product-only update.
- [x] A purchase or manual re-grant clears prior access-revocation metadata when restoring the same deterministic access record.
- [x] Products & Inventory includes a Workshop Sessions view with capacity, paid tickets sold, remaining places, attendees, quantities, and Admin Order links per Product variant.
- [x] Product fulfilment controls now appear before Product variants, the drawer saves Product/session details directly, and Products & Inventory opens the shared Product drawer over the current page instead of navigating away or using a separate legacy editor.
- [x] Content Builder now uses the four-stage operator flow: Details, Build, Review & Save, then Connections.
- [x] New records no longer auto-save when moving from Build to Review; Connections remains unavailable until the record has been reviewed and saved.
- [x] Review & Save now presents an admin-readable content proof with identity, status, tags, descriptions, expandable variants, template fields, recipe Items, connected Items/Blueprints/Plans/Assets, owners, and references.
- [x] Product and Library information is intentionally excluded from Review & Save because it is configured afterward in Connections.
- [x] Save confirmations now open in a modal with Back to Content and Add Connections actions instead of replacing the Builder page.
- [x] Connections now provides variant-level Shop, Library, and manufacturing choices plus embedded Shop, Library, manufacturing, Asset, and unlock previews with in-place edit actions.
- [x] Build-page Add another variant is positioned after the existing variants so the form follows top-to-bottom entry flow.
- [x] V1 public navigation is fixed as Home, Marketplace, About, Profile, Cart, Contact, and footer Policy links.
- [x] Library/Anato-me, Programs, and Affiliate registration are held for V2 and hidden/route-guarded without deleting their implementation.
- [x] Dedicated Course and Workshop discovery pages are not public V1 navigation; unlocked customers retain Course and Workshop access through Profile.
- [x] Stripe Connect controls are hidden for V1 while the implementation remains available for the V2 affiliate launch.

### Implemented - rebuild and confirmation required

- [ ] Rebuild/restart the Functions emulator and confirm editing an existing Product updates its complete Product and ProductVariant records instead of taking the previous link-only path.
- [ ] From Connections, reactivate the first Workshop Product variant, save Product details, and confirm the drawer closes while the Builder remains on Connections.
- [ ] Confirm the Connections Shop preview immediately reloads every saved Product variant and its current status.
- [ ] Reopen the Product drawer and confirm the first variant remains active with its session fields intact.
- [ ] Confirm both active Workshop variants appear in Marketplace; then pause one variant and confirm only that session disappears after save/reload.

### To do before V1 launch

1. **Finish the Workshop Product-variant persistence retest.** Complete the rebuild-and-confirmation checklist above, then verify both sessions, timing, venue or approved affiliate pickup, instructor, ticket capacity, checkout, Workshop plus Course multi-unlock, access email, customer access, Admin Order, cancellation/expiry, and ticket behaviour.
2. **Finish access-control regression.** Test manual removal and restoration in CRM, dated expiry, Product variants with multiple unlocks, paused/archived content, and payment replay protection.
3. **Finish Content Builder regression.** Test the four-stage flow for at least one representative V1 Item, Blueprint, and Plan: create, add multiple variants, review without auto-saving, save, add Connections, reopen, edit, and verify lifecycle/connection persistence.
4. **Finish CRM workflows.** Confirm user edit/merge/archive, orders, notes, manual grants/removals, carts, roles, and Course/Workshop/Program lists against production-shaped data.
5. **Finish approval and publication workflows.** Complete Content, Course/Workshop, and Therapist submission, review, approve/reject, notification, activation, pause, and archive tests.
6. **Run the remaining V1 production integration.** Perform the deployed Contact form test. Stripe Connect and the final Affiliate Agreement move to V2 with Affiliate registration.
7. **Run the final V1 regression.** Create content and Products, publish, purchase physical/digital/hybrid variants, verify access and replay safety, fulfil or resolve the order, then pause/archive and confirm every public and admin state.

### V1 launch position

The main V1 architecture and customer purchase paths are now substantially built. The project is in stabilization and release-gate testing rather than core feature construction.

The shortest safe route to launch is:

1. Confirm the existing-Product/ProductVariant persistence fix.
2. Complete one final Workshop session purchase, access, email, ticket, pause, and expiry regression.
3. Run representative Content Builder, CRM, and approval tests.
4. Complete the remaining deployed integration and public-navigation decisions.
5. Run one clean production-shaped regression from content creation through purchase, fulfilment/access, and archive.

Do not add optional financial reporting, advanced inventory, or larger CRM enhancements to the V1 gate unless a test identifies them as necessary for safe operation.

### Future build

- Course video audio investigation.
- Re-enable Affiliate registration after adding the final Affiliate Agreement and completing Stripe Connect production onboarding/payout testing.
- Re-enable Library/Anato-me and Programs after their V2 content, navigation, and publication checks pass.
- Financial cost-factor and margin reporting upgrades.
- Advanced inventory warnings, audit views, and purchasing workflows.
- Larger-scale CRM follow-up, staff assignment, and pagination.
- Unified public Course, Workshop, Program, session, and Marketplace discovery after each area is launch-ready.

## Current Handoff

Last updated August 3 after the Content Builder was reorganized into Details, Build,
Review & Save, and Connections; the Review page became an operator-readable content
proof; save confirmation became a modal; and existing Product editing was corrected
to persist ProductVariant changes. The immediate V1 gate is rebuilding and confirming
Workshop Product-variant persistence, followed by the remaining focused CRM,
approval, integration, and final regression checks.

The approved safety-first Product/Asset refactor is documented in `PRODUCT-ASSET-REFACTOR-MIGRATION-PLAN.md`. Products and Assets remain independent first-class entities; Product and Asset are not Item types. Implementation must remain additive and dual-read until the repeatable emulator migration, checkout/access/inventory parity tests, order-history checks, and rollback gates pass.

Phase 1 additive groundwork is now implemented: shared runtime schemas, canonical workbook/import/export collection support, `CreatesProduct` workbook fields, and Firestore rules/indexes for the new Product and Asset relationship collections. Legacy sheets, collections, checkout reads, Stripe fields and order snapshots remain unchanged.

Phase 2's deterministic migration and isolated emulator verifier are also implemented. The verified first run created 63 canonical records and updated 23 existing records additively; the second run produced zero creates and zero updates. Legacy collection counts were unchanged. Ten legacy Product access references point to Plan/Course IDs that are not present in the workbook, so they were reported and deliberately skipped. These IDs must be mapped to valid Plan records before canonical access cutover.

Phase 3 dual-read adapters are now implemented. Catalogue hydration, checkout creation, purchase confirmation, Stripe webhook access grants, Content Builder hydration, and inventory updates prefer canonical ProductVariants, EntityAssets/Assets/AssetRenditions, ProductAccessGrants, and ProductPrice records while retaining legacy fallbacks. Existing `type` values remain available for filters and commission settings; canonical `productType` is exposed separately. Inventory writes update ProductVariants when the selected canonical variant exists, otherwise they retain ItemVariants compatibility. Run `npm run verify:product-adapters` for the fast adapter regression suite. Keep the adapters in place until the remaining access and publication checks pass.

Phase 4's canonical admin foundation is now implemented. Saving a sellable Item, Blueprint, or Plan writes canonical Product identity fields, ProductLinks, ProductVariants, ProductAccessGrants for Plans, and EntityAssets while retaining compatibility records needed by the current UI. `CreatesProduct` is available to Blueprints and Plans as well as Items. The editor can create a new Product or select an existing Product and choose its ProductLink role without rewriting the selected Product. Turning the toggle off does not alter existing ProductLinks; the explicit Unlink product action archives only the relationship and preserves both entities. The top-level Product manager uses canonical Product types, creates Products as Draft by default, writes canonical base prices, and no longer exposes a destructive delete button. The Asset Library creates independent Assets, edits and archives renditions, displays EntityAsset usage, and explicitly links or unlinks Items, Blueprints, Plans, Products, and ProductVariants without deleting either side. The focused emulator regression is `npm run verify:canonical-admin-writes:emulator`.

Phase 5's checkout safety gate is now implemented. New orders retain the legacy `products` snapshot and also write immutable schema-version-2 `orderLines` plus canonical `orderItems`. Product, selected ProductVariant, and ProductComponent inventory deductions are validated and committed in the same transaction as the root order, so webhook replays cannot deduct stock twice. ProductAccessGrants create deterministic `userAccess` records with duration-based expiry and revocation metadata. Both the webhook and purchase-confirmation paths repair missing order-item and access side effects when an existing paid order is replayed. Order history, fulfilment, and invoice readers prefer canonical order lines with legacy fallback. Run `npm run verify:order-lines` and `npm run verify:phase5:emulator`; the emulator regression includes a simulated post-order crash and verifies recovery without a second inventory deduction. A deployed Stripe purchase and the associated admin order flow have since been confirmed; access/unlock and the remaining admin workflow checks are the next release gates.

The July 19 deployed Stripe test confirmed Marketplace display, payment, customer order history, Admin Order receipt, and invoice generation. Its inventory result exposed a compatibility gap: some tracked records use a variant flag or a stable workbook InventoryID rather than the Product boolean and constructed `INV-*` ID. Checkout now recognises all three tracking sources and updates the matching Inventory document; the emulator regression uses a non-derived InventoryID to protect this case. Admin Orders also load the latest linked customer issue and display its type, affected items, requested outcome, customer, and full message. Rating has been removed from the Order Help and complaint UI because ratings belong to the separate product-review workflow; historical stored issue ratings remain intact. The tracked purchase, including variants and replay protection, has since been re-tested successfully; the access review is next.

Admin approval alerts now share the purple profile-image badge with unassigned orders. Pending approvals take the badge link to the Approvals page, the count refreshes every minute for signed-in admins, and the Admin Menu shows its own approval count. The Approvals page highlights and counts Content, Workshop, Course, Affiliate Application, Affiliate Pickup Address, Therapist, Review, and Feedback queues independently so the admin can open the affected queue directly. Purple is reserved for notifications and deliberate actions such as Clear filters; ordinary information panels retain neutral styling.

The app is now moving from a basic shop into a scalable marketplace/admin system. The current architecture supports physical products, digital products, sessions, courses, workshops, programs, assets, policies, order fulfilment, customer feedback, reviews, and admin business settings.

## Completed

Implemented or confirmed. Test-only gaps are kept in the launch checklist below rather than being silently treated as complete.

- [x] Product appears in Marketplace and Stripe test payment completes.
- [x] Customer order history and the Admin Order record show the purchase correctly.
- [x] Invoice is generated correctly.
- [x] Product variants remain visible through cart, checkout, success, Admin Orders, and packing slips.
- [x] Packing slip preview now opens correctly and its generated PDF contains recipient/contact details, items, quantities, variants/SKUs, and notes.
- [x] Approval and unassigned-order counts appear as purple notification badges, including per-approval-type counts.
- [x] Customer issue rating was removed from Order Help and Admin Orders; complaint details, status, notes, resolution notes, and editable due date now share the same workflow.
- [x] A tracked purchase decrements product and variant inventory correctly after the InventoryID compatibility fix, including replay protection against a second decrement.
- [x] Australia-only shipping pricing and the free-shipping threshold work end to end.
- [x] The complete customer complaint workflow works from submission through resolution, completion, and archive.
- [x] SendGrid production smoke tests completed successfully.
- [x] Affiliate signup is application-only: new applications remain pending and do not receive the affiliate role or dashboard access until an admin approves them.
- [x] Admin Affiliate management separates application approvals from pickup-address approvals, supports decision notes, retains rejected applications, and sends approval/rejection email notifications.
- [x] Affiliate signup now shows application state, has its own timezone field, validates logo type/size, records Terms/Privacy/Affiliate Agreement acceptance, and prevents duplicate pending applications.
- [x] Affiliate dashboard sidebar navigation and legacy panel nesting were repaired, including removal of the duplicate workshop-panel ID.
- [x] Marketplace tiles use the short Product description while Product detail pages use the long description, with compatibility fallbacks for older records.
- [x] Affiliate pickup orders use the affiliate destination for packing/shipping and send the customer a ready-for-pickup email when the affiliate marks the order ready.
- [x] Affiliate signup timezone options are always available, with Australian choices and a Brisbane fallback.
- [x] The cart drawer scrolls as one panel so items, pickup/affiliate selection, totals, and checkout remain reachable on short screens.
- [x] Stripe Connect onboarding now has approved-affiliate checks, loading/error states, dual User/Affiliate account lookup, safe return URLs, and non-silent failure handling.
- [x] Marketplace Product descriptions now fall back to the primary linked customer-facing Item, Blueprint, or Plan when the Product wrapper has no copied description.
- [x] Product detail removes internal delivery/fulfilment codes and changes the displayed image when a variant with its own linked image is selected.
- [x] Products & Inventory groups each tracked Item or Product once and lists all Item/content or Product variant stock counts underneath without flattening them.
- [x] Products & Inventory now includes a manufacturing recorder that previews the selected Blueprint recipe, adds finished stock, deducts component Item stock transactionally, and records a manufacturing-run audit document.
- [x] Manufacturing recipes show total component Item stock plus each available Item variant, prefer a matching finished-product variant such as Black, and deduct the explicitly selected Item variant.
- [x] Item-variant inventory keys include both ItemID and EntityVariantID, preventing reused IDs such as `VAR-PRIMARY` from colliding across Trigger Ball and Box Items; single-variant legacy stock is reconciled using the newest stored quantity.
- [x] Manufacturing selection uses stable ProductVariantIDs rather than refresh-sensitive list positions, displays the finished variant before recording, and blocks a customer-facing Item variant that conflicts with the selected finished Product variant.
- [x] Removed the redundant legacy direct-Product creation form from Products & Inventory; new Products are created through Content Builder connections while existing Product editing remains available.
- [x] Products & Inventory uses top-level Inventory Stocktake, Record Manufacturing, Products, and Asset Library tool buttons so only the selected workspace is shown.
- [x] Products can connect directly to an Item, Blueprint, or Plan without requiring an entity variant; entity-variant Shop checkboxes remain available when a direct variant connection is wanted.
- [x] Product variants are independent from Item variants, support variant-specific selling names, descriptions and inclusions, and do not copy component Item stock into finished Product stock.
- [x] Manufacturing Blueprint recipes can use the same Item more than once with different ItemVariantIDs, such as two Small cups and two Large cups, while deducting each selected variant correctly.
- [x] Direct Products without variants, directly connected Product variants, independent Product variants, Marketplace variant display, cart data, manufacturing deductions, insufficient-stock rollback, and edit/reload persistence have been tested successfully.
- [x] Unlocked courses open in a dedicated access-controlled player with selectable Blueprint modules and their linked Item content.
- [x] Admin Orders distinguish digital, physical, and hybrid purchases. Digital-only orders no longer show packing, carrier, tracking, shipping steps, or packing-slip actions; they show access and access-email status instead.
- [x] Order confirmation/resend email includes a direct unlocked-content profile link when the order grants digital access.
- [x] The unlocked-course route now opens the dedicated course player instead of being reset to the empty Courses catalogue; locally verified with purchased `PLAN-COURSE`, two selectable Blueprint modules, and linked Item content.
- [x] The course player opens on a Plan overview instead of auto-opening Module 1, shows module completion checkboxes and a percentage progress bar, and switches to a focused module view with a return-to-overview action. Progress is stored per user and course.
- [x] Business Settings policy fields use readable active PDF/document Asset dropdowns and store stable AssetIDs; existing Item/URL settings remain supported as fallbacks.

## To Do Before V1 Launch

- [ ] Complete the remaining purchased-content access and unlock regression:
  - [x] Create a Plan with type `course`.
  - [x] Create or edit a Product that unlocks that Plan.
  - [x] Purchase the Product as a test customer.
  - [x] Confirm exactly one active `userAccess` record is created.
  - [x] Confirm the course appears in the customer's unlocked content.
  - [x] Purchase or manually unlock the same course again and confirm access is deduplicated.
  - [ ] Test a Product variant that grants multiple unlocks.
  - [ ] Test access expiry and revocation.
  - [ ] Confirm archived or paused content cannot be newly accessed incorrectly.
  - [x] Confirm payment replay does not create duplicate access or repeat inventory deductions.
  - [ ] Purchase a new digital-only course order and confirm Admin Orders shows only the digital access workflow.
  - [ ] Confirm the automatic access email is sent after purchase and the Admin resend action works.
  - [x] Purchase a hybrid physical-plus-access Product and confirm both access and shipping workflows appear.
- [x] Navigate to every public policy page and verify the selected PDF loads correctly in the PDF viewer, including deployed mode.
- [ ] Submit the repaired Contact form once locally and once in deployed production; local submissions are sandboxed while production retains reCAPTCHA and SendGrid delivery.
- [ ] Finish and end-to-end test the Admin Content Builder.
- [ ] Finish and end-to-end test the CRM workflows.
- [ ] Finish and end-to-end test the remaining Content, Course/Workshop, and Therapist approval submission, queue, review, approve/reject, notification, and publication workflows. Affiliate application, affiliate pickup-address, Product Review, and customer-feedback queues are implemented.
- [ ] Emulator-test a new affiliate application through pending access denial, admin approval, refreshed custom claims, dashboard access, and approval email; repeat with rejection and resubmission.
- [ ] V2: Add or connect the final legal Affiliate Agreement policy page/PDF before accepting production applications.
- [ ] V2: Activate Stripe Connect on the Recovery Tools Stripe platform account, then test Express onboarding, return/refresh handling, dashboard login, and payout-account persistence with an approved affiliate.
- [ ] Verify the remaining shop edge cases: hidden Products disappear publicly, archived Products cannot be purchased from a stale cart, and digital/session Products do not require shipping.
- [ ] Run the final V1 regression from content/product creation through checkout, fulfilment, customer history, and archive.
- [ ] Confirm public navigation visibility, admin route protection, policy links, invoice links, and the order-help link in deployed mode.
- [ ] Polish the V1 product images and copy, shipping/returns wording, policies, and About page content.

## Future Build

- [ ] Investigate and resolve inaudible course-preview video audio. The uploaded MP4 exposes an audio track and the browser player reports that it is unmuted, but no sound is currently heard; verify the source track's audible levels and browser/device audio routing before changing the player again.
- [ ] Add the dedicated Claim order action, operational order filter tabs, and one-click copy buttons.
- [ ] Add configurable low-stock warnings, optional out-of-stock hiding, and a stock-movement audit log.
- [ ] Add template revision history and a fuller Template Manager if template administration outgrows the Builder drawer.
- [ ] Expand the Marketplace into unified product, session, course, workshop, and program browsing when those areas are ready to be released.
- [ ] Add richer About-page sections plus favicon and social-sharing image management.
- [ ] Consider state or shipping-zone pricing only if real fulfilment costs make flat Australia-wide shipping unsuitable.
- [ ] Consider storing Stripe product/price IDs in the workbook if the workbook becomes the long-term Stripe source of truth.
- [ ] Add server-side CRM search, filtering, and pagination when the user list becomes too large for client-side loading.
- [ ] Expand CRM follow-up, assignment, ownership, reminders, and staff workload tools after the V1 customer-support workflow is stable.
- [ ] Replace the legacy affiliate course/workshop proposal forms with the shared Item/Blueprint/Plan Content Builder submission workflow, retaining affiliate ownership and the admin approval gate.

## Detailed Implementation Reference

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
* Profile details load independently from role lookup, so a temporary role-service error cannot blank the profile.
* Admin, therapist, and affiliate role UI now updates both profile links and dashboard buttons.
* Local Firebase startup connects Auth before persistence restores a user, preventing `auth/emulator-config-failed`.
* App Check and reCAPTCHA verification are bypassed only while the Firebase emulators are explicitly enabled.
* Removed the redundant read-only Current Items, Blueprints & Plans sidebar list; relationship selectors and duplicate checks still use the full loaded record set.
* Removed the separate bottom Template Tool card; Step 3 Create new template now opens the template form in a focused modal.
* Template creation now uses a right-side drawer and updates the template selector without reloading or resetting the current entity form.
* Template category selectors and summaries display category names while retaining stable CategoryID values in saved data.
* The template drawer separates template details/defaults from variants and their fields into a clear two-part form with Back/Next navigation.
* Template details now mirror the workbook model: an auto-generated area-specific TemplateID, TemplateName, applies-to Type, default category, description, Item commerce/inventory defaults, default status, and Active status. The legacy Default item kind control is no longer shown.
* Its second part lists template variants, expands the selected variant, and manages that variant's FieldName, FieldType, LinkedTable, Required, Repeatable, MinEntries, MaxEntries, AllowUnlimited, SortOrder, and Notes. Stable VariantID, FieldID, TemplateID, and value keys are generated behind the scenes.
* Every template now saves at least one variant, even when there is only a single current option, so more variants can be added later without changing the data shape.
* Custom template fields render for Items, Blueprints, and Plans, and their entered values persist when app-created records are created or edited.
* Asset, Image Asset, Video Asset, PDF Asset, and Canva Design Asset template fields load filtered reusable Asset records into their selectors. The in-Builder Asset drawer can upload to Firebase Storage or save an external YouTube/Canva/website URL, including a YouTube privacy-enhanced embed URL. It selects the canonical Asset in the active template field and links it through EntityAssets to Items, Blueprints, or Plans; Items retain the ItemAsset compatibility relationship. MinEntries/MaxEntries limits remain validated.
* Repeatable linked template fields now use one clear selector per entry, show the minimum required rows immediately, hydrate existing relationships into those rows, prevent duplicate choices, and allow additional rows only up to MaxEntries.
* Existing Asset relationships are shown under their matching named template field instead of a separate Current assets box whenever the selected template defines Asset fields. Editing those rows keeps EntityAsset links in sync without deleting reusable Asset records, while Items also retain ItemAsset compatibility links.
* An Edit template action now sits beside Create new template. It opens the same side drawer with the selected template details, all of its variants, and each variant's fields loaded for editing.
* The selected template now acts as the Builder form schema: changing it rebuilds its custom fields and shows only the standard Item detail fields enabled by its behaviour settings.
* Item template behaviour defaults now cover commerce, shipping, inventory, access unlocking, calendar booking, event/session timing, ticket capacity, delivery mode, location, instructor requirements, and certificates. The reusable template stores requirements/defaults; each Item stores the actual event, venue, instructor, and certificate values.
* Category dropdowns use category names as their visible labels while retaining CategoryID values internally, including a readable fallback for older category rows that only contain an ID.
* Shop product detail pages now display saved event timing, venue, delivery mode, instructor, ticket capacity, access, and certificate information when those fields apply.
* The Admin menu now has one `Content` destination. It opens Content Controls, and the Content Builder is reached through `Create content` or an existing record's Builder action rather than a separate sidebar entry.
* Content cards show Entity, Type, and Status together, place the readable category directly under the name, and surface Product relationships or linked component counts without a separate Relationships action.
* Content filtering now combines the entity buttons with an entity-specific Type dropdown and a real Status / product value filter, including Draft, Published / active, Product, Visible product, missing product data, and product relationship attention.
* Create content from Content Controls now always starts a new record and carries the selected entity, search/name, entity-specific Type, status, and applicable Product visibility into the Builder instead of reopening stale edit state.
* Content Controls also supports combinable Category and Tag dropdowns. With the All entity button selected, Type shows the combined Item, Blueprint, and Plan type list instead of being disabled.
* The operational Status / product filter sits at the top-right beside the entity buttons and uses the refined values Visible on website, Featured, Product, Draft, Awaiting approval, Active, Archived, and Paused.
* Content Builder now uses Save plus a contextual Save and set active action. Product or website-visible content changes that action to Save and send for approval, stores requested visibility separately, and prevents a new draft or approval request from publishing prematurely.
* Server writes stamp Updated date and updater identity on every save, stamp Created date and creator identity for new or legacy-missing records, and retain explicit Owner plus Owner type metadata. Current admin-owned content defaults to Recovery Tools / admin, leaving a consistent ownership model for later therapist and affiliate portals.
* Content Controls can additionally filter Inventory tracked Items, Owner (including Unassigned), and calendar-based last-update windows from less than one month through more than five years.
* Last-update age filters fall back to Created date when Updated date is missing or invalid, and a separate No valid update date option identifies records that need that field corrected.

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
* Customer issue status/details section, resolved-state styling, editable two-week due date, customer notes, and resolution notes.
* Server-generated packing slip with in-page preview, print, and PDF download.
* Packing slips include recipient contact details, delivery address, order and due dates, items, quantities, variants/SKUs, and notes.

Still to polish:

* Dedicated Claim order button.
* Filter tabs for Unassigned / Mine / Packing / Shipped / Complete.
* Copy buttons for address, tracking number, order ID, and customer email.

### Email Logging

Current:

* Email logs show confirmation, tracking, review/follow-up, password reset, and broadcast-style attempts where wired.
* Statuses distinguish sent, sandboxed, and failed.
* Local sandbox mode avoids blocking the app during emulator testing.

Production smoke test completed:

* [x] Send real password reset.
* [x] Send real order confirmation.
* [x] Send real tracking email.
* [x] Send real delivered/review/help email.
* [x] Confirm SendGrid Activity shows requests and delivery outcomes.

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
* Admin can manage an Australia-wide flat shipping rate, optional free-shipping threshold, shipping label, and shipping policy text.
* Cart and checkout show the calculated shipping amount and clearly state that shipping is currently limited to Australia.
* Checkout obtains the authoritative shipping configuration from Firestore; digital-only orders do not incur physical shipping.

Next:

* Consider adding favicon/OG image management to Business Settings.
* Add richer About page sections once final copy is ready.
* Keep policy PDFs as database assets/itemAssets where possible, with Business Settings only selecting which asset/URL is current.
* Replace manual policy URL entry with readable selectors that store the correct AssetID or ItemID for each policy.
* Verify each policy page resolves the selected record and displays its PDF in the viewer in deployed mode.
* Keep flat Australia-wide shipping for V1; only add state/zone pricing if actual fulfilment costs later justify the extra complexity.

### Content Builder

Current:

* Admin Content Builder can create reusable Items and Blueprints, then assemble Plans from either entity.
* Campaign is a Plan type, not a separate creator choice.
* Main entities use the workbook-defined canonical `type` field; legacy type fields are read for compatibility only.
* Blueprint and Plan relationship fields use searchable multi-select lists instead of comma-separated IDs.
* Campaign Plans can add all marketing/education Blueprints and teaching Items matching a condition tag, while matching treatment Plans are saved as related Plans rather than nested content.
* Item, Blueprint, Plan, Category, Tag, and Entity Type options can be seeded from the master workbook.
* `Entity Types.FieldGroupIDs` now controls the grouped fields shown for each Main Entity + Type. The Builder falls back safely when older seeded Types do not yet have configuration.
* The grouped form model uses stable sections such as content, clinical, method, dosage, media, publishing, access, commerce, inventory, relationships, and campaign matching instead of per-field rules.
* Item, Blueprint, and Plan template selection now sits in each entity's Step 3 build screen, with a create-new-template action beside the selector.
* Workbook v8 consolidates all template records into `Templates`, `TemplateVariants`, and `TemplateFields`. Every field belongs to a VariantID, and Plan structures use the same linked-field model rather than a specialist slot sheet.
* No Item, Blueprint, or Plan template variants are hardcoded in the UI. Selectors use imported workbook variants plus templates created in the app.
* Supports template defaults, custom templates, and template-specific fields created directly in the drawer.
* Supports uploaded assets/images.
* Uses one effective shop price field that maps back to the workbook-backed `ProductPrice.EffectiveShopPrice` data shape.
* Supports SKU, effective price, stock, variants, visibility, featured state, and archive state for shop products.
* Variants can include colour, size/weight, SKU, price override, and stock.
* Shop product relationship fields are hidden unless `Shop product` is selected, so digital assets/policies/non-shop items are cleaner to create.
* Tags are selected from existing tags or added one at a time to reduce redundant tag values.
* Similar-record suggestions exclude the Item, Blueprint, or Plan currently being edited while continuing to show other possible duplicates.
* Content created directly in the app is marked as app-origin content, and create operations refuse ID collisions instead of replacing existing records.
* Content Controls can download a versioned full JSON backup containing all root Firestore collections plus known nested order, purchase, ticket, review, issue, and comment collections. The download includes customer/order data and is labelled as sensitive.
* The full-backup action sits in the top-right Content Controls page header so it does not interrupt the filter and management flow.
* Quick Edit waits for restored local authentication, retries one failed save after refreshing the ID token, and keeps unsaved form values open if the session cannot be refreshed.
* Quick Edit tag dropdowns hide tags already selected in another row, and both client and server deduplicate tag values case-insensitively.
* Content Controls supports the intended drill-down flow: choose Item, Blueprint, or Plan; search by name/ID/SKU/tag; choose a Type valid for that entity; then narrow by a real status or product condition.

Validated:

* The Firestore emulator imported v7 and verified reusable photography Items, Blueprint method steps, Trigger Ball Plan Item components, the Recovery Campaign Operating System `business workflow` type, Campaign Plan field groups, the Blueprint template variant/field guide, and a default template variant for every active Plan type.
* The campaign helper selected tagged teaching Items and `marketing content` Blueprints while linking the tagged treatment Plan separately.

Next:

* Add explicit template revision history/version labels if operators need to compare or restore older template definitions after editing.
* Add duplicate warnings by category/type, not just broad title similarity.
* Add a separate, fuller Template Manager view if template editing starts crowding the Builder.

### Master Workbook Import

Current:

* `functions/scripts/importMasterDatabase.js` imports Items, Blueprints, Plans, tags, categories, entity types, Blueprint Items, Blueprint Methods, Blueprint Dosage, Plan Items, Plan Dosage, unified template parents/variants/fields, and optional Plan Links, while preserving the existing product/price/inventory/asset joins.
* The template loader prefers the unified `contentTemplates`, `contentTemplateVariants`, and `contentTemplateFields` collections and retains legacy collection fallback for older seeded environments.
* The v8 dry run reconciles 10 templates, 11 variants, and 17 variant-owned fields with no missing references; the six exercise Plan slots were migrated to linked Blueprint fields.
* `npm run seed:all -- --workbook "<path>"` now uses the full master importer for the emulator instead of only seeding Recovery products.
* `npm run seed:all -- --dry-run --workbook "<path>"` validates the full import without writing to Firestore.
* The importer accepts both the legacy `TypeID`/`FirebaseType` headers and the v5 canonical `Type` headers.
* Every imported document records `managedByWorkbook` plus its source sheet, workbook name/version, importer version, and import timestamp.
* Workbook imports use a managed merge: they create missing document IDs and update changed workbook fields only on records already marked `managedByWorkbook: true`. Extra app-only fields on those records remain intact.
* App-owned records (`managedByWorkbook` is not `true`) are protected even when a workbook row has the same ID, and records missing from a later workbook are never deleted or archived.
* `--reconcile` compares a workbook with Firestore and reports new IDs, workbook-managed updates, unchanged workbook records, protected app-owned collisions, app-only IDs, and workbook-managed IDs missing from the new workbook. The report is read-only and may be saved with `--report <path>`.
* The verified v7 workbook contains 78 Items, 104 Blueprints, 275 Blueprint Method steps, 34 Blueprint Dosage rows, 9 Plans, 37 valid Plan components, one Blueprint template/variant with 11 field definitions, and 9 Plan template parents with 10 variants.
* The v7 dry run completes with no warnings, and its in-workbook Data Quality sheet reports 0 errors and 0 warnings.
* The Firestore emulator creates the workbook documents, then verifies that a repeated import merges changed workbook fields back into workbook-managed content while preserving extra app-only fields, protecting an app-owned ID collision, and retaining an app-created Item.
* The emulator also verifies that the downloadable full backup includes app-created Items, Blueprints, Plans, customer addresses, root Orders, and customer Orders nested under user records.

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
* Variant names/SKUs are preserved through cart, checkout, Stripe/order snapshots, success, Admin Orders, and packing slips.
* Paid order confirmation now decrements stock automatically for tracked products and variants.
* Admin Products & Inventory lets admin manually update product or variant stock.

Validated:

* A paid tracked purchase decrements product/variant inventory exactly once after the stable InventoryID compatibility fix.
* Replaying purchase confirmation does not decrement inventory a second time.

Next:

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

## Current Verification Sequence

### 1. Restart And Verify The Remaining Shop Cases

Restart:

```powershell
firebase emulators:start
npm run dev
stripe listen --forward-to http://127.0.0.1:5001/recovery-tools/australia-southeast1/handleStripeWebhook
```

Then verify:

- [x] Admin menu shows Products & Inventory.
- [x] Admin can edit stock manually.
- [x] Admin Builder hides product relationship fields until `Shop product` is selected.
- [x] Admin Builder tag picker shows existing tags and allows one new tag at a time.
- [x] Create or select a tracked physical product with stock.
- [x] Buy it through Stripe test checkout and confirm the order is created.
- [x] Confirm product stock decrements once after the latest compatibility fix.
- [x] Confirm variant stock decrements if a variant was purchased.
- [x] Refresh checkout success/profile and confirm stock does not decrement a second time.
- [x] Hide a product and confirm it disappears from the public shop.
- [x] Archive a product and confirm it disappears from the public shop; retain final stale-cart blocking in the release regression.
- [x] Buy a digital/session product and confirm no shipping is required.
- [x] Confirm physical shipping totals follow Business Settings and the free-shipping threshold.
- [x] Test ProductAccessGrant creation and the customer's purchased-content access for Courses and Workshops.

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

Status: [x] Completed, including the customer complaint, resolution, completion, and archive path.

### 4. Access And Unlock Test

- [x] Purchase a Product with a ProductAccessGrant.
- [x] Confirm deterministic access is created for the correct Plan.
- [x] Confirm unlock requirements and permitted visibility are enforced for tested Course and Workshop Plans.
- [x] Confirm the customer can find and open purchased Course and Workshop content.
- [ ] Confirm expiry and revocation states behave correctly.
- [x] Replay or repeat access creation and confirm access is not duplicated.

### 5. Policy Asset Selection And PDF Viewer

- [x] Change Business Settings policy inputs to readable Asset selectors while storing stable IDs.
- [x] Confirm each selected record resolves to its current PDF Asset/rendition.
- [x] Test every configured policy navigation link successfully.
- [ ] Confirm the PDF viewer loads, downloads, and handles a missing or archived file safely.

### 6. Finish Admin Operations

- [ ] Complete the Admin Content Builder workflow and representative Item, Blueprint, Plan, Product, and Asset tests.
- [ ] Complete CRM records, customer history, follow-up, ownership/assignment, filtering, and notes workflows.
  - [x] Add searchable checkbox user list, active/archived/content filters, active-user creation, editable contact/address/business details, archive action, and guarded profile merge.
  - [ ] Add an explicit restore/reactivate action for archived or disabled accounts.
  - [ ] Display each access grant's target, source Product/order/manual reason, quantity, grant date, status, expiry, and revocation details.
  - [ ] Add a deliberate access-revocation action with a required reason and audit entry.
  - [ ] Block manual unlock when the selected profile has no matching Auth account, the target entity is missing/inactive, or ProductAccessGrant configuration is incomplete.
  - [ ] Add a visible CRM audit timeline for profile edits, role changes, archive/reactivate actions, merges, manual unlocks, and revocations.
  - [ ] Add a merge preview showing records that will move and conflicts involving email, Stripe customer IDs, roles, business profiles, orders, and access before confirmation.
  - [ ] Replace or supplement admin-created temporary passwords with an emailed account-invitation/password-setup link.
  - [ ] Show clear Active, Archived, Merged, Auth disabled, and Firestore-only account indicators in the user list and selected profile.
  - [ ] Emulator-test profile edits, archive/disable, and merge migration for orders, access, tickets, addresses, notes, role records, and Auth claims.
  - [ ] Emulator-test user creation, role records, invitation/password setup, reactivate, manual unlock, access display, revoke, and audit history using disposable accounts.
  - [ ] After the Content Builder is complete, run the full Product -> ProductAccessGrant -> active Item/Blueprint/Plan -> manual unlock or purchase -> userAccess -> customer-visible content test.
- [ ] Complete approval submission, per-type queues, admin review, approve/reject, notifications, and resulting publication/visibility changes.
  - [x] Affiliate applications remain pending without a role until admin approval; admin can approve/reject with notes and an email decision.
  - [x] Affiliate pickup-address approvals are a separate queue.
  - [x] Product Review and customer feedback/order-help admin queues are implemented.
  - [ ] Complete representative Content approval and resulting visibility/publication tests.
  - [ ] Complete Course and Workshop proposal approval tests, or replace their legacy forms with the shared Content Builder first.
  - [ ] Complete Therapist application/role approval and notification tests.

## To Do Before V1 Launch - Detailed Gate

Do these before public launch:

- [ ] Run a final local V1 test from content/product creation through order archive.
- [x] Run a real SendGrid production smoke test.
- [x] Run a complete Stripe purchase against deployed functions and confirm payment, order/invoice parity, inventory decrement, variant handling, and replay protection.
- [ ] Finish the access/unlock process and verify customer access.
- [ ] Finish the Admin Content Builder, CRM, and approvals workflows.
- [x] Decide and enforce V1 public navigation visibility.
- [x] Change Business Settings policy fields to AssetID selectors and confirm policies open correctly.
- [ ] Confirm PDF invoice links work from email and profile.
- [ ] Confirm admin-only routes do not redirect incorrectly.
- [x] Confirm stock cannot decrement twice for the same paid order.
- [ ] Polish product images, product copy, shipping text, returns text, policy content, and About page copy.

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
* Business Settings policy fields still need readable Asset/Item selectors that store stable IDs.
* Need to verify policy PDF preview/download in deployed mode after those selectors are wired.
* Need to verify order help link after login in deployed mode.
* Need low-stock and out-of-stock admin warnings.
* Need product/session/course detail pages to feel unified under Marketplace.
* Stripe Connect onboarding code is ready, but the Recovery Tools Stripe platform account must activate Connect before Stripe will allow Express account creation.

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
