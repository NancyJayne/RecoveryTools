import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const NESTED_BACKUP_COLLECTION_GROUPS = [
  "orders",
  "purchases",
  "workshopTickets",
  "reviews",
  "customerIssues",
  "comments",
];

function toPlainJson(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.toBase64 === "function") return value.toBase64();
  if (typeof value.path === "string" && value.firestore) {
    return { __type: "reference", path: value.path };
  }
  if (typeof value.latitude === "number" && typeof value.longitude === "number") {
    return { __type: "geopoint", latitude: value.latitude, longitude: value.longitude };
  }
  if (Array.isArray(value)) return value.map(toPlainJson);
  if (typeof value !== "object") return value;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) output[key] = toPlainJson(entry);
  }
  return output;
}

function backupTimestamp(value) {
  return value.replace(/[:.]/g, "-");
}

export async function buildContentBackup(db, options = {}) {
  const exportedAt = options.exportedAt || new Date().toISOString();
  const [settingsSnapshot, rootCollectionRefs] = await Promise.all([
    db.collection("settings").doc("contentBuilderOptions").get(),
    db.listCollections(),
  ]);

  const collections = {};
  const counts = {};
  const sortedRootRefs = [...rootCollectionRefs].sort((left, right) => left.id.localeCompare(right.id));
  const rootSnapshots = await Promise.all(sortedRootRefs.map((collection) => collection.get()));
  sortedRootRefs.forEach((collection, index) => {
    const rows = rootSnapshots[index].docs.map((doc) => ({
      id: doc.id,
      ...toPlainJson(doc.data()),
    }));
    collections[collection.id] = rows;
    counts[collection.id] = rows.length;
  });

  const nestedCollections = {};
  const nestedCounts = {};
  const nestedSnapshots = await Promise.all(
    NESTED_BACKUP_COLLECTION_GROUPS.map((collection) => db.collectionGroup(collection).get()),
  );
  nestedSnapshots.forEach((snapshot) => {
    snapshot.docs.forEach((doc) => {
      const parentDocument = doc.ref.parent.parent;
      if (!parentDocument) return;
      const collectionPath = doc.ref.parent.path;
      if (!nestedCollections[collectionPath]) nestedCollections[collectionPath] = [];
      nestedCollections[collectionPath].push({
        id: doc.id,
        ...toPlainJson(doc.data()),
      });
    });
  });
  for (const collectionPath of Object.keys(nestedCollections).sort()) {
    nestedCollections[collectionPath].sort((left, right) => left.id.localeCompare(right.id));
    nestedCounts[collectionPath] = nestedCollections[collectionPath].length;
  }

  return {
    manifest: {
      schemaVersion: 2,
      backupType: "recovery-tools-full",
      exportedAt,
      projectId: options.projectId || process.env.GCLOUD_PROJECT || admin.app().options.projectId || null,
      requestedByUid: options.requestedByUid || null,
      requestedByEmail: options.requestedByEmail || null,
      collectionCounts: counts,
      nestedCollectionCounts: nestedCounts,
      containsSensitiveData: true,
      safetyNote: "Read-only full Firestore backup containing customer and order data. Store it securely. " +
        "Firebase Authentication credentials and Cloud Storage file bytes are not included.",
    },
    settings: {
      contentBuilderOptions: settingsSnapshot.exists
        ? { id: settingsSnapshot.id, ...toPlainJson(settingsSnapshot.data()) }
        : null,
    },
    collections,
    nestedCollections,
    suggestedFileName: `recovery-tools-full-backup-${backupTimestamp(exportedAt)}.json`,
  };
}

export const exportContentBackup = onCall(
  { region: "australia-southeast1", timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Only admins can download full backups.");
    }

    try {
      return await buildContentBackup(admin.firestore(), {
        requestedByUid: request.auth.uid,
        requestedByEmail: request.auth.token.email || null,
      });
    } catch (error) {
      console.error("Full backup export failed:", error);
      throw new HttpsError("internal", "The full backup could not be generated.");
    }
  },
);
