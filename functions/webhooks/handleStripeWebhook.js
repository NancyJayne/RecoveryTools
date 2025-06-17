// functions/webhooks/handleStripeWebhook.js
import { onRequest } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import stripeLib from "stripe";
import { defineSecret } from "firebase-functions/params";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

if (!admin.apps.length) {
  admin.initializeApp();
}

export const handleStripeWebhook = onRequest(
  {
    region: "australia-southeast1",
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
  },
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const stripe = stripeLib(STRIPE_SECRET_KEY.value());
    const endpointSecret = STRIPE_WEBHOOK_SECRET.value();
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err) {
      console.error("Webhook signature verification failed.", err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const { metadata, customer_details, shipping } = session;
      const firebaseUID = metadata?.firebaseUID;
      const invoiceId = session.id;

      try {
        await admin.firestore().collection("orders").doc(invoiceId).set(
          {
            id: invoiceId,
            userId: firebaseUID,
            email: customer_details?.email || null,
            shipping: {
              name: shipping?.name || null,
              address: shipping?.address || null,
            },
            metadata: metadata || {},
            status: "paid",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        console.log(`✅ Webhook processed and shipping saved for order: ${invoiceId}`);
      } catch (err) {
        console.error("❌ Failed to write webhook data to Firestore:", err);
        return res.status(500).send("Failed to log Stripe event.");
      }
    }

    res.status(200).send("Received");
  },
);
