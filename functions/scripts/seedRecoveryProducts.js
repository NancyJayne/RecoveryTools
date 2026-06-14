import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "recovery-tools";
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const products = [
  {
    id: "PROD-TRIGGER-BALL-6CM",
    name: "Trigger Ball 6cm",
    productCategory: "Tool",
    type: "tool",
    productType: "Physical Product",
    soldByRecoveryTools: true,
    isShopProduct: true,
    shopStatus: "Active",
    visible: true,
    websiteVisible: true,
    price: 19.95,
    sku: "TRIGGER-BALL-6CM",
    stock: 20,
    shortDescription:
      "Hard silicone trigger ball for targeted muscle release and deep tissue recovery.",
    longDescription:
      "Our 6cm hard silicone trigger ball is designed to target tight spots, " +
      "release muscle tension, and support deep tissue recovery anytime, anywhere.",
    images: ["https://via.placeholder.com/300"],
    unlocksAccess: true,
    accessType: "Course",
    relatedPlanId: "PLAN-TRIGGER-BALL-BASICS",
    relatedCourseId: "COURSE-TRIGGER-BALL-BASICS",
    accessCodeEligible: true,
    notes: "Needs colour variants.",
  },
  {
    id: "PROD-MCT-BALM-50G",
    name: "MCT Recovery Balm 50g",
    productCategory: "Tool",
    type: "tool",
    productType: "Physical Product",
    soldByRecoveryTools: true,
    isShopProduct: true,
    shopStatus: "Active",
    visible: true,
    websiteVisible: true,
    price: 25,
    sku: "MCT-BALM-50G",
    stock: 20,
    shortDescription:
      "Warming recovery balm with coconut oil, camphor, magnesium, wintergreen, and eucalyptus.",
    longDescription:
      "Our 50g MCT Recovery Balm combines coconut oil with camphor, magnesium, " +
      "wintergreen, and eucalyptus to deliver soothing warmth and support muscle recovery.",
    images: ["https://via.placeholder.com/300"],
    unlocksAccess: true,
    accessType: "Course",
    relatedPlanId: "PLAN-MCT-BALM-USE",
    relatedCourseId: "COURSE-MCT-BALM-USE",
    accessCodeEligible: true,
  },
  {
    id: "PROD-CUPPING-SET",
    name: "Silicone Cupping Set",
    productCategory: "Tool",
    type: "tool",
    productType: "Physical Product",
    soldByRecoveryTools: true,
    isShopProduct: true,
    shopStatus: "Active",
    visible: true,
    websiteVisible: true,
    price: 50,
    sku: "CUPPING-SET",
    stock: 15,
    shortDescription:
      "Silicone cupping set with 2 large cups, 2 small cups, hard case, and MCT balm sample.",
    longDescription:
      "A professional-level recovery set for safe self-care, featuring 2 large " +
      "and 2 small silicone cups, a hard case, and a soothing MCT balm sample.",
    images: ["https://via.placeholder.com/300"],
    unlocksAccess: true,
    accessType: "Course",
    relatedPlanId: "PLAN-CUPPING-BASICS",
    relatedCourseId: "COURSE-CUPPING-BASICS",
    accessCodeEligible: true,
  },
  {
    id: "PROD-EPSOM-500G",
    name: "Epsom Salts 500g",
    productCategory: "Tool",
    type: "tool",
    productType: "Physical Product",
    soldByRecoveryTools: true,
    isShopProduct: true,
    shopStatus: "Active",
    visible: true,
    websiteVisible: true,
    price: 10,
    sku: "EPSOM-500G",
    stock: 30,
    shortDescription:
      "Pure magnesium sulfate recovery salts for muscle relaxation and recovery.",
    longDescription:
      "Pure magnesium sulfate recovery salts for post-training soaks, relaxation, " +
      "and self-managed recovery routines.",
    images: ["https://via.placeholder.com/300"],
    unlocksAccess: true,
    accessType: "Course",
    relatedPlanId: "PLAN-EPSOM-SOAKS",
    relatedCourseId: "COURSE-EPSOM-SOAKS",
    accessCodeEligible: true,
  },
];

async function seedRecoveryProducts() {
  for (const product of products) {
    const { id, ...data } = product;

    await db.collection("products").doc(id).set(
      {
        ...data,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    console.log(`✅ Seeded product: ${id}`);
  }

  console.log("🎉 Recovery products seeded successfully.");
  process.exit(0);
}

seedRecoveryProducts();