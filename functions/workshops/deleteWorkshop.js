import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

export const deleteWorkshop = onCall({ region: "australia-southeast1" }, async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }

  const { id } = data;
  if (!id) {
    throw new HttpsError("invalid-argument", "Missing workshop ID.");
  }

  try {
    await admin.firestore().collection("submittedWorkshops").doc(id).delete();
    return { success: true };
  } catch (err) {
    console.error("Delete workshop error:", err);
    throw new HttpsError("internal", err.message);
  }
});
