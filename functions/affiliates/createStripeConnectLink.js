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

    try {
      const stripe = stripeLib(stripeSecretValue({
        liveSecret: STRIPE_SECRET_KEY,
        testSecret: STRIPE_SECRET_KEY_TEST,
      }));
      const db = admin.firestore();
      const userDocRef = db.collection("users").doc(uid);
      const affiliateRef = db.collection("affiliates").doc(uid);
      const [userDoc, affiliateDoc] = await Promise.all([
        userDocRef.get(),
        affiliateRef.get(),
      ]);
      const affiliate = affiliateDoc.data() || {};
      if (!affiliateDoc.exists ||
          String(affiliate.status || "").toLowerCase() !== "active" ||
          request.auth.token?.affiliate !== true) {
        throw new HttpsError(
          "permission-denied",
          "Only approved affiliates can connect a Stripe payout account.",
        );
      }
      const email = userDoc.data()?.email || affiliate.email || request.auth.token?.email;
      if (!email) {
        throw new HttpsError("failed-precondition", "Add an email address to your profile first.");
      }

      let stripeAccountId = userDoc.data()?.stripeAccountId || affiliate.stripeAccountId;
      if (!stripeAccountId) {
        const account = await stripe.accounts.create({
          type: "express",
          country: "AU",
          email,
          capabilities: {
            transfers: { requested: true },
          },
          metadata: {
            firebaseUid: uid,
            affiliateId: affiliateDoc.id,
          },
        });
        stripeAccountId = account.id;
        await Promise.all([
          userDocRef.set({ stripeAccountId }, { merge: true }),
          affiliateRef.set({ stripeAccountId }, { merge: true }),
        ]);
      }

      const baseUrl = appBaseUrl();
      const settingsUrl = `${baseUrl}/affiliate?panel=affiliateSettingsTab`;
      const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: `${settingsUrl}&stripe=refresh`,
        return_url: `${settingsUrl}&stripe=return`,
        type: "account_onboarding",
      });
      return { url: accountLink.url };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("Stripe Connect onboarding failed:", error);
      if (String(error?.message || "").includes("signed up for Connect")) {
        throw new HttpsError(
          "failed-precondition",
          "Stripe Connect is not enabled for Recovery Tools yet. " +
          "The Recovery Tools Stripe account owner must activate Connect in the Stripe Dashboard.",
        );
      }
      throw new HttpsError(
        "internal",
        "Stripe onboarding could not be started. Please try again or contact Recovery Tools.",
      );
    }
  },
);
