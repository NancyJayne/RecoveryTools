
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Parser } from "json2csv";
import admin from "firebase-admin";

// ✅ Initialize Firebase Admin if not already
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 📤 Admin: Export all orders in CSV format
 */
export const exportAllOrdersCSV = onCall(
  { region: "australia-southeast1" }, // ✅ Scoped region
  async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can export orders.");
    }

    try {
      const snapshot = await admin.firestore().collection("orders").orderBy("purchasedAt", "desc").get();
      const orders = snapshot.docs.map((doc) => {
        const d = doc.data();
        return {
          invoiceNumber: d.invoiceNumber || doc.id,
          userId: d.userId || "",
          userEmail: d.userEmail || "",
          total: d.total || 0,
          gst: d.gst || 0,
          status: d.status || "Pending",
          referredBy: d.referredBy || "",
          referralEvent: d.referralEvent || "",
          purchasedAt: d.purchasedAt?.toDate().toISOString() || "",
        };
      });

      const parser = new Parser();
      const csv = parser.parse(orders);
      return { csv };
    } catch (err) {
      console.error("CSV export failed:", err);
      throw new HttpsError("internal", "Unable to export orders.");
    }
  },
);
