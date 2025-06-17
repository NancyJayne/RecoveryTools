import { functions } from "./firebase-config.js"; // Adjust if needed

export async function logClientError({ message, stack, source = "client", action = "unspecified", metadata = {} }) {
  try {
    const logError = functions.httpsCallable("logError");
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