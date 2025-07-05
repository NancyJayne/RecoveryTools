//shop-reviews.js – Displays & submits product reviews with secure reCAPTCHA
import {
  collection,
  query,
  orderBy,
  getDocs,
} from "firebase/firestore";
import { auth, db } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";
import { executeRecaptcha } from "../utils/verifyRecaptchaToken.js"; // ✅ Secure backend check

// ✅ Load product reviews
export async function renderProductReviews(productId) {
  const container = document.getElementById("reviews");
  container.innerHTML = `<h4 class="text-lg font-semibold mb-2">Reviews</h4>`;

  try {
    const q = query(
      collection(db, `products/${productId}/reviews`),
      orderBy("timestamp", "desc"),
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      container.innerHTML += `
        <p class="italic text-gray-500">No reviews yet. Be the first to leave one below!</p>
      `;
      return;
    }

    snapshot.forEach((doc) => {
      const { userName, comment, rating } = doc.data();
      const reviewEl = document.createElement("div");
      reviewEl.className = "mb-4";

      reviewEl.innerHTML = `
        <p class="font-bold">${userName || "Anonymous"}</p>
        <p class="text-yellow-400 text-sm mb-1">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</p>
        <p class="text-sm text-gray-400">${comment}</p>
      `;

      container.appendChild(reviewEl);
    });
  } catch (err) {
    console.error("❌ Failed to load reviews:", err);
    container.innerHTML += `<p class="text-red-400">Error loading reviews. Please try again later.</p>`;
  }
}

// ✅ Setup review submission form with backend reCAPTCHA verification
export function setupReviewForm(productId) {
  const form = document.getElementById("reviewForm");
  if (!form) return;

  form.onsubmit = async (e) => {
    e.preventDefault();

    const user = auth?.currentUser;
    if (!user) {
      showToast("Please log in to leave a review.", "error");
      return;
    }

    const nameInput = document.getElementById("reviewName");
    const ratingInput = document.getElementById("reviewRating");
    const commentInput = document.getElementById("reviewComment");
    const submitBtn = form.querySelector("button[type='submit']");

    const userName = nameInput?.value.trim() || "Anonymous";
    const rating = parseInt(ratingInput?.value);
    const comment = commentInput?.value.trim();

    if (!rating || !comment) {
      showToast("Please select a rating and enter a comment.", "error");
      commentInput?.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
      const token = await executeRecaptcha("review_submission");

      const submitReview = functions.httpsCallable("submitProductReview");
      await submitReview({
        productId,
        userName,
        rating,
        comment,
        token,
      });

      showToast("✅ Review submitted for approval.", "success");
      form.reset();
      // Optionally reload reviews:
      // await renderProductReviews(productId);
    } catch (err) {
      console.error("❌ Review submission error:", err);
      showToast("Error submitting review. Please try again later.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Review";
    }
  };
}
