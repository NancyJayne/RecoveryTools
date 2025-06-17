import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

export const deleteCourse = onCall({ region: "australia-southeast1" }, async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }

  const { id } = data;
  if (!id) {
    throw new HttpsError("invalid-argument", "Missing course ID.");
  }

  try {
    await admin.firestore().collection("courses").doc(id).delete();
    return { success: true };
  } catch (err) {
    console.error("Delete course error:", err);
    throw new HttpsError("internal", err.message);
  }
});