import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const utilsDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(utilsDir, "../../.env") });
dotenv.config({ path: resolve(utilsDir, "../.env"), override: true });

export function useStripeTestMode() {
  if (process.env.STRIPE_MODE) {
    return process.env.STRIPE_MODE === "test";
  }
  return process.env.FUNCTIONS_EMULATOR === "true";
}

export function stripeModeLabel() {
  return useStripeTestMode() ? "test" : "live";
}

export function appBaseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  if (process.env.FUNCTIONS_EMULATOR === "true") return "http://localhost:5173";
  return "https://recoverytools.au";
}

export function stripeSecretValue({ liveSecret, testSecret }) {
  if (useStripeTestMode()) {
    return process.env.STRIPE_SECRET_KEY_TEST || testSecret.value();
  }
  return process.env.STRIPE_SECRET_KEY || liveSecret.value();
}

export function stripeWebhookSecretValue({ liveSecret, testSecret }) {
  if (useStripeTestMode()) {
    return process.env.STRIPE_WEBHOOK_SECRET_TEST || testSecret.value();
  }
  return process.env.STRIPE_WEBHOOK_SECRET || liveSecret.value();
}
