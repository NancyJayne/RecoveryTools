import { onCall } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const lower = (value) => String(value ?? "").trim().toLowerCase();
const clean = (value) => String(value ?? "").trim();

function dateValue(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function availablePickupLocation(location, now = new Date()) {
  if (location.active !== true || lower(location.approvalStatus) !== "approved") return false;
  const from = dateValue(location.availableFrom);
  const until = dateValue(location.availableUntil);
  return (!from || from <= now) && (!until || until >= now);
}

function publicPickupLocation(id, location) {
  return {
    pickupLocationId: id,
    locationName: clean(location.locationName) || "Pickup location",
    address: [
      location.addressLine1,
      location.addressLine2,
      location.suburb,
      location.state,
      location.postcode,
      location.country,
    ].map(clean).filter(Boolean).join(", "),
  };
}

export const getCheckoutAffiliates = onCall(
  { region: "australia-southeast1" },
  async () => {
    const db = admin.firestore();
    const [snapshot, pickupSnapshot] = await Promise.all([
      db.collection("affiliates").get(),
      db.collection("pickupLocations").get(),
    ]);
    const active = snapshot.docs.filter((doc) => {
      const data = doc.data() || {};
      return ["active", "approved"].includes(lower(data.status)) || data.approved === true;
    });
    const users = await Promise.all(active.map((doc) => {
      const userId = String(doc.data()?.userId || doc.id).trim();
      return userId ? db.collection("users").doc(userId).get() : null;
    }));
    const pickupLocations = pickupSnapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((location) =>
        lower(location.locationType) === "affiliate" &&
        availablePickupLocation(location) &&
        Boolean(clean(location.addressLine1)) &&
        Boolean(clean(location.suburb)) &&
        Boolean(clean(location.state)) &&
        Boolean(clean(location.postcode)));
    return {
      affiliates: active.map((doc, index) => {
        const data = doc.data() || {};
        const user = users[index]?.exists ? users[index].data() || {} : {};
        if (user.roles?.affiliate !== true) return null;
        const affiliatePickupLocations = pickupLocations
          .filter((location) => clean(location.affiliateId) === doc.id)
          .sort((left, right) =>
            Number(right.id === clean(data.defaultPickupLocationId)) -
            Number(left.id === clean(data.defaultPickupLocationId)));
        const pickupLocation = affiliatePickupLocations[0];
        return {
          affiliateId: doc.id,
          businessName: data.businessName || user.business?.name || user.businessName ||
            user.name || data.name || data.affiliateCode || doc.id,
          pickupAvailable:
            data.pickupEnabled === true &&
            lower(data.pickupApprovalStatus) === "approved" &&
            Boolean(pickupLocation),
          pickupLocation: pickupLocation
            ? publicPickupLocation(pickupLocation.id, pickupLocation)
            : null,
        };
      }).filter(Boolean).sort((left, right) => left.businessName.localeCompare(right.businessName)),
    };
  },
);
