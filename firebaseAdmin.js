// firebaseAdmin.js
const admin = require("firebase-admin");
const dotenv = require("dotenv");
dotenv.config();

if (!process.env.FIREBASE_ADMIN_KEY_BASE64) {
  throw new Error("Missing FIREBASE_ADMIN_KEY_BASE64 in .env");
}

const decodedKey = Buffer.from(
  process.env.FIREBASE_ADMIN_KEY_BASE64,
  "base64",
).toString("utf8");

const serviceAccount = JSON.parse(decodedKey);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
