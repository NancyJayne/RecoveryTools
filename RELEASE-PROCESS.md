# Recovery Tools Release Process

## Production boundary

- `recovery-tools` is the permanent production Firebase project.
- `main` represents the code intended for production.
- Feature work is developed on `codex/v2-*` or narrowly scoped fix branches.
- Pull requests build and verify the application but do not deploy Firebase resources.
- Merging or pushing to `main` does not automatically deploy Hosting.
- Production Hosting deployment is a manually started GitHub Actions workflow using the `production` environment.
- `.firebaserc` deliberately has no `default` project alias, so a bare Firebase deployment cannot silently target production.

## Development workflow

1. Create a feature branch from an up-to-date `main`.
2. Develop against the Firebase Emulator Suite.
3. Use disposable emulator users, Orders, payments, inventory, and access records.
4. Run the relevant focused verification scripts.
5. Run the production build and `git diff --check`.
6. Review the branch diff and update `NEXT-STEPS.md` when priorities or handoff state change.
7. Open a pull request and wait for the verification workflow to pass.
8. Merge only reviewed, release-ready changes.

## Local release verification

The local production guard requires `main`, a clean working tree, the expected Firebase project link, and an explicit confirmation phrase:

```powershell
$env:RECOVERY_TOOLS_PRODUCTION_RELEASE='DEPLOY RECOVERY TOOLS'
npm run release:check
```

This command verifies the release but does not deploy anything.

## Deployment

### Hosting

Start **Manually deploy Firebase Hosting to production** from GitHub Actions, enter a release note, approve the `production` environment when prompted, and wait for the workflow to finish.

### Functions, rules, indexes, and Storage rules

Deploy only the resources included in the reviewed release. Always name the project explicitly:

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT='30000'
npx firebase-tools deploy --only functions:functionName --project recovery-tools
```

Do not use an unqualified broad `firebase deploy` for routine releases.

## Production smoke test

After deployment, verify the changed workflow plus:

- Public home and Shop navigation
- Login, logout, and customer Profile
- Cart and checkout initiation
- Admin navigation and the changed admin module
- Browser console and failed network requests
- Relevant Cloud Function, Stripe webhook, and email delivery logs

## Maintenance windows

Most backward-compatible releases do not require downtime. Use maintenance mode only for an incompatible schema migration, security-rule transition, or tightly coupled checkout/access release. Maintenance mode must block new customer mutations server-side while allowing administrators and essential Stripe webhook completion. Implement and test that control before relying on it for a release.

## Rollback

- Roll Hosting back to the previous known-working release from Firebase Hosting release history.
- Redeploy the last known-working Function implementation when a Function caused the regression.
- Prefer forward-compatible data repairs over destructive database rollback.
- Keep maintenance mode enabled until the known-working customer journey is confirmed.
