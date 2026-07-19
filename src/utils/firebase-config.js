// Firebase initialization using Vite environment variables.

import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

let app, auth, db, functions, storage;
let appCheckInitialized = false;

export function usesFirebaseEmulators() {
  return import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";
}

function isLocalStripeMode() {
  return (
    import.meta.env.VITE_STRIPE_MODE === "test" ||
    usesFirebaseEmulators() ||
    ["localhost", "127.0.0.1"].includes(location.hostname)
  );
}

export const STRIPE_PUBLISHABLE_KEY = isLocalStripeMode()
  ? import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY_TEST
  : import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

export function getRecaptchaSiteKey() {
  const key = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  if (!key) console.warn("Missing VITE_RECAPTCHA_SITE_KEY in .env");
  return key || undefined;
}

export async function initFirebase() {
  if (!app) {
    const firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
    };

    try {
      app = initializeApp(firebaseConfig);
      auth = getAuth(app);

      // Auth must be connected before persistence or any other operation can
      // restore a user and make its first network request.
      if (usesFirebaseEmulators()) {
        console.log("Connecting Firebase SDKs to local emulators...");
        connectAuthEmulator(auth, "http://127.0.0.1:9100", {
          disableWarnings: true,
        });
      }

      db = getFirestore(app);
      functions = getFunctions(app, "australia-southeast1");
      storage = getStorage(app);

      if (usesFirebaseEmulators()) {
        connectFirestoreEmulator(db, "127.0.0.1", 8080);
        connectFunctionsEmulator(functions, "127.0.0.1", 5001);
        connectStorageEmulator(storage, "127.0.0.1", 9199);
      }

      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch (persistenceError) {
        console.warn("Could not explicitly enable local auth persistence:", persistenceError);
      }
    } catch (err) {
      console.error("Failed to initialize Firebase:", err);
      return { app, auth, db, functions, storage };
    }

    if (!appCheckInitialized && !usesFirebaseEmulators()) {
      const isLocalhost = ["localhost", "127.0.0.1"].includes(location.hostname);
      const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;

      if (isLocalhost && debugToken) {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
        console.log("Using App Check debug token.");
      }

      const siteKey = getRecaptchaSiteKey();
      if (siteKey) {
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(siteKey),
          isTokenAutoRefreshEnabled: true,
        });
        console.log("App Check initialized with reCAPTCHA v3.");
        appCheckInitialized = true;
      } else {
        console.warn("App Check was not initialized. Site key missing.");
      }
    }
  }

  return { app, auth, db, functions, storage };
}

export { app, auth, db, functions, storage };
