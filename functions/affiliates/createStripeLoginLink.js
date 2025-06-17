import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import stripeLib from "stripe";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");

if (!admin.apps.length) {
  admin.initializeApp();
}

export const createStripeLoginLink = onCall(
  {
    region: "australia-southeast1",
    secrets: [STRIPE_SECRET_KEY],
  },
  async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be logged in to access Stripe.");
    }

    const stripe = stripeLib(STRIPE_SECRET_KEY.value());

    const userDocRef = admin.firestore().collection("users").doc(uid);
    const userDoc = await userDocRef.get();
    let stripeAccountId = userDoc.data()?.stripeAccountId;

    if (!stripeAccountId) {
      const affiliateDoc = await admin.firestore().collection("affiliates").doc(uid).get();
      stripeAccountId = affiliateDoc.exists ? affiliateDoc.data()?.stripeAccountId : null;
    }

    if (!stripeAccountId) {
      throw new HttpsError(
        "failed-precondition",
        "We couldn’t find a Stripe account connected to your profile.",
        "Please complete your affiliate registration or try again later.",
      );
    }

    const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
    return { url: loginLink.url };
  },
);
