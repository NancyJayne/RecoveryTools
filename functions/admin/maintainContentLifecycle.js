import { onSchedule } from "firebase-functions/v2/scheduler";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const CONTENT_COLLECTIONS = ["items", "blueprints", "plans", "campaigns"];

export const maintainContentLifecycle = onSchedule(
  { region: "australia-southeast1", schedule: "every 15 minutes", timeZone: "Australia/Brisbane" },
  async () => {
    const db = admin.firestore();
    const now = new Date().toISOString();
    const batch = db.batch();
    let changes = 0;

    for (const collection of CONTENT_COLLECTIONS) {
      const [activate, pause] = await Promise.all([
        db.collection(collection).where("scheduledActiveAt", "<=", now).limit(40).get(),
        db.collection(collection).where("scheduledPauseAt", "<=", now).limit(40).get(),
      ]);
      activate.docs.filter((doc) => Boolean(doc.data().scheduledActiveAt)).forEach((doc) => {
        batch.set(doc.ref, {
          status: "active",
          scheduledActiveAt: "",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        changes += 1;
      });
      pause.docs.filter((doc) => Boolean(doc.data().scheduledPauseAt)).forEach((doc) => {
        batch.set(doc.ref, {
          status: "paused",
          scheduledPauseAt: "",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        changes += 1;
      });
    }

    const startingSales = await db.collection("products").where("saleStartsAt", "<=", now).limit(40).get();
    startingSales.docs.filter((doc) => doc.data().onSale !== true && doc.data().salePrice !== null).forEach((doc) => {
      const product = doc.data();
      const salePrice = Number(product.salePrice);
      batch.set(doc.ref, {
        price: salePrice,
        onSale: true,
        saleStartsAt: "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      if (product.activePriceId) {
        batch.set(db.collection("productPrices").doc(product.activePriceId), {
          effectiveShopPrice: salePrice,
          onSale: true,
          saleStartsAt: "",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      changes += 1;
    });

    const products = await db.collection("products").where("saleEndsAt", "<=", now).limit(40).get();
    products.docs.filter((doc) => Boolean(doc.data().saleEndsAt)).forEach((doc) => {
      const product = doc.data();
      const retailPrice = Number(product.retailPrice ?? product.price ?? 0);
      batch.set(doc.ref, {
        price: retailPrice,
        salePrice: null,
        onSale: false,
        saleStartsAt: "",
        saleEndsAt: "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      if (product.activePriceId) {
        batch.set(db.collection("productPrices").doc(product.activePriceId), {
          effectiveShopPrice: retailPrice,
          salePrice: null,
          onSale: false,
          saleStartsAt: "",
          saleEndsAt: "",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      changes += 1;
    });

    if (changes) await batch.commit();
    console.log(`Content lifecycle maintenance applied ${changes} changes.`);
  },
);
