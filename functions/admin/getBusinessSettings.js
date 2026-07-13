import { onCall } from "firebase-functions/v2/https";
import { getBusinessProfile } from "../utils/businessProfile.js";

export const getBusinessSettings = onCall(
  { region: "australia-southeast1" },
  async () => getBusinessProfile(),
);
