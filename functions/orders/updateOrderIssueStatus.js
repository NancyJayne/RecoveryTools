import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const VALID_STATUSES = new Set(["open", "resolved", "archived"]);

export const updateOrderIssueStatus = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can update order feedback.");
    }

    const issueId = String(request.data?.issueId || "").trim();
    const status = String(request.data?.status || "").toLowerCase().trim();

    if (!issueId) {
      throw new HttpsError("invalid-argument", "Issue ID is required.");
    }

    if (!VALID_STATUSES.has(status)) {
      throw new HttpsError("invalid-argument", "Invalid issue status.");
    }

    const update = {
      status,
      archived: status === "archived",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: request.auth.uid,
      updatedByEmail: request.auth.token.email || "",
    };

    if (status === "archived") {
      update.archivedAt = admin.firestore.FieldValue.serverTimestamp();
      update.archivedByUid = request.auth.uid;
      update.archivedByEmail = request.auth.token.email || "";
    }

    await admin.firestore().collection("orderIssues").doc(issueId).update(update);

    return { success: true, status };
  },
);
