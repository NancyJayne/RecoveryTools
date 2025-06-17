
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

// ✅ Initialize Firebase Admin if needed
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 📊 Admin dashboard stats: user count, order count, total sales
 */
export const getUserDashboardStats = onCall(
  { region: "australia-southeast1" }, // ✅ Scoped region only
  async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Admin access only.");
    }

    try {
      const [usersSnap, ordersSnap] = await Promise.all([
        admin.firestore().collection("users").get(),
        admin.firestore().collection("orders").get(),
      ]);

      const totalUsers = usersSnap.size;
      const totalOrders = ordersSnap.size;
      const totalRevenue = ordersSnap.docs.reduce((sum, doc) => sum + (doc.data().total || 0), 0);

      return { totalUsers, totalOrders, totalRevenue };
    } catch (err) {
      console.error("Dashboard stats error:", err);
      throw new HttpsError("internal", "Failed to load stats.");
    }
  },
);
