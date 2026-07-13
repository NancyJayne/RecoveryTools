import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export const submitProductReview = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    const uid = cleanString(request.auth?.uid);
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in before submitting a product review.");
    }

    const { productId, userName, rating, comment, token } = request.data || {};
    const cleanProductId = cleanString(productId);
    const cleanComment = cleanString(comment);
    const cleanUserName = cleanString(userName) || request.auth?.token?.name || "Anonymous";
    const cleanRating = Number(rating);

    if (!cleanProductId) {
      throw new HttpsError("invalid-argument", "Missing product ID.");
    }

    if (!token && process.env.FUNCTIONS_EMULATOR !== "true") {
      throw new HttpsError("invalid-argument", "Missing review verification token.");
    }

    if (!Number.isInteger(cleanRating) || cleanRating < 1 || cleanRating > 5) {
      throw new HttpsError("invalid-argument", "Select a rating from 1 to 5.");
    }

    if (!cleanComment) {
      throw new HttpsError("invalid-argument", "Enter a review comment.");
    }

    const productRef = admin.firestore().collection("products").doc(cleanProductId);
    const productSnap = await productRef.get();
    if (!productSnap.exists) {
      throw new HttpsError("not-found", "Product not found.");
    }

    const reviewRef = productRef.collection("reviews").doc();
    await reviewRef.set({
      reviewId: reviewRef.id,
      productId: cleanProductId,
      userId: uid,
      userEmail: cleanString(request.auth?.token?.email),
      userName: cleanUserName,
      rating: cleanRating,
      comment: cleanComment,
      visible: false,
      status: "pending",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      reviewId: reviewRef.id,
      status: "pending",
    };
  },
);
