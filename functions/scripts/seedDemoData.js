// functions/scripts/seedDemoData.js
import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const users = [
  { uid: "uid-admin", name: "Admin User", email: "admin@recoverytools.au" },
  { uid: "uid-therapist", name: "Therapist User", email: "therapist@recoverytools.au" },
  { uid: "uid-affiliate", name: "Affiliate User", email: "affiliate@recoverytools.au" },
  { uid: "uid-multi", name: "Multi Role User", email: "multi@recoverytools.au" },
];

const sampleProducts = [
  {
    name: "Trigger Ball",
    shortDescription: "Firm silicone ball for deep tissue release.",
    type: "Tool",
    price: 19.95,
    stock: 20,
    visible: true,
  },
  {
    name: "Silicone Cupping Set",
    shortDescription: "2 small, 2 large cups in a hard case with balm.",
    type: "Tool",
    price: 49.95,
    stock: 15,
    visible: true,
  },
];

const sampleCourses = [
  {
    title: "Intro to Trigger Point Release",
    description: "Learn the basics of trigger point therapy for self-treatment.",
    status: "pending",
  },
  {
    title: "Recovery Techniques for Tradies",
    description: "A course focused on musculoskeletal recovery for physically demanding jobs.",
    status: "pending",
  },
];

const sampleWorkshops = [
  {
    name: "Self-Cupping Hands-on Workshop",
    description: "Hands-on workshop teaching safe cupping practices.",
    location: "Brisbane QLD",
    date: new Date(Date.now() + 7 * 86400000),
    status: "pending",
  },
  {
    name: "Posture Reset Session",
    description: "Reset your posture with guided mobility and myofascial techniques.",
    location: "Melbourne VIC",
    date: new Date(Date.now() + 14 * 86400000),
    status: "pending",
  },
];

async function seedDemoData() {
  for (const user of users) {
    for (const product of sampleProducts) {
      await db.collection("products").add({
        ...product,
        creatorId: user.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    for (const course of sampleCourses) {
      await db.collection("submittedCourses").add({
        ...course,
        createdBy: user.uid,
        userName: user.name,
        userEmail: user.email,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    for (const workshop of sampleWorkshops) {
      await db.collection("workshops").add({
        ...workshop,
        createdBy: user.uid,
        userName: user.name,
        userEmail: user.email,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }

  console.log("✅ Demo products, workshops, and courses seeded successfully.");
  process.exit(0);
}

seedDemoData();
