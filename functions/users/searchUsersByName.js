
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 🔍 Admin: Search users by full or partial name (Firestore only)
 */
export const searchUsersByName = onCall(
  { region: "australia-southeast1" },
  async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }

    const { nameQuery } = data;
    if (!nameQuery || typeof nameQuery !== "string") {
      throw new HttpsError("invalid-argument", "Missing or invalid name query.");
    }

    try {
      const snapshot = await admin.firestore()
        .collection("users")
        .where("name", ">=", nameQuery)
        .where("name", "<=", nameQuery + "\uf8ff")
        .limit(10)
        .get();

      const users = snapshot.docs.map((doc) => ({
        uid: doc.id,
        name: doc.data().name,
        email: doc.data().email || null,
        roles: doc.data().roles || {},
      }));

      return { users };
    } catch (err) {
      console.error("Search by name failed:", err);
      throw new HttpsError("internal", err.message);
    }
  },
);
