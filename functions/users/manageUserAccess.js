import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

export const manageUserAccess = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (request.auth?.token?.admin !== true) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }
    const accessRecordId = String(request.data?.accessRecordId || "").trim();
    const action = String(request.data?.action || "revoke").trim().toLowerCase();
    if (!accessRecordId || !["revoke", "restore"].includes(action)) {
      throw new HttpsError("invalid-argument", "Choose a valid access record and action.");
    }

    const db = admin.firestore();
    const ref = db.collection("userAccess").doc(accessRecordId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new HttpsError("not-found", "Access record not found.");

    const now = admin.firestore.FieldValue.serverTimestamp();
    const active = action === "restore";
    await ref.set({
      active,
      revokedAt: active ? null : now,
      revokedBy: active ? null : request.auth.uid,
      revocationReason: active ? null : "admin-crm",
      restoredAt: active ? now : null,
      restoredBy: active ? request.auth.uid : null,
      updatedAt: now,
      updatedBy: request.auth.uid,
    }, { merge: true });

    await db.collection("userAccessAudit").add({
      accessRecordId,
      userId: snapshot.data()?.userId || "",
      accessId: snapshot.data()?.accessId || snapshot.data()?.accessEntityId || "",
      accessType: snapshot.data()?.accessType || snapshot.data()?.accessEntityType || "",
      action,
      performedBy: request.auth.uid,
      createdAt: now,
    });
    return { success: true, accessRecordId, active };
  },
);
