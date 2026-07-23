import admin from "firebase-admin";

const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();

function dateValue(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function locationIsAvailable(location, now = new Date()) {
  if (location.active !== true || lower(location.approvalStatus) !== "approved") return false;
  const from = dateValue(location.availableFrom);
  const until = dateValue(location.availableUntil);
  return (!from || from <= now) && (!until || until >= now);
}

function addressText(location) {
  return [
    location.addressLine1,
    location.addressLine2,
    location.suburb,
    location.state,
    location.postcode,
    location.country,
  ].map(clean).filter(Boolean).join(", ");
}

function publicLocation(id, location, sourceType = location.locationType) {
  return {
    pickupLocationId: id,
    sourceType: lower(sourceType),
    locationName: clean(location.locationName) || "Pickup location",
    address: addressText(location),
    customerInstructions: clean(location.customerInstructions),
    contactName: clean(location.contactName),
    contactPhone: clean(location.contactPhone),
  };
}

async function selectedAffiliate(db, referrerId) {
  if (!referrerId) return null;
  const direct = await db.collection("affiliates").doc(referrerId).get();
  if (direct.exists) return { id: direct.id, ...direct.data() };
  const byUser = await db.collection("affiliates").where("userId", "==", referrerId).limit(1).get();
  return byUser.empty ? null : { id: byUser.docs[0].id, ...byUser.docs[0].data() };
}

export async function eligiblePickupLocations(db, {
  productId,
  variantId,
  referrerId,
}) {
  if (!variantId) return [];

  const [productSnap, variantSnap, locationSnap, linkSnap, affiliate] = await Promise.all([
    db.collection("products").doc(productId).get(),
    db.collection("productVariants").doc(variantId).get(),
    db.collection("pickupLocations").get(),
    db.collection("productVariantPickupLocations")
      .where("productVariantId", "==", variantId)
      .get(),
    selectedAffiliate(db, referrerId),
  ]);

  if (!productSnap.exists || !variantSnap.exists) return [];
  const product = productSnap.data() || {};
  const variant = variantSnap.data() || {};
  if (clean(variant.productId) && clean(variant.productId) !== clean(productId)) return [];

  const locations = new Map(
    locationSnap.docs
      .map((doc) => [doc.id, doc.data() || {}])
      .filter(([, location]) => locationIsAvailable(location)),
  );
  const options = [];
  const seen = new Set();
  const add = (option) => {
    if (!option || seen.has(option.pickupLocationId)) return;
    seen.add(option.pickupLocationId);
    options.push(option);
  };

  for (const linkDoc of linkSnap.docs) {
    const link = linkDoc.data() || {};
    if (link.active !== true) continue;
    const locationId = clean(link.pickupLocationId);
    const location = locations.get(locationId);
    if (!location) continue;
    if (lower(location.locationType) === "affiliate" &&
        (!affiliate || clean(location.affiliateId) !== affiliate.id)) continue;
    add(publicLocation(locationId, location));
  }

  if (affiliate &&
      affiliate.pickupEnabled === true &&
      lower(affiliate.pickupApprovalStatus) === "approved") {
    const affiliateLocations = [...locations.entries()]
      .filter(([, location]) =>
        lower(location.locationType) === "affiliate" &&
        clean(location.affiliateId) === affiliate.id)
      .sort(([leftId], [rightId]) => {
        const defaultId = clean(affiliate.defaultPickupLocationId);
        return Number(rightId === defaultId) - Number(leftId === defaultId);
      });
    affiliateLocations.forEach(([id, location]) => add(publicLocation(id, {
      ...location,
      contactName: location.contactName || affiliate.pickupContactName,
      contactPhone: location.contactPhone || affiliate.pickupContactPhone,
    }, "affiliate")));
  }

  const eventLocation = clean(variant.eventLocation);
  const deliveryContext = lower(variant.deliveryMode || product.productType);
  if (eventLocation && ["workshop registration", "hybrid"].includes(deliveryContext)) {
    add({
      pickupLocationId: `workshop:${variantId}`,
      sourceType: "workshop",
      locationName: clean(variant.name) || "Workshop pickup",
      address: eventLocation,
      customerInstructions: "Collect at the workshop session.",
      contactName: "",
      contactPhone: "",
    });
  }

  return options;
}

export function pickupLocationMetadata(location) {
  return {
    pickupLocationId: clean(location?.pickupLocationId),
    pickupSourceType: clean(location?.sourceType),
    pickupLocationName: clean(location?.locationName),
    pickupAddress: clean(location?.address),
    pickupInstructions: clean(location?.customerInstructions),
    pickupContactName: clean(location?.contactName),
    pickupContactPhone: clean(location?.contactPhone),
  };
}

export async function resolveSelectedPickupLocation(db, request) {
  const options = await eligiblePickupLocations(db, request);
  return options.find((option) =>
    option.pickupLocationId === clean(request.pickupLocationId)) || null;
}
