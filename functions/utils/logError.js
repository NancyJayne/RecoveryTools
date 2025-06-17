
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

// No setGlobalOptions() here – region is applied inline per function to avoid global duplication warnings.

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 📄 Secure server-side error logging utility
 * Can be called from any UI or backend function to log structured errors
 */
export const logError = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    const { errorMessage, errorStack, source, userAction, metadata = {} } = data;

    if (!errorMessage || typeof errorMessage !== "string") {
      throw new HttpsError("invalid-argument", "Missing or invalid error message.");
    }

    try {
      await admin.firestore().collection("logs").add({
        type: "error",
        message: errorMessage,
        stack: errorStack || null,
        source: source || "unspecified",
        action: userAction || "unknown",
        metadata,
        userId: context.auth?.uid || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true };
    } catch (err) {
      console.error("Failed to log error:", err);
      throw new HttpsError("internal", "Error logging failed.");
    }
  },
);
