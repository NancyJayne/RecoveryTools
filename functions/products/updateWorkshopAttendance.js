import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function documentId(...values) {
  return values.join("-")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

export const updateWorkshopAttendance = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (request.auth?.token?.admin !== true) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }
    const productId = clean(request.data?.productId);
    const productVariantId = clean(request.data?.productVariantId);
    const orderId = clean(request.data?.orderId);
    const userId = clean(request.data?.userId);
    if (!productId || !orderId) {
      throw new HttpsError("invalid-argument", "Product and order are required.");
    }
    const attendanceId = documentId(
      "ATTENDANCE",
      productId,
      productVariantId || "DEFAULT",
      orderId,
      userId || "CUSTOMER",
    );
    const now = admin.firestore.FieldValue.serverTimestamp();
    await admin.firestore().collection("workshopAttendance").doc(attendanceId).set({
      attendanceId,
      productId,
      productVariantId,
      orderId,
      userId,
      checkedIn: request.data?.checkedIn === true,
      checkedInAt: request.data?.checkedIn === true ? now : null,
      checkedInByUid: request.auth.uid,
      updatedAt: now,
    }, { merge: true });
    return { success: true, attendanceId };
  },
);
