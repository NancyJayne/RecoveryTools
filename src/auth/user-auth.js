// Signup, login, auth state
import { auth, db } from "../utils/firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import { setupRoleUI } from "./user-roles.js"; // Role UI setup
import { showToast } from "../utils/utils.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { unlockCourseContent, refreshProfileCourses } from "../profile/profile-utils.js"; // or wherever these live


// 🔄 Initialize auth state and handle user presence
export async function setupAuthState() {
    if (!auth) {
    console.warn("⚠️ Auth instance unavailable. Firebase may not be initialized.");
    return;
  }

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      setupRoleUI(user);
      console.log("✅ User signed in:", user.email);
    } else {
      console.log("👋 No user signed in");
    }
  });
}


export async function validateTokenFromURL() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  const mode = url.searchParams.get("mode");

  if (token && mode === "signIn") {
    showToast("Signed in securely via link", "success");
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  if (!token) return;

  try {
    const tokenDocRef = doc(db, "tokens", token);
    const tokenDoc = await getDoc(tokenDocRef);

    if (!tokenDoc.exists()) {
      showToast("Invalid access code.", "error");
      return;
    }

    const data = tokenDoc.data();

    if (data.isUsed) {
      showToast("This code has already been redeemed.", "error");
      return;
    }

    await updateDoc(tokenDocRef, {
      isUsed: true,
      redeemedAt: serverTimestamp(),
    });

    showToast("Access granted!", "success");
    unlockCourseContent(data.courseId);
    refreshProfileCourses();

    window.history.replaceState({}, document.title, window.location.pathname);
  } catch (err) {
    console.error(err);
    showToast("Something went wrong validating your code.", "error");
  }
}
