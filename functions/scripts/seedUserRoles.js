// functions/scripts/seedUserRoles.js
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

process.env.GCLOUD_PROJECT = "recovery-tools";
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9100";

if (process.env.GCLOUD_PROJECT !== "recovery-tools") {
  console.warn("🚨 Aborting: Not a safe test environment.");
  process.exit(1);
}

initializeApp({
  projectId: "recovery-tools",
});

const db = getFirestore();
const auth = getAuth();

const usersToSeed = [
  {
    uid: "uid-admin",
    email: "admin@recoverytools.au",
    password: "secureTest123",
    displayName: "Admin User",
    roles: { admin: true },
  },
  {
    uid: "uid-therapist",
    email: "therapist@recoverytools.au",
    password: "secureTest123",
    displayName: "Therapist User",
    roles: { therapist: true },
    therapistGroup: "Sports Rehab",
  },
  {
    uid: "uid-affiliate",
    email: "affiliate@recoverytools.au",
    password: "secureTest123",
    displayName: "Affiliate User",
    roles: { affiliate: true },
  },
  {
    uid: "uid-multi",
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

async function ensureAuthUser(user) {
  try {
    const existingUser = await auth.getUserByEmail(user.email);

    if (existingUser.uid !== user.uid) {
      console.warn(
        `⚠️ ${user.email} exists with UID ${existingUser.uid}, expected ${user.uid}.`,
      );
      return existingUser;
    }

    await auth.updateUser(user.uid, {
      email: user.email,
      password: user.password,
      displayName: user.displayName,
      emailVerified: true,
    });

    return existingUser;
  } catch (err) {
    if (err.code !== "auth/user-not-found") {
      throw err;
    }

    return auth.createUser({
      uid: user.uid,
      email: user.email,
      password: user.password,
      displayName: user.displayName,
      emailVerified: true,
    });
  }
}

async function seedUsers() {
  await resetCollections([
    "users",
    "badges",
    "orders",
    "affiliates",
    "clinicalCompanion",
  ]);

  for (const user of usersToSeed) {
    try {
      const authUser = await ensureAuthUser(user);
      const uid = authUser.uid;
      await auth.setCustomUserClaims(uid, user.roles);

      await db.collection("users").doc(uid).set(
        {
          uid,
          email: user.email,
          name: user.displayName,
          roles: user.roles,
          role: Object.keys(user.roles).join(", "),
          photoURL: "",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
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
            uid,
            email: user.email,
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

      console.log(`✅ Seeded Auth + Firestore user for ${user.email}`);
    } catch (err) {
      console.error(`❌ Error seeding ${user.email}:`, err.message);
    }
  }

  console.log("🎉 All users and role data seeded successfully.");
  process.exit(0);
}

seedUsers();