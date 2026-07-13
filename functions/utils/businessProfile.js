import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const DEFAULT_BUSINESS_PROFILE = {
  name: "Recovery Tools",
  abn: "40833440028",
  address: "31 Cessna Dr\nCaboolture QLD 4511\nAustralia",
  phone: "",
  email: "hello@recoverytools.au",
  logoUrl:
    "https://firebasestorage.googleapis.com/v0/b/recovery-tools.firebasestorage.app/o/videos%2FImages%2FRecoveryToolsLogo.png?alt=media&token=ef83d768-30db-4889-a550-188f49b1ba2d",
  faviconUrl: "/favicon.svg",
  logoItemId: "",
  faviconItemId: "",
  termsItemId: "",
  privacyItemId: "",
  supportItemId: "",
  commerceItemId: "",
  seoTitle: "Recovery Tools",
  seoDescription: "Recovery Tools - Real Recovery, Real Results",
  aboutTitle: "About Recovery Tools",
  aboutDescription:
    [
      "Recovery Tools was created by clinicians who believe that recovery should not be confusing,",
      "expensive, or out of reach.",
    ].join(" "),
  aboutImageUrl: "",
  termsPdfUrl: "",
  privacyPdfUrl: "",
  supportPdfUrl: "",
  commercePdfUrl: "",
};

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeBusinessProfile(data = {}) {
  return {
    name: cleanString(data.name) || DEFAULT_BUSINESS_PROFILE.name,
    abn: cleanString(data.abn) || DEFAULT_BUSINESS_PROFILE.abn,
    address: cleanString(data.address) || DEFAULT_BUSINESS_PROFILE.address,
    phone: cleanString(data.phone) || DEFAULT_BUSINESS_PROFILE.phone,
    email: cleanString(data.email) || DEFAULT_BUSINESS_PROFILE.email,
    logoUrl: cleanString(data.logoUrl) || DEFAULT_BUSINESS_PROFILE.logoUrl,
    faviconUrl: cleanString(data.faviconUrl) || DEFAULT_BUSINESS_PROFILE.faviconUrl,
    logoItemId: cleanString(data.logoItemId) || DEFAULT_BUSINESS_PROFILE.logoItemId,
    faviconItemId: cleanString(data.faviconItemId) || DEFAULT_BUSINESS_PROFILE.faviconItemId,
    termsItemId: cleanString(data.termsItemId) || DEFAULT_BUSINESS_PROFILE.termsItemId,
    privacyItemId: cleanString(data.privacyItemId) || DEFAULT_BUSINESS_PROFILE.privacyItemId,
    supportItemId: cleanString(data.supportItemId) || DEFAULT_BUSINESS_PROFILE.supportItemId,
    commerceItemId: cleanString(data.commerceItemId) || DEFAULT_BUSINESS_PROFILE.commerceItemId,
    seoTitle: cleanString(data.seoTitle) || DEFAULT_BUSINESS_PROFILE.seoTitle,
    seoDescription: cleanString(data.seoDescription) || DEFAULT_BUSINESS_PROFILE.seoDescription,
    aboutTitle: cleanString(data.aboutTitle) || DEFAULT_BUSINESS_PROFILE.aboutTitle,
    aboutDescription: cleanString(data.aboutDescription) || DEFAULT_BUSINESS_PROFILE.aboutDescription,
    aboutImageUrl: cleanString(data.aboutImageUrl) || DEFAULT_BUSINESS_PROFILE.aboutImageUrl,
    termsPdfUrl: cleanString(data.termsPdfUrl) || DEFAULT_BUSINESS_PROFILE.termsPdfUrl,
    privacyPdfUrl: cleanString(data.privacyPdfUrl) || DEFAULT_BUSINESS_PROFILE.privacyPdfUrl,
    supportPdfUrl: cleanString(data.supportPdfUrl) || DEFAULT_BUSINESS_PROFILE.supportPdfUrl,
    commercePdfUrl: cleanString(data.commercePdfUrl) || DEFAULT_BUSINESS_PROFILE.commercePdfUrl,
  };
}

function isActiveStatus(value) {
  const status = cleanString(value).toLowerCase();
  return !status || status === "active" || status === "public";
}

function normalizedPurpose(value) {
  const purpose = cleanString(value).toLowerCase();
  if (purpose.includes("term")) return "terms";
  if (purpose.includes("privacy")) return "privacy";
  if (purpose.includes("commerce")) return "commerce";
  if (purpose.includes("support")) return "support";
  if (purpose.includes("favicon") || purpose.includes("icon")) return "favicon";
  if (purpose.includes("logo")) return "logo";
  return purpose;
}

function sortOrder(value) {
  const order = Number(value);
  return Number.isFinite(order) && value !== "" ? order : 999;
}

async function resolveItemAsset(db, itemId, preferredTypes = [], preferredPurpose = "") {
  const cleanItemId = cleanString(itemId);
  if (!cleanItemId) return null;

  const itemAssetsSnap = await db.collection("itemAssets")
    .where("itemId", "==", cleanItemId)
    .get();

  const links = itemAssetsSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((link) => isActiveStatus(link.displayStatus))
    .sort((a, b) => sortOrder(a.sortOrder) - sortOrder(b.sortOrder));

  const linkedAssets = await Promise.all(
    links.map(async (link) => {
      const assetId = cleanString(link.assetId);
      if (!assetId) return null;
      const snap = await db.collection("assets").doc(assetId).get();
      if (!snap.exists) return null;
      const asset = snap.data() || {};
      const url = cleanString(asset.fileUrl || asset.url || asset.FileURL);
      if (!url || !isActiveStatus(asset.status)) return null;
      return {
        assetId,
        itemAssetId: link.itemAssetId || link.id,
        type: cleanString(asset.type).toLowerCase(),
        purpose: normalizedPurpose(link.purpose),
        url,
        title: link.contextTitle || asset.title || asset.name || "",
      };
    }),
  );

  const assets = linkedAssets.filter(Boolean);
  const purposeMatches = preferredPurpose
    ? assets.filter((asset) => asset.purpose === preferredPurpose)
    : assets;
  return purposeMatches.find((asset) => preferredTypes.includes(asset.type)) ||
    purposeMatches[0] ||
    assets.find((asset) => preferredTypes.includes(asset.type)) ||
    assets[0] ||
    null;
}

async function resolveBusinessAssets(profile) {
  const db = admin.firestore();
  const [
    logo,
    favicon,
    terms,
    privacy,
    support,
    commerce,
  ] = await Promise.all([
    resolveItemAsset(db, profile.logoItemId, ["image", "logo"], "logo"),
    resolveItemAsset(db, profile.faviconItemId, ["image", "icon", "favicon"], "favicon"),
    resolveItemAsset(db, profile.termsItemId, ["pdf", "document"], "terms"),
    resolveItemAsset(db, profile.privacyItemId, ["pdf", "document"], "privacy"),
    resolveItemAsset(db, profile.supportItemId, ["pdf", "document"], "support"),
    resolveItemAsset(db, profile.commerceItemId, ["pdf", "document"], "commerce"),
  ]);

  return {
    ...profile,
    logoUrl: logo?.url || profile.logoUrl,
    logoAssetId: logo?.assetId || "",
    faviconUrl: favicon?.url || profile.faviconUrl,
    faviconAssetId: favicon?.assetId || "",
    termsPdfUrl: terms?.url || profile.termsPdfUrl,
    termsAssetId: terms?.assetId || "",
    privacyPdfUrl: privacy?.url || profile.privacyPdfUrl,
    privacyAssetId: privacy?.assetId || "",
    supportPdfUrl: support?.url || profile.supportPdfUrl,
    supportAssetId: support?.assetId || "",
    commercePdfUrl: commerce?.url || profile.commercePdfUrl,
    commerceAssetId: commerce?.assetId || "",
  };
}

export async function getBusinessProfile() {
  const snap = await admin.firestore().collection("settings").doc("business").get();
  return resolveBusinessAssets(normalizeBusinessProfile(snap.exists ? snap.data() : {}));
}

export function businessAddressLines(profile) {
  return String(profile.address || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
