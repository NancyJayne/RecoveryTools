import admin from "firebase-admin";

const EXPECTED_PROJECT = "recovery-tools";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function fail(message) {
  console.error(`Refusing to grant admin access: ${message}`);
  process.exit(1);
}

const projectId = argument("project");
const email = argument("email").toLowerCase();
const confirmation = argument("confirm");

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  fail("an emulator environment variable is active");
}
if (projectId !== EXPECTED_PROJECT) fail(`--project must be ${EXPECTED_PROJECT}`);
if (!email || !email.includes("@")) fail("a valid --email is required");
if (confirmation !== "GRANT_ADMIN") fail("--confirm GRANT_ADMIN is required");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId,
});

async function grantAdmin() {
  const auth = admin.auth();
  const db = admin.firestore();
  try {
    const user = await auth.getUserByEmail(email);
    if (!user.emailVerified) {
      const verificationLink = await auth.generateEmailVerificationLink(email);
      console.log("The Firebase Authentication email is not verified.");
      console.log("Open this one-time Firebase verification link, then rerun this command:");
      console.log(verificationLink);
      process.exit(2);
    }

    const existingClaims = user.customClaims || {};
    const roles = {
      admin: true,
      affiliate: existingClaims.affiliate === true,
      therapist: existingClaims.therapist === true,
    };
    await auth.setCustomUserClaims(user.uid, { ...existingClaims, ...roles });
    await db.collection("users").doc(user.uid).set({
      uid: user.uid,
      email: user.email || email,
      roles,
      role: Object.entries(roles).filter(([, enabled]) => enabled).map(([name]) => name).join(", "),
      status: "active",
      rolesUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      rolesUpdatedBy: "production-admin-bootstrap",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`Admin access granted to ${user.email} (${user.uid}) in ${projectId}.`);
    console.log("Sign out of the website and sign back in to refresh the ID-token claims.");
    process.exit(0);
  } catch (error) {
    if (error?.code === "auth/user-not-found") fail(`no Firebase Authentication user exists for ${email}`);
    console.error(error);
    process.exit(1);
  }
}

grantAdmin();
