import { functions } from "./firebase-config.js"; // Adjust if needed
import { httpsCallable } from "firebase/functions";

export async function logClientError({ message, stack, source = "client", action = "unspecified", metadata = {} }) {
  try {
    const logError = httpsCallable(functions, "logError");
    await logError({
      errorMessage: message,
      errorStack: stack,
      source,
      userAction: action,
      metadata,
    });
  } catch (loggingErr) {
    console.error("🚨 Failed to log client error:", loggingErr);
  }
}