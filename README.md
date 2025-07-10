
# RecoveryTools
RecoveryToolsApp

## Prerequisites

- **Node.js v22** or newer. Use the same version in the root project and the
  `functions/` directory.
- **Firebase CLI**. Install globally with:

  ```bash
  npm install -g firebase-tools
  ```

## Environment setup

Copy `.env.example` to `.env` and replace the placeholder values with your real
configuration before running development server or building the project.

### Firebase Admin

If you need to run `testFirebase.cjs` or other admin scripts, encode your Firebase
service account JSON as base64 and add it as `FIREBASE_ADMIN_KEY_BASE64` in
your `.env` file:

```bash
export FIREBASE_ADMIN_KEY_BASE64=$(base64 -w0 path/to/service-account.json)
```

On Windows PowerShell:

```powershell
$Env:FIREBASE_ADMIN_KEY_BASE64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("path\\to\\service-account.json"))
```

Then create a `.env` entry:

```env
FIREBASE_ADMIN_KEY_BASE64=PASTE_THE_BASE64_VALUE_HERE
```

### Configuring reCAPTCHA

1. Create a reCAPTCHA v3 site in the [Google admin console](https://www.google.com/recaptcha/admin).
2. Copy the **site key** into your `.env` file:

```env
VITE_RECAPTCHA_SITE_KEY=YOUR_RECAPTCHA_SITE_KEY
```

3. Store the **secret key** as a Firebase secret so Cloud Functions can verify tokens:

```bash
firebase functions:secrets:set RECAPTCHA_SECRET_KEY
```

For local testing with the emulators, add `RECAPTCHA_SECRET_KEY` to your `.env` file so tokens can be verified.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

### Node version

The project expects **Node.js 22**. Ensure this version is active when developing or running scripts.

## Installing dependencies

Install dependencies in the project root:

```bash
npm install
```

Then install Cloud Functions dependencies:

```bash
cd functions
npm install
```

### Firestore indexes

Deploy the composite indexes defined in `firestore.indexes.json` before running
the app:

```bash
firebase deploy --only firestore:indexes
```

This creates indexes for the `courses` collection and a second index for the
`workshops` collection on `visible` (ascending) and `dateUTC` (descending).

## Running the dev server

Start the local development server with:

```bash
npm run dev
```

This runs the Vite dev server.

## Deploying to Firebase

Deploy Cloud Functions and hosting:

```bash
firebase deploy --only functions
firebase deploy --only hosting
```

## Viewing Cloud Function logs

To view logs for a specific function, pass `--only` with the function name:

```bash
firebase functions:log --only verifyRecaptchaToken
```

You can run the same command through the `functions/` scripts for consistency:

```bash
npm --prefix functions run logs -- --only verifyRecaptchaToken
```