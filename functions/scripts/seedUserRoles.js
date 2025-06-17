// functions/scripts/seedUserRoles.js
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";

// ✅ Force emulator usage
process.env.GCLOUD_PROJECT = "recovery-tools";
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";

// 🔒 SAFETY CHECK
if (process.env.GCLOUD_PROJECT !== "recovery-tools") {
  console.warn("🚨 Aborting: Not a safe test environment.");
  process.exit(1);
}

initializeApp({
  projectId: "recovery-tools",
});

const db = getFirestore();

const usersToSeed = [
  {
    email: "admin@recoverytools.au",
    password: "secureTest123",
    displayName: "Admin User",
    roles: { admin: true },
  },
  {
    email: "therapist@recoverytools.au",
    password: "secureTest123",
    displayName: "Therapist User",
    roles: { therapist: true },
    therapistGroup: "Sports Rehab",
  },
  {
    email: "affiliate@recoverytools.au",
    password: "secureTest123",
    displayName: "Affiliate User",
    roles: { affiliate: true },
  },
  {
    email: "multi@recoverytools.au",
    password: "secureTest123",
    displayName: "Multi Role User",
    roles: { therapist: true, affiliate: true },
    therapistGroup: "Pilates",
  },
];

function generateReferralCode(email) {
  return email.split("@")[0] + Math.floor(Math.random() * 10000);
}

async function resetCollections(collections) {
  for (const name of collections) {
    const snap = await db.collection(name).get();
    const batch = db.batch();
    snap.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    console.log(`🧹 Cleared collection: ${name}`);
  }
}

async function seedUsers() {
  await resetCollections([
    "users",
    "badges",
    "orders",
    "products",
    "affiliates",
    "clinicalCompanion",
  ]);

  for (const user of usersToSeed) {
    try {
      const uid = `uid-${user.email.split("@")[0]}`;

      await db.collection("users").doc(uid).set(
        {
          uid,
          email: user.email,
          name: user.displayName,
          roles: user.roles,
          photoURL: "",
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      if (user.roles.therapist) {
        await db.collection("clinicalCompanion").doc(uid).set(
          {
            group: user.therapistGroup || "General",
            active: true,
            calendarLinked: false,
            timezone: "Australia/Brisbane",
            joinedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      if (user.roles.affiliate) {
        const referralCode = generateReferralCode(user.email);
        await db.collection("affiliates").doc(uid).set(
          {
            referralCode,
            clicks: 0,
            conversions: 0,
            earnings: 0,
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      await db.collection("badges").doc(uid).set(
        {
          starterBadge: true,
          welcomeNote: "Seeded for testing",
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      await db.collection("orders").add({
        userId: uid,
        items: [{ name: "Trigger Ball", price: 19.95, quantity: 1 }],
        total: 19.95,
        status: "seeded",
        createdAt: FieldValue.serverTimestamp(),
      });

      await db.collection("products").add({
        name: `${user.displayName}'s Sample Tool`,
        creatorId: uid,
        type: "Tool",
        visible: true,
        shortDescription: "Test item created for seeding",
        price: 29.95,
        stock: 5,
        createdAt: FieldValue.serverTimestamp(),
      });

      console.log(`✅ Seeded user & data for ${user.email}`);
    } catch (err) {
      console.error(`❌ Error seeding ${user.email}:`, err.message);
    }
  }

  console.log("🎉 All users and data seeded successfully.");
  process.exit(0);
}

seedUsers();
