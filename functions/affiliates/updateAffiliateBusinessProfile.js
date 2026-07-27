import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const clean = (value, max = 300) => String(value ?? "").trim().slice(0, max);
const stamp = () => admin.firestore.FieldValue.serverTimestamp();

function pickupAddress(data = {}) {
  return {
    addressLine1: clean(data.addressLine1, 200),
    addressLine2: clean(data.addressLine2, 200),
    suburb: clean(data.suburb, 100),
    state: clean(data.state, 30).toUpperCase(),
    postcode: clean(data.postcode, 20),
    country: clean(data.country || "Australia", 100),
  };
}

async function affiliateRecord(db, uid) {
  const direct = await db.collection("affiliates").doc(uid).get();
  if (direct.exists) return direct;
  const match = await db.collection("affiliates").where("userId", "==", uid).limit(1).get();
  return match.empty ? null : match.docs[0];
}

export const updateAffiliateBusinessProfile = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to update your affiliate profile.");
    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists || userSnap.data()?.roles?.affiliate !== true) {
      throw new HttpsError("permission-denied", "An active affiliate role is required.");
    }
    const affiliateSnap = await affiliateRecord(db, uid);
    if (!affiliateSnap) throw new HttpsError("not-found", "Affiliate profile not found.");

    const data = request.data || {};
    if (data.action === "get") {
      const profile = affiliateSnap.data() || {};
      const locationSnap = profile.defaultPickupLocationId
        ? await db.collection("pickupLocations").doc(profile.defaultPickupLocationId).get()
        : null;
      const location = locationSnap?.exists ? locationSnap.data() || {} : {};
      return {
        profile: {
          businessName: clean(profile.businessName, 200),
          businessAddress: clean(profile.businessAddress, 500),
          businessEmail: clean(profile.businessEmail || profile.email, 254),
          businessPhone: clean(profile.businessPhone || profile.phone, 50),
          website: clean(profile.website, 300),
          pickupEnabled: profile.pickupEnabled === true,
          pickupApprovalStatus: clean(profile.pickupApprovalStatus || "draft", 30),
          pickupLocation: {
            locationName: clean(location.locationName, 200),
            addressLine1: clean(location.addressLine1, 200),
            addressLine2: clean(location.addressLine2, 200),
            suburb: clean(location.suburb, 100),
            state: clean(location.state, 30),
            postcode: clean(location.postcode, 20),
            country: clean(location.country || "Australia", 100),
          },
        },
      };
    }
    const pickupEnabled = data.pickupEnabled === true;
    const address = pickupAddress(data.pickupLocation);
    const hasCompletePickupAddress = Boolean(
      address.addressLine1 && address.suburb && address.state && address.postcode,
    );
    if (pickupEnabled && !hasCompletePickupAddress) {
      throw new HttpsError(
        "invalid-argument",
        "Complete the pickup street address, suburb, state and postcode.",
      );
    }

    const locationId = `affiliate-${affiliateSnap.id}`;
    const batch = db.batch();
    batch.set(affiliateSnap.ref, {
      businessName: clean(data.businessName, 200),
      businessAddress: clean(data.businessAddress, 500),
      businessEmail: clean(data.businessEmail, 254).toLowerCase(),
      businessPhone: clean(data.businessPhone, 50),
      website: clean(data.website, 300),
      pickupEnabled,
      pickupApprovalStatus: pickupEnabled ? "pending" : "draft",
      defaultPickupLocationId: pickupEnabled ? locationId : "",
      updatedAt: stamp(),
    }, { merge: true });
    batch.set(db.collection("users").doc(uid), {
      businessName: clean(data.businessName, 200),
      businessAddress: clean(data.businessAddress, 500),
      businessEmail: clean(data.businessEmail, 254).toLowerCase(),
      businessPhone: clean(data.businessPhone, 50),
      businessWebsite: clean(data.website, 300),
      updatedAt: stamp(),
    }, { merge: true });
    batch.set(db.collection("pickupLocations").doc(locationId), {
      ...address,
      affiliateId: affiliateSnap.id,
      locationType: "affiliate",
      locationName: clean(data.locationName, 200) ||
        clean(data.businessName, 200) || "Affiliate pickup",
      active: pickupEnabled,
      approvalStatus: pickupEnabled ? "pending" : "draft",
      updatedAt: stamp(),
      updatedByUid: uid,
    }, { merge: true });
    await batch.commit();
    return {
      success: true,
      pickupApprovalStatus: pickupEnabled ? "pending" : "draft",
    };
  },
);
