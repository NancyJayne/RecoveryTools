
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * ✅ Get All Orders (Admin)
 * Supports filters by invoice number, customer name, and date range.
 */
export const getAllOrdersForAdmin = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    const uid = context.auth?.uid;
    const token = context.auth?.token;

    if (!uid || !token?.admin) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }

    const { invoiceNumber, name, startDate, endDate } = data;
    let query = admin.firestore().collection("orders");

    if (invoiceNumber) {
      const doc = await query.doc(invoiceNumber).get();
      if (!doc.exists) {
        return { orders: [] };
      }
      return { orders: [{ id: doc.id, ...doc.data() }] };
    }

    if (name) {
      query = query
        .where("userName", ">=", name)
        .where("userName", "<=", name + "\uf8ff");
    }

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      query = query
        .where("purchasedAt", ">=", start)
        .where("purchasedAt", "<=", end);
    }

    const snapshot = await query.orderBy("purchasedAt", "desc").limit(50).get();
    const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return { orders };
  },
);
