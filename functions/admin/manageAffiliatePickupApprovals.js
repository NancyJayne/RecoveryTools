import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();
const stamp = () => admin.firestore.FieldValue.serverTimestamp();

function requireAdmin(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
}

function addressText(location = {}) {
  return [
    location.addressLine1,
    location.addressLine2,
    location.suburb,
    location.state,
    location.postcode,
    location.country,
  ].map(clean).filter(Boolean).join(", ");
}

export const manageAffiliatePickupApprovals = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    requireAdmin(request);
    const db = admin.firestore();
    const action = lower(request.data?.action || "list");

    if (action === "list") {
      const [affiliateSnapshot, locationSnapshot] = await Promise.all([
        db.collection("affiliates").get(),
        db.collection("pickupLocations").where("locationType", "==", "affiliate").get(),
      ]);
      const affiliates = new Map(affiliateSnapshot.docs.map((entry) => [
        entry.id,
        { id: entry.id, ...entry.data() },
      ]));
      const requests = locationSnapshot.docs.map((entry) => {
        const location = entry.data() || {};
        const affiliate = affiliates.get(clean(location.affiliateId)) || {};
        return {
          pickupLocationId: entry.id,
          affiliateId: clean(location.affiliateId),
          userId: clean(affiliate.userId || affiliate.uid),
          businessName: clean(affiliate.businessName || affiliate.name || affiliate.email),
          locationName: clean(location.locationName),
          address: addressText(location),
          enabled: affiliate.pickupEnabled === true,
          approvalStatus: lower(
            affiliate.pickupApprovalStatus || location.approvalStatus || "draft",
          ),
          updatedAt: location.updatedAt || affiliate.updatedAt || null,
        };
      }).filter((entry) =>
        entry.enabled || ["pending", "approved", "rejected"].includes(entry.approvalStatus));
      requests.sort((left, right) => {
        const priority = { pending: 0, draft: 1, approved: 2, rejected: 3 };
        return (priority[left.approvalStatus] ?? 9) -
          (priority[right.approvalStatus] ?? 9) ||
          left.businessName.localeCompare(right.businessName);
      });
      return { requests };
    }

    if (!["approve", "reject"].includes(action)) {
      throw new HttpsError("invalid-argument", "Choose approve or reject.");
    }
    const pickupLocationId = clean(request.data?.pickupLocationId);
    if (!pickupLocationId) {
      throw new HttpsError("invalid-argument", "Pickup location ID is required.");
    }
    const locationRef = db.collection("pickupLocations").doc(pickupLocationId);
    const locationSnap = await locationRef.get();
    if (!locationSnap.exists) throw new HttpsError("not-found", "Pickup location not found.");
    const location = locationSnap.data() || {};
    const affiliateId = clean(location.affiliateId);
    const affiliateRef = db.collection("affiliates").doc(affiliateId);
    const affiliateSnap = await affiliateRef.get();
    if (!affiliateSnap.exists) throw new HttpsError("not-found", "Affiliate profile not found.");
    const approvalStatus = action === "approve" ? "approved" : "rejected";
    const active = action === "approve";
    const batch = db.batch();
    batch.set(locationRef, {
      approvalStatus,
      active,
      reviewedAt: stamp(),
      reviewedByUid: request.auth.uid,
    }, { merge: true });
    batch.set(affiliateRef, {
      pickupApprovalStatus: approvalStatus,
      pickupEnabled: active,
      defaultPickupLocationId: active ? pickupLocationId : "",
      pickupReviewedAt: stamp(),
      pickupReviewedByUid: request.auth.uid,
    }, { merge: true });
    await batch.commit();
    return { success: true, approvalStatus };
  },
);
