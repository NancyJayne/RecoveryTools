const requiredVariables = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_FIREBASE_MEASUREMENT_ID",
  "VITE_RECAPTCHA_SITE_KEY",
  "VITE_STRIPE_PUBLISHABLE_KEY",
  "VITE_STRIPE_PUBLISHABLE_KEY_TEST",
];

const missingVariables = requiredVariables.filter(
  (variableName) => !String(process.env[variableName] || "").trim(),
);

if (missingVariables.length) {
  console.error(
    `Refusing to build an unconfigured client. Missing: ${missingVariables.join(", ")}`,
  );
  process.exit(1);
}

console.log("Required client configuration is present.");
