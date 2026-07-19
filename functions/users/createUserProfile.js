import { region } from "firebase-functions/v1";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const createUserProfile = region("australia-southeast1")
  .auth.user()
  .onCreate(async (user) => {
    const { uid, email, displayName } = user;

    try {
      await admin.firestore().collection("users").doc(uid).set(
        {
          uid,
          email: email || null,
          name: displayName || "",
          displayName: displayName || "",
          photoURL: "",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      console.log(`📝 Created profile for ${uid}`);
    } catch (err) {
      console.error("❌ Failed to create user profile:", err);
    }
  });
  
