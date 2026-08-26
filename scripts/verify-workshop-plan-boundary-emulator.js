/* global process, console */
import assert from "node:assert/strict";
import admin from "../functions/node_modules/firebase-admin/lib/index.js";
import { createContentBuilderRecord } from "../functions/admin/createContentBuilderRecord.js";
import { getContentBuilderData } from "../functions/admin/getContentBuilderData.js";
import { updateContentControlRecord } from "../functions/admin/updateContentControlRecord.js";

assert(process.env.FIRESTORE_EMULATOR_HOST, "Run this check through the Firestore emulator.");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "recovery-tools" });
const db = admin.firestore();
const suffix = Date.now();
const entityTypeId = `TEST-ITEM-WORKSHOP-${suffix}`;
const legacyItemId = `TEST-LEGACY-WORKSHOP-${suffix}`;
const ordinaryItemId = `TEST-ORDINARY-ITEM-${suffix}`;
const request = { auth: { uid: `TEST-ADMIN-${suffix}`, token: { admin: true, email: "test@example.test" } } };

async function main() {
  try {
    await db.collection("entityTypes").doc(entityTypeId).set({
      entityKind: "item",
      type: "workshop",
      status: "active",
    });
    await db.collection("items").doc(legacyItemId).set({
      name: "Legacy Workshop Item",
      type: "workshop",
      status: "draft",
    });
    await db.collection("items").doc(ordinaryItemId).set({
      name: "Ordinary Item",
      type: "tool",
      status: "draft",
    });

    const builderData = await getContentBuilderData.run(request);
    assert(!builderData.options.itemTypes.includes("workshop"),
      "Workshop leaked into Item types from an active entityTypes record.");
    assert(builderData.options.planTypes.includes("workshop"), "Workshop was removed from Plan types.");

    await assert.rejects(() => createContentBuilderRecord.run({
      ...request,
      data: { recordType: "item", name: "Invalid Workshop Item", type: "workshop" },
    }), /Create Workshops as Plans/);

    await assert.rejects(() => updateContentControlRecord.run({
      ...request,
      data: { recordType: "item", recordId: ordinaryItemId, updates: { type: "workshop" } },
    }), /Create Workshops as Plans/);

    const legacyUpdate = await updateContentControlRecord.run({
      ...request,
      data: { recordType: "item", recordId: legacyItemId, updates: { type: "workshop", name: "Legacy retained" } },
    });
    assert.equal(legacyUpdate.success, true, "An existing legacy Workshop Item could not be safely edited.");
    console.log("Workshop Plan/Item boundary verification passed.");
  } finally {
    await Promise.all([
      db.collection("entityTypes").doc(entityTypeId).delete(),
      db.collection("items").doc(legacyItemId).delete(),
      db.collection("items").doc(ordinaryItemId).delete(),
    ]);
  }
}

main();
