import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import stripeLib from "stripe";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");

if (!admin.apps.length) {
  admin.initializeApp();
}

export const createStripeConnectLink = onCall(
  {
    region: "australia-southeast1",
    secrets: [STRIPE_SECRET_KEY],
  },
  async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const stripe = stripeLib(STRIPE_SECRET_KEY.value());

    const userDocRef = admin.firestore().collection("users").doc(uid);
    const userDoc = await userDocRef.get();
    const email = userDoc.data()?.email;

    if (!email) {
      throw new HttpsError("invalid-argument", "Email not found for user.");
    }

    let stripeAccountId = userDoc.data()?.stripeAccountId;

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "AU",
        email,
        capabilities: {
          transfers: { requested: true },
        },
      });

      stripeAccountId = account.id;

      const affiliateRef = admin.firestore().collection("affiliates").doc(uid);
      await Promise.all([
        userDocRef.update({ stripeAccountId }),
        affiliateRef.set({ stripeAccountId }, { merge: true }),
      ]);
    }

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: "https://recoverytools.au/affiliate/register",
      return_url: "https://recoverytools.au/profile",
      type: "account_onboarding",
    });

    return { url: accountLink.url };
  },
);
