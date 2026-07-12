import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import stripeLib from "stripe";
import { appBaseUrl, stripeSecretValue } from "../utils/stripeEnvironment.js";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_SECRET_KEY_TEST = defineSecret("STRIPE_SECRET_KEY_TEST");

if (!admin.apps.length) {
  admin.initializeApp();
}

export const createStripeConnectLink = onCall(
  {
    region: "australia-southeast1",
    secrets: [STRIPE_SECRET_KEY, STRIPE_SECRET_KEY_TEST],
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const stripe = stripeLib(stripeSecretValue({
      liveSecret: STRIPE_SECRET_KEY,
      testSecret: STRIPE_SECRET_KEY_TEST,
    }));

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

    const baseUrl = appBaseUrl();
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${baseUrl}/affiliate/register`,
      return_url: `${baseUrl}/profile`,
      type: "account_onboarding",
    });

    return { url: accountLink.url };
  },
);
