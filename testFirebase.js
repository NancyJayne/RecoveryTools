// testFirebase.js
const admin = require("./firebaseAdmin");

admin.auth().listUsers(1)
  .then((data) => {
    console.log("✅ Firebase Admin is working:", data.users.length, "user(s)");
  })
  .catch((err) => {
    console.error("❌ Error connecting to Firebase:", err);
  });
