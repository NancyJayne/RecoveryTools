import assert from "node:assert/strict";
import admin from "../functions/node_modules/firebase-admin/lib/index.js";
import { setUserRoles } from "../functions/users/setUserRoles.js";
import { getFirestoreProducts } from "../functions/products/getFirestoreProducts.js";

assert(process.env.FIRESTORE_EMULATOR_HOST, "Run this check through the Firestore emulator.");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "recovery-tools" });

const suffix = Date.now();
const uid = `TEST-AFFILIATE-ROLE-${suffix}`;
const productId = `TEST-AFFILIATE-PRICE-${suffix}`;
const adminUid = `TEST-ADMIN-${suffix}`;
const db = admin.firestore();
const request = {
  auth: { uid: adminUid, token: { admin: true, email: "admin@example.test" } },
};

async function main() {
  try {
    await db.collection("users").doc(uid).set({
      email: `affiliate-${suffix}@example.test`,
      roles: { admin: true, affiliate: true, therapist: false },
      affiliateApplicationStatus: "pending",
    });
    await db.collection("products").doc(productId).set({
      name: "Affiliate pricing test product",
      status: "active",
      marketplaceMode: "active",
      visible: true,
      price: 20,
      wholesalePrice: 12,
      wholesaleMinQuantity: 2,
    });
    const catalogue = await getFirestoreProducts.run({
      auth: { uid, token: { admin: true, affiliate: true } },
      data: {},
    });
    const pricedProduct = catalogue.products.find((product) => product.id === productId);
    assert.equal(pricedProduct?.price, 12);
    assert.equal(pricedProduct?.pricingTier, "affiliate-wholesale");

    if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      await admin.auth().createUser({
        uid,
        email: `affiliate-${suffix}@example.test`,
        displayName: "Test Affiliate",
      });
      await setUserRoles.run({
        ...request,
        data: { uid, roles: { admin: true, affiliate: true, therapist: false } },
      });
      const approvedUser = (await db.collection("users").doc(uid).get()).data();
      const approvedAffiliate = (await db.collection("affiliates").doc(uid).get()).data();
      const approvedClaims = (await admin.auth().getUser(uid)).customClaims;
      assert.equal(approvedUser?.affiliateApplicationStatus, "active");
      assert.equal(approvedUser?.roles?.affiliate, true);
      assert.equal(approvedAffiliate?.status, "active");
      assert.equal(approvedClaims?.affiliate, true);

      await setUserRoles.run({
        ...request,
        data: { uid, roles: { admin: true, affiliate: false, therapist: false } },
      });
      const inactiveUser = (await db.collection("users").doc(uid).get()).data();
      const inactiveAffiliate = (await db.collection("affiliates").doc(uid).get()).data();
      assert.equal(inactiveUser?.affiliateApplicationStatus, "inactive");
      assert.equal(inactiveUser?.roles?.affiliate, false);
      assert.equal(inactiveAffiliate?.status, "inactive");
    }
    console.log("Affiliate role and pricing eligibility verification passed.");
  } finally {
    await Promise.all([
      db.collection("users").doc(uid).delete(),
      db.collection("affiliates").doc(uid).delete(),
      db.collection("products").doc(productId).delete(),
      ...(process.env.FIREBASE_AUTH_EMULATOR_HOST
        ? [admin.auth().deleteUser(uid).catch(() => undefined)] : []),
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
