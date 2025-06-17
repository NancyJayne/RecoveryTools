const admin = require("firebase-admin");

// Use application default credentials
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

// Use UID OR email — uncomment the method you prefer

// ✅ Option 1: By UID
// const uid = "your-user-uid-here";
// admin.auth().setCustomUserClaims(uid, { admin: true })
//   .then(() => console.log(`✅ Admin claim set for UID: ${uid}`))
//   .catch(err => console.error("❌ Error:", err));

// ✅ Option 2: By Email
const email = "test@recoverytools.au";
admin.auth().getUserByEmail(email)
  .then((user) => {
    return admin.auth().setCustomUserClaims(user.uid, { admin: true });
  })
  .then(() => console.log(`✅ Admin claim set for: ${email}`))
  .catch((err) => console.error("❌ Error:", err));

