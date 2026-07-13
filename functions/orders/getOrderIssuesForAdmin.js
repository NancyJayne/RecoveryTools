import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

function serializeDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate().toISOString();
  if (value.seconds) return new Date(value.seconds * 1000).toISOString();
  return null;
}

export const getOrderIssuesForAdmin = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can view order feedback.");
    }

    const limit = Math.min(Number(request.data?.limit || 100), 200);
    const includeArchived = request.data?.includeArchived === true;
    const snapshot = await admin.firestore()
      .collection("orderIssues")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return {
      issues: snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          issueId: data.issueId || doc.id,
          orderId: data.orderId || "",
          userId: data.userId || "",
          customerEmail: data.customerEmail || "",
          customerName: data.customerName || "",
          issueType: data.issueType || "",
          status: data.status || "",
          customerFollowUpStatus: data.customerFollowUpStatus || "",
          affectedItems: data.affectedItems || "",
          preferredOutcome: data.preferredOutcome || "",
          details: data.details || "",
          rating: Number(data.rating || 0),
          archived: data.archived === true || data.status === "archived",
          createdAt: serializeDate(data.createdAt),
          updatedAt: serializeDate(data.updatedAt),
        };
      }).filter((issue) => includeArchived || !issue.archived),
    };
  },
);
