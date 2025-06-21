// firebase-config.js – Firebase initialization using Vite environment variables

import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

// Global Firebase instances
let app, auth, db, functions, storage;
let appCheckInitialized = false;

// 🔑 Stripe key export
export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

// 🔐 reCAPTCHA site key getter
export function getRecaptchaSiteKey() {
  const key = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  if (!key) console.warn("⚠️ Missing VITE_RECAPTCHA_SITE_KEY in .env");
  return key || undefined; // return undefined when key is missing
}

// ✅ Firebase initialization function
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
      // 🚀 Initialize Firebase core
      app = initializeApp(firebaseConfig);
      auth = getAuth(app);
      db = getFirestore(app);
      functions = getFunctions(app, "australia-southeast1");
      storage = getStorage(app);
    } catch (err) {
      console.error("Failed to initialize Firebase:", err);
      return { app, auth, db, functions, storage };
    }

    // 🔒 Initialize App Check
    if (!appCheckInitialized) {
      const isLocalhost = ["localhost", "127.0.0.1"].includes(location.hostname);
      const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;

      if (isLocalhost && debugToken) {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
        console.log("🧪 Using App Check debug token.");
      }

      const siteKey = getRecaptchaSiteKey();
       if (siteKey) {
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(siteKey),
          isTokenAutoRefreshEnabled: true,
        });
        console.log("🔐 App Check initialized with reCAPTCHA v3.");
        appCheckInitialized = true;
      } else {
        console.warn("⚠️ App Check was not initialized. Site key missing.");
      }
    }

    // 🛠 Connect to emulators in development
    if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      console.log("⚙️ Connecting Firebase SDKs to local emulators...");
      connectAuthEmulator(auth, "http://127.0.0.1:9100");
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
      connectFunctionsEmulator(functions, "127.0.0.1", 5001);
      connectStorageEmulator(storage, "127.0.0.1", 9199);
    }
  }

  return { app, auth, db, functions, storage };
}

// 🧩 Export initialized instances for shared use
export { app, auth, db, functions, storage };
