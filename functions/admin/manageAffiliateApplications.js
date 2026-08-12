import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import { defineSecret } from "firebase-functions/params";
import { getBusinessProfile } from "../utils/businessProfile.js";

if (!admin.apps.length) admin.initializeApp();

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();
const stamp = () => admin.firestore.FieldValue.serverTimestamp();

function requireAdmin(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
}

function dateValue(value) {
  return value?.toDate?.()?.toISOString?.() || value || null;
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendDecisionEmail({ email, name, status, notes }) {
  if (!email) return;
  const business = await getBusinessProfile();
  sgMail.setApiKey(SENDGRID_API_KEY.value());
  const approved = status === "active";
  const safeName = escapeHtml(name);
  const safeNotes = escapeHtml(notes);
  await sgMail.send({
    to: email,
    from: business.sender,
    subject: approved
      ? `Your ${business.name} affiliate application is approved`
      : `Update on your ${business.name} affiliate application`,
    html: approved
      ? `
        <h2>Welcome${safeName ? `, ${safeName}` : ""}!</h2>
        <p>Your affiliate application has been approved.</p>
        <p><a href="https://recoverytools.au/affiliate">Open your Affiliate Dashboard</a></p>
        ${safeNotes ? `<p><strong>Admin note:</strong> ${safeNotes}</p>` : ""}
      `
      : `
        <h2>Affiliate application update</h2>
        <p>Your application has not been approved at this time.</p>
        ${safeNotes ? `<p><strong>Reason:</strong> ${safeNotes}</p>` : ""}
        <p>You can update your details and submit a new application.</p>
      `,
  });
}

export const manageAffiliateApplications = onCall(
  {
    region: "australia-southeast1",
    secrets: [SENDGRID_API_KEY],
  },
  async (request) => {
    requireAdmin(request);
    const db = admin.firestore();
    const action = lower(request.data?.action || "list");

    if (action === "list") {
      const snapshot = await db.collection("affiliates").get();
      const applications = snapshot.docs
        .map((entry) => {
          const data = entry.data() || {};
          return {
            affiliateId: entry.id,
            userId: clean(data.userId || data.uid || entry.id),
            status: lower(data.status || "pending"),
            name: clean(data.name),
            email: clean(data.email),
            businessName: clean(data.businessName),
            abn: clean(data.abn),
            phone: clean(data.phone),
            address: clean(data.businessAddress || data.address),
            description: clean(data.description),
            website: clean(data.website),
            logoUrl: clean(data.logoUrl),
            timezone: clean(data.timezone),
            submittedAt: dateValue(data.applicationSubmittedAt || data.joinedAt),
            reviewedAt: dateValue(data.applicationReviewedAt),
            decisionNotes: clean(data.applicationDecisionNotes),
          };
        })
        .filter((entry) => ["pending", "rejected"].includes(entry.status))
        .sort((left, right) =>
          (left.status === "pending" ? 0 : 1) - (right.status === "pending" ? 0 : 1) ||
          String(right.submittedAt || "").localeCompare(String(left.submittedAt || "")));
      return { applications };
    }

    if (!["approve", "reject"].includes(action)) {
      throw new HttpsError("invalid-argument", "Choose approve or reject.");
    }
    const affiliateId = clean(request.data?.affiliateId);
    const notes = clean(request.data?.decisionNotes);
    if (!affiliateId) {
      throw new HttpsError("invalid-argument", "Affiliate application ID is required.");
    }
    const affiliateRef = db.collection("affiliates").doc(affiliateId);
    const affiliateSnap = await affiliateRef.get();
    if (!affiliateSnap.exists) {
      throw new HttpsError("not-found", "Affiliate application not found.");
    }
    const profile = affiliateSnap.data() || {};
    const uid = clean(profile.userId || profile.uid || affiliateId);
    const status = action === "approve" ? "active" : "rejected";
    const userRecord = await admin.auth().getUser(uid);
    const claims = userRecord.customClaims || {};
    const nextClaims = {
      ...claims,
      admin: claims.admin === true,
      affiliate: action === "approve",
      therapist: claims.therapist === true,
    };
    await admin.auth().setCustomUserClaims(uid, nextClaims);

    const batch = db.batch();
    batch.set(affiliateRef, {
      status,
      active: action === "approve",
      applicationReviewedAt: stamp(),
      applicationReviewedByUid: request.auth.uid,
      applicationDecisionNotes: notes,
      ...(action === "approve"
        ? { joinedAt: profile.joinedAt || stamp() }
        : { pickupEnabled: false }),
    }, { merge: true });
    batch.set(db.collection("users").doc(uid), {
      "roles.affiliate": action === "approve",
      affiliateApplicationStatus: status,
      rolesUpdatedAt: stamp(),
      rolesUpdatedBy: request.auth.uid,
      updatedAt: stamp(),
    }, { merge: true });
    try {
      await batch.commit();
    } catch (error) {
      await admin.auth().setCustomUserClaims(uid, claims);
      throw error;
    }

    let emailSent = true;
    try {
      await sendDecisionEmail({
        email: clean(profile.email || userRecord.email),
        name: clean(profile.name || userRecord.displayName),
        status,
        notes,
      });
    } catch (error) {
      emailSent = false;
      console.error("Affiliate decision email failed:", error);
    }
    return { success: true, status, emailSent };
  },
);
