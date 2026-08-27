import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value) {
  return cleanString(value).toUpperCase().replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60);
}

export const upsertContentCategory = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can create content categories.");
    }
    const name = cleanString(request.data?.name).replace(/\s+/g, " ").slice(0, 100);
    if (!name) throw new HttpsError("invalid-argument", "Enter a category name.");

    const db = admin.firestore();
    const matching = await db.collection("categories").where("name", "==", name).limit(1).get();
    if (!matching.empty) {
      const existing = matching.docs[0];
      return { category: { id: existing.id, name: existing.data()?.name || name }, created: false };
    }

    const id = `CAT-${slugify(name)}`;
    if (id === "CAT-") {
      throw new HttpsError("invalid-argument", "Enter a category name containing letters or numbers.");
    }
    const ref = db.collection("categories").doc(id);
    const now = admin.firestore.FieldValue.serverTimestamp();
    let created = false;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) return;
      transaction.create(ref, {
        categoryId: id, name, status: "active", contentOrigin: "app", managedByWorkbook: false,
        createdAt: now, updatedAt: now, createdByUid: request.auth.uid,
        createdByEmail: request.auth.token.email || null,
      });
      created = true;
    });
    const saved = await ref.get();
    return { category: { id, name: saved.data()?.name || name }, created };
  },
);
