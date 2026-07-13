import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

function serializeDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate().toISOString();
  if (value.seconds) return new Date(value.seconds * 1000).toISOString();
  return null;
}

export const getAdminProductReviews = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can view product reviews.");
    }

    const limit = Math.min(Number(request.data?.limit || 100), 200);
    const includeHidden = request.data?.includeHidden === true;
    const db = admin.firestore();
    const snapshot = await db
      .collectionGroup("reviews")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const productIds = new Set();
    const reviews = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        const productRef = doc.ref.parent.parent;
        const productId = productRef?.id || data.productId || "";
        if (productId) productIds.add(productId);
        return {
          id: doc.id,
          reviewId: data.reviewId || doc.id,
          productId,
          userId: data.userId || "",
          userEmail: data.userEmail || "",
          userName: data.userName || "",
          rating: Number(data.rating || 0),
          comment: data.comment || "",
          visible: data.visible === true,
          status: data.status || (data.visible === true ? "approved" : "pending"),
          createdAt: serializeDate(data.createdAt || data.timestamp),
          updatedAt: serializeDate(data.updatedAt),
        };
      })
      .filter((review) => includeHidden || !["hidden", "archived"].includes(review.status));

    const productDocs = await Promise.all(
      [...productIds].map(async (productId) => {
        const snap = await db.collection("products").doc(productId).get();
        return [productId, snap.exists ? snap.data() : {}];
      }),
    );
    const products = Object.fromEntries(productDocs);

    return {
      reviews: reviews.map((review) => ({
        ...review,
        productName: products[review.productId]?.name ||
          products[review.productId]?.title ||
          review.productId ||
          "Product",
      })),
    };
  },
);
