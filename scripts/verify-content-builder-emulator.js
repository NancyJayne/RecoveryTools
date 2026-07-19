import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import admin from "firebase-admin";
import { buildContentBackup } from "../functions/admin/exportContentBackup.js";
import {
  loadBlueprintTemplateDefinitions,
  loadItemTemplateDefinitions,
  loadPlanTemplateDefinitions,
} from "../functions/admin/contentTemplateDefinitions.js";
import { selectCampaignMatches } from "../src/admin/content-builder-relationships.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runImport(workbookPath, extraArgs = []) {
  execFileSync(process.execPath, [
    path.resolve("functions/scripts/importMasterDatabase.js"),
    "--emulator",
    ...extraArgs,
    path.resolve(workbookPath),
  ], { stdio: "inherit", env: process.env });
}

async function main() {
  const workbookPath = process.argv[2];
  assert(workbookPath, "Pass the Recovery Tools workbook path.");
  assert(process.env.FIRESTORE_EMULATOR_HOST, "Run this check through the Firestore emulator.");

  runImport(workbookPath);

  if (!admin.apps.length) admin.initializeApp({ projectId: "recovery-tools" });
  const db = admin.firestore();

  const camera = await db.collection("items").doc("ITEM-PHOTO-CAMERA").get();
  assert(camera.exists && camera.data()?.type === "tool", "Reusable photography camera Item did not import.");
  assert(camera.data()?.managedByWorkbook === true, "Workbook traceability flag is missing from imported Items.");
  assert(
    camera.data()?.importSource?.sourceWorkbookVersion === "7",
    "Workbook version trace is missing or incorrect.",
  );

  const photography = await db.collection("blueprints").doc("BLUE-BUS-009").get();
  assert(photography.exists, "Photography Blueprint did not import.");
  assert(
    photography.data()?.linkedItemIds?.includes("ITEM-PHOTO-CAMERA"),
    "Photography Blueprint did not link its reusable Items.",
  );
  assert(
    (photography.data()?.methodSteps || []).length > 0,
    "Photography Blueprint method steps did not import.",
  );

  const triggerBall = await db.collection("plans").doc("PLAN-TRIGGER-BALL-BASICS").get();
  assert(triggerBall.exists, "Trigger Ball Basics Plan did not import.");
  assert(
    triggerBall.data()?.linkedItemIds?.includes("ITEM-TRIGGER-BALL-6CM"),
    "Trigger Ball Plan is missing its equipment Item.",
  );
  assert(
    triggerBall.data()?.linkedItemIds?.includes("ITEM-TRIGGER-001"),
    "Trigger Ball Plan is missing its learning Item.",
  );

  const operatingSystem = await db.collection("plans").doc("PLAN-BUS-001").get();
  assert(
    operatingSystem.data()?.type === "business workflow",
    "Recovery Campaign Operating System is not a business workflow.",
  );

  const campaignType = await db.collection("entityTypes").doc("TYPE-PLAN-CAMPAIGN").get();
  assert(campaignType.exists, "Campaign Plan Type did not import.");
  assert(
    campaignType.data()?.fieldGroupIds?.includes("campaign"),
    "Campaign field-group configuration did not import.",
  );

  const [itemTemplates, blueprintTemplates, planTemplates] = await Promise.all([
    loadItemTemplateDefinitions(db),
    loadBlueprintTemplateDefinitions(db),
    loadPlanTemplateDefinitions(db),
  ]);
  assert(
    itemTemplates.length === 0,
    "The empty Item Templates workbook sheet should not create hardwired Item templates.",
  );
  const exerciseHowTo = blueprintTemplates.find((template) => template.id === "BTV-EX-STANDARD");
  assert(
    exerciseHowTo?.appliesTo === "recovery activity" &&
      exerciseHowTo.defaults?.blueprintTemplateId === "BT-EX-HOWTO" &&
      exerciseHowTo.defaults?.fields?.length === 11,
    "The workbook Blueprint template and its field guide did not import.",
  );
  const thirtyMinuteTemplate = planTemplates.find((template) => template.id === "PTV-EX-30");
  const sixtyMinuteTemplate = planTemplates.find((template) => template.id === "PTV-EX-60");
  assert(
    thirtyMinuteTemplate?.name === "30 min Exercise Plan" &&
      thirtyMinuteTemplate.defaults?.durationMinutes === 30,
    "The workbook 30-minute Plan template variant did not import.",
  );
  assert(
    sixtyMinuteTemplate?.name === "60 min Exercise" &&
      sixtyMinuteTemplate.defaults?.durationMinutes === 60,
    "The workbook 60-minute Plan template variant did not import.",
  );
  assert(
    thirtyMinuteTemplate.defaults?.slots?.length === 3 &&
      sixtyMinuteTemplate.defaults?.slots?.length === 3,
    "The workbook Plan template slots did not import.",
  );
  const requiredPlanTypes = [
    "course",
    "workshop",
    "treatment plan",
    "assessment",
    "reassessment",
    "business manual",
    "recovery plan",
    "business workflow",
    "campaign",
  ];
  requiredPlanTypes.forEach((type) => {
    assert(
      planTemplates.some((template) => template.appliesTo === type && template.isDefault === true),
      `No default workbook Plan template imported for ${type}.`,
    );
  });

  const directItemId = "TEST-APP-DIRECT-ITEM";
  const appOwnedCollisionId = "ITEM-TRIGGER-BALL-6CM";
  const backupOrderId = "TEST-BACKUP-ORDER";
  const backupAddressId = "TEST-BACKUP-ADDRESS";
  const backupUserId = "TEST-BACKUP-USER";
  const workbookCameraName = camera.data()?.name;
  const appOwnedCollisionRef = db.collection("items").doc(appOwnedCollisionId);
  const appOwnedCollision = await appOwnedCollisionRef.get();
  assert(appOwnedCollision.exists, "The workbook collision test Item did not import.");
  const reconciliationPath = path.join(os.tmpdir(), `recovery-tools-reconciliation-${Date.now()}.json`);
  await db.collection("items").doc(directItemId).set({
    itemId: directItemId,
    name: "App-created preserved Item",
    type: "content",
    tags: ["Headache"],
    managedByWorkbook: false,
    contentOrigin: "app",
    createdInApp: true,
  });
  await camera.ref.update({
    name: "App-edited camera name",
    appOnlyNote: "This value must survive later workbook imports.",
  });
  await appOwnedCollisionRef.update({
    name: "App-owned collision name",
    managedByWorkbook: false,
    contentOrigin: "app",
    appOnlyNote: "This app-owned record must not be overwritten by the workbook.",
  });

  try {
    runImport(workbookPath, ["--reconcile", "--report", reconciliationPath]);
    const reconciliation = JSON.parse(await fs.readFile(reconciliationPath, "utf8"));
    assert(
      reconciliation.mode === "workbook-managed-merge",
      "Reconciliation did not use workbook-managed merge mode.",
    );
    assert(reconciliation.summary.new === 0, "A repeated workbook import unexpectedly found new documents.");
    assert(
      reconciliation.collections.items.workbookUpdateIds.includes("ITEM-PHOTO-CAMERA"),
      "Reconciliation did not detect a workbook-managed Item update.",
    );
    assert(
      reconciliation.collections.items.appCollisionPreservedIds.includes(appOwnedCollisionId),
      "Reconciliation did not protect an app-owned record with a workbook ID collision.",
    );
    assert(
      reconciliation.collections.items.appCreatedOnlyPreservedIds.includes(directItemId),
      "Reconciliation did not report the app-created Item as preserved.",
    );

    runImport(workbookPath);
    const [mergedCamera, preservedCollision, preservedDirectItem] = await Promise.all([
      camera.ref.get(),
      appOwnedCollisionRef.get(),
      db.collection("items").doc(directItemId).get(),
    ]);
    assert(
      mergedCamera.data()?.name === workbookCameraName &&
        mergedCamera.data()?.appOnlyNote === "This value must survive later workbook imports.",
      "The managed merge did not update workbook fields while preserving app-only fields.",
    );
    assert(
      preservedCollision.data()?.name === "App-owned collision name" &&
        preservedCollision.data()?.appOnlyNote ===
          "This app-owned record must not be overwritten by the workbook.",
      "A workbook import overwrote an app-owned record with the same ID.",
    );
    assert(preservedDirectItem.exists, "A repeated workbook import removed app-created content.");

    await Promise.all([
      db.collection("orders").doc(backupOrderId).set({
        orderId: backupOrderId,
        userId: backupUserId,
        customerEmail: "backup-test@example.com",
        total: 49.95,
      }),
      db.collection("customerAddresses").doc(backupAddressId).set({
        addressId: backupAddressId,
        userId: backupUserId,
        city: "Brisbane",
      }),
      db.collection("users").doc(backupUserId).collection("orders").doc(backupOrderId).set({
        orderId: backupOrderId,
        total: 49.95,
      }),
    ]);

    const backup = await buildContentBackup(db, {
      exportedAt: "2026-07-16T00:00:00.000Z",
      projectId: "recovery-tools",
      requestedByUid: "emulator-admin",
    });
    assert(
      backup.collections.items.some((record) => record.id === directItemId),
      "The content backup omitted an app-created Item.",
    );
    assert(backup.collections.blueprints.length > 0, "The full backup omitted Blueprints.");
    assert(backup.collections.plans.length > 0, "The full backup omitted Plans.");
    assert(
      backup.collections.orders.some((record) => record.id === backupOrderId),
      "The full backup omitted root Order data.",
    );
    assert(
      backup.collections.customerAddresses.some((record) => record.id === backupAddressId),
      "The full backup omitted customer address data.",
    );
    assert(
      backup.nestedCollections[`users/${backupUserId}/orders`]
        .some((record) => record.id === backupOrderId),
      "The full backup omitted the customer's nested Order record.",
    );
    assert(
      backup.manifest.backupType === "recovery-tools-full" &&
        backup.manifest.containsSensitiveData === true,
      "The full backup manifest does not identify its sensitive customer data.",
    );
  } finally {
    await Promise.all([
      db.collection("items").doc(directItemId).delete(),
      db.collection("orders").doc(backupOrderId).delete(),
      db.collection("customerAddresses").doc(backupAddressId).delete(),
      db.collection("users").doc(backupUserId).collection("orders").doc(backupOrderId).delete(),
      fs.rm(reconciliationPath, { force: true }),
    ]);
  }

  const testDocs = [
    ["items", "TEST-CAMPAIGN-ITEM", { name: "Headache teaching module", type: "content", tags: ["Headache"] }],
    [
      "blueprints", "TEST-CAMPAIGN-BLUEPRINT",
      { name: "Headache Instagram post", type: "marketing content", tags: ["Headache"] },
    ],
    [
      "plans", "TEST-CAMPAIGN-TREATMENT",
      { name: "Headache treatment plan", type: "treatment plan", tags: ["Headache"] },
    ],
  ];
  const batch = db.batch();
  for (const [collection, id, data] of testDocs) batch.set(db.collection(collection).doc(id), data);
  await batch.commit();

  try {
    const [items, blueprints, plans] = await Promise.all([
      db.collection("items").get(),
      db.collection("blueprints").get(),
      db.collection("plans").get(),
    ]);
    const normalize = (snapshot) => snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const matches = selectCampaignMatches({
      items: normalize(items),
      blueprints: normalize(blueprints),
      plans: normalize(plans),
    }, "Headache");
    assert(
      matches.items.some((record) => record.id === "TEST-CAMPAIGN-ITEM"),
      "Campaign helper did not select the matching teaching Item.",
    );
    assert(
      matches.blueprints.some((record) => record.id === "TEST-CAMPAIGN-BLUEPRINT"),
      "Campaign helper did not select matching marketing content.",
    );
    assert(
      matches.plans.some((record) => record.id === "TEST-CAMPAIGN-TREATMENT"),
      "Campaign helper did not link the related treatment Plan.",
    );
  } finally {
    await Promise.all(testDocs.map(([collection, id]) => db.collection(collection).doc(id).delete()));
  }

  console.log("Content Builder emulator workflow passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
