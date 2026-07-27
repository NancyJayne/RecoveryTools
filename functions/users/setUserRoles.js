import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * ✅ Admin-only set user roles function
 */
export const setUserRoles = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError(
        "permission-denied",
        "Only admins can assign roles.",
      );
    }

    const { uid, roles } = request.data || {};

    if (!uid || typeof roles !== "object") {
      throw new HttpsError(
        "invalid-argument",
        "Missing uid or roles object.",
      );
    }

    try {
      const normalizedRoles = {
        admin: !!roles.admin,
        affiliate: !!roles.affiliate,
        therapist: !!roles.therapist,
      };

      await admin.auth().setCustomUserClaims(uid, normalizedRoles);
      await admin.firestore().collection("users").doc(uid).set({
        roles: normalizedRoles,
        rolesUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        rolesUpdatedBy: request.auth.uid,
      }, { merge: true });
      const affiliateCollection = admin.firestore().collection("affiliates");
      const directAffiliateRef = affiliateCollection.doc(uid);
      const directAffiliateSnap = await directAffiliateRef.get();
      const matchedAffiliates = await affiliateCollection.where("userId", "==", uid).get();
      const affiliateRef = directAffiliateSnap.exists
        ? directAffiliateRef
        : (matchedAffiliates.docs[0]?.ref || directAffiliateRef);
      if (normalizedRoles.affiliate) {
        const userRecord = await admin.auth().getUser(uid);
        await affiliateRef.set({
          uid,
          userId: uid,
          email: userRecord.email || "",
          name: userRecord.displayName || "",
          status: "active",
          active: true,
          pickupEnabled: false,
          pickupApprovalStatus: "draft",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      } else {
        const refs = new Map([
          ...(directAffiliateSnap.exists ? [[directAffiliateRef.path, directAffiliateRef]] : []),
          ...matchedAffiliates.docs.map((entry) => [entry.ref.path, entry.ref]),
        ]);
        await Promise.all([...refs.values()].map((ref) => ref.set({
          status: "inactive",
          active: false,
          pickupEnabled: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true })));
      }

      return {
        success: true,
        uid,
        roles: normalizedRoles,
        message: `Roles updated for UID: ${uid}`,
      };
    } catch (error) {
      console.error("Error setting roles:", error);

      throw new HttpsError(
        "internal",
        error.message,
      );
    }
  },
);
