# V2 staging and release plan

## Production boundary

- `main` represents the production release line.
- Do not develop unfinished V2 features directly on `main`.
- Narrow V1 fixes use a short-lived `codex/v1-*` branch and are merged only after focused verification.
- V2 work uses a separate `codex/v2-*` branch and a separate Firebase project.

## Staging project

Create a second Firebase project before deploying V2 code. It must have its own:

- Hosting site and web-app configuration
- Authentication users and authorised domains
- Firestore database, rules, and indexes
- Storage bucket and rules
- Functions and Secret Manager values
- App Check/reCAPTCHA registration
- SendGrid test or sandbox configuration
- Stripe test keys and test webhook endpoint

Never copy production Stripe secrets, customer records, orders, or authentication users into staging.

After the staging project is created, add it as a Firebase alias without changing production:

```powershell
npx firebase-tools use --add
```

Keep `recovery-tools` as the production project and choose `staging` as the new alias. Every staging deployment must explicitly include `--project staging`; every production deployment must explicitly include `--project recovery-tools`.

## V2 Inventory Stocktake scope

Build the redesign on `codex/v2-inventory-stocktake` after the staging project exists:

- Default to active inventory only.
- Provide separate Items/components and Products/finished-goods views.
- Keep Product variants grouped beneath their Product.
- Keep Item variants grouped beneath their Item.
- Make the entity kind visually prominent so component stock cannot be confused with packaged stock.
- Provide an explicit Archived view rather than mixing archived records into daily stocktake.
- Save only rows currently displayed and reviewed by the admin.

## Promotion to production

1. Test V2 in the staging Firebase project with disposable users and Stripe test payments.
2. Review the branch diff against `main`.
3. Merge only after the acceptance checklist passes.
4. Build and deploy using the production GitHub environment or an explicit production command.
5. Complete a short production smoke test without creating unnecessary live transactions.

Do not use a Hosting preview channel as the only V2 environment because Functions, Firestore, Authentication, Storage, App Check, and Stripe also need isolation.
