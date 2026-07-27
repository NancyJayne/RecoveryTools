import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();
const APPLICATION_STATUSES = new Set(["pending", "active", "rejected"]);

function applicationResult(snapshot) {
  if (!snapshot.exists) return { exists: false, status: "not_submitted" };
  const data = snapshot.data() || {};
  const status = APPLICATION_STATUSES.has(lower(data.status))
    ? lower(data.status)
    : "pending";
  return {
    exists: true,
    status,
    submittedAt: data.applicationSubmittedAt || data.joinedAt || null,
    reviewedAt: data.applicationReviewedAt || null,
    decisionNotes: status === "rejected" ? clean(data.applicationDecisionNotes) : "",
  };
}

/**
 * Creates an application only. Affiliate access is granted separately by an
 * administrator through manageAffiliateApplications.
 */
export const registerAffiliate = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    const uid = request.auth?.uid;
    const email = request.auth?.token?.email;
    if (!uid || !email) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    try {
      const db = admin.firestore();
      const data = request.data || {};
      const affiliateRef = db.collection("affiliates").doc(uid);
      const userRef = db.collection("users").doc(uid);
      const affiliateSnap = await affiliateRef.get();

      if (lower(data.action) === "status") {
        return applicationResult(affiliateSnap);
      }
      if (affiliateSnap.exists) {
        const existing = applicationResult(affiliateSnap);
        if (["pending", "active"].includes(existing.status)) return existing;
      }

      const required = {
        name: clean(data.name),
        businessName: clean(data.businessName),
        abn: clean(data.abn),
        phone: clean(data.phone),
        address: clean(data.address),
        timezone: clean(data.timezone),
      };
      const missing = Object.entries(required)
        .filter(([, value]) => !value)
        .map(([field]) => field);
      if (missing.length) {
        throw new HttpsError(
          "invalid-argument",
          `Missing required application fields: ${missing.join(", ")}.`,
        );
      }
      if (data.acceptedTerms !== true ||
          data.acceptedPrivacy !== true ||
          data.acceptedAffiliateAgreement !== true) {
        throw new HttpsError(
          "failed-precondition",
          "Terms, Privacy Policy, and Affiliate Agreement must be accepted.",
        );
      }

      const referralCode = email
        .split("@")[0]
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase();
      const now = admin.firestore.FieldValue.serverTimestamp();
      await affiliateRef.set({
        uid,
        userId: uid,
        email,
        referralCode,
        name: required.name,
        abn: required.abn,
        businessName: required.businessName,
        businessAddress: required.address,
        phone: required.phone,
        description: clean(data.description),
        logoUrl: clean(data.logoUrl),
        timezone: required.timezone,
        website: clean(data.website),
        stripeAccountId: "",
        status: "pending",
        active: false,
        pickupEnabled: false,
        pickupApprovalStatus: "draft",
        applicationSubmittedAt: now,
        applicationReviewedAt: null,
        applicationReviewedByUid: "",
        applicationDecisionNotes: "",
        acceptedTermsAt: now,
        acceptedPrivacyAt: now,
        acceptedAffiliateAgreementAt: now,
        earnings: 0,
      }, { merge: true });
      await userRef.set({
        affiliateApplicationStatus: "pending",
        referralCode,
        updatedAt: now,
      }, { merge: true });
      return { success: true, exists: true, status: "pending", referralCode };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("Affiliate registration failed:", error);
      throw new HttpsError("internal", error.message);
    }
  },
);
