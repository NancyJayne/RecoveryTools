import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import sgMail from "@sendgrid/mail";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

if (!admin.apps?.length) {
  admin.initializeApp();
}

export const onNewReview = onDocumentCreated(
  {
    region: "australia-southeast1",
    document: "products/{productId}/reviews/{reviewId}",
    secrets: [SENDGRID_API_KEY],
  },
  async (event) => {
    const { productId, reviewId } = event.params;
    const review = event.data?.data();

    if (!review || review.visible === true) return;

    try {
      // ✅ Use deployed secret or fallback to env var locally
      const apiKey = event.secrets?.SENDGRID_API_KEY || process.env.SENDGRID_API_KEY;
      if (!apiKey) throw new Error("No SendGrid API key found");

      sgMail.setApiKey(apiKey);

      const productSnap = await admin.firestore().doc(`products/${productId}`).get();
      const product = productSnap.exists ? productSnap.data() : { name: productId };

      const approvalLink = `https://recoverytools.au/admin/reviews?product=${productId}&review=${reviewId}`;

      await sgMail.send({
        to: "hello@recoverytools.au",
        from: "hello@recoverytools.au",
        subject: "🔔 New Product Review Awaiting Approval",
        html: `
          <p>A new review was submitted for <strong>${product.name}</strong>.</p>
          <p><strong>Rating:</strong> ${review.rating} stars</p>
          <p><strong>Comment:</strong> ${review.comment}</p>
          <p><a href="${approvalLink}" target="_blank" style="color:#407471;">Review & Approve in Admin Panel</a></p>
        `,
      });

      console.log(`📨 Email sent for new review on ${productId}`);
    } catch (err) {
      console.error("❌ Failed to send review notification:", err);
    }
  },
);
