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

    const requestedLimit = Number(request.data?.limit || 100);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
      : 100;
    const includeHidden = request.data?.includeHidden === true;
    const db = admin.firestore();
    // Avoid requiring a collection-group index for createdAt. Some legacy
    // reviews also use timestamp, so sorting after serialization keeps both
    // record shapes visible in the admin portal.
    const snapshot = await db.collectionGroup("reviews").get();

    const reviews = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        const productRef = doc.ref.parent.parent;
        const productId = productRef?.id || data.productId || "";
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
      .filter((review) => includeHidden || !["hidden", "archived"].includes(review.status))
      .sort((left, right) => {
        const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
        const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
        return rightTime - leftTime;
      })
      .slice(0, limit);

    const productIds = new Set(reviews.map((review) => review.productId).filter(Boolean));
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
