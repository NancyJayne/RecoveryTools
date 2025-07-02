
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