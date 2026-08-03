import { onCall } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { getBusinessProfile } from "../utils/businessProfile.js";

export const getBusinessSettings = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    const business = await getBusinessProfile();
    if (request.auth?.token?.admin !== true) return business;
    const snapshot = await admin.firestore().collection("assets").get();
    const documentAssets = snapshot.docs
      .map((doc) => ({ assetId: doc.id, ...doc.data() }))
      .filter((asset) => {
        const type = String(asset.assetType || asset.type || "").trim().toLowerCase();
        const status = String(asset.status || "active").trim().toLowerCase();
        return ["pdf", "document"].includes(type) && !["archived", "inactive"].includes(status);
      })
      .map((asset) => ({
        assetId: asset.assetId,
        name: asset.title || asset.assetName || asset.name || asset.assetId,
        type: asset.assetType || asset.type || "document",
        url: asset.fileUrl || asset.url || "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ...business, documentAssets };
  },
);
