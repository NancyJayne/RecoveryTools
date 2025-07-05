import { auth, db } from "../utils/firebase-config.js";
import { collection, getDocs, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { showToast } from "../utils/utils.js";

// 🔓 Unlocks access to a course for a logged-in user
export async function unlockCourseContent(courseId) {
  const user = auth?.currentUser;
  if (!user) {
    showToast("Please login first.", "error");
    return;
  }

  const refBy = localStorage.getItem("referrer_uid");
  const refEvent = localStorage.getItem("ref_event");

  try {
    const userPurchaseRef = doc(db, "users", user.uid, "purchases", courseId);
    await setDoc(userPurchaseRef, {
      accessGranted: true,
      courseId,
      unlockedAt: serverTimestamp(),
      referredBy: refBy || null,
      referralEvent: refEvent || null,
    });

    const globalUnlockRef = doc(db, "unlocks", `${user.uid}_${courseId}`);
    await setDoc(globalUnlockRef, {
      userId: user.uid,
      courseId,
      unlockedAt: serverTimestamp(),
      referredBy: refBy || null,
      referralEvent: refEvent || null,
    });

    showToast("Course access unlocked!", "success");
    localStorage.removeItem("referrer_uid");
    localStorage.removeItem("ref_event");

    setTimeout(() => {
      refreshProfileCourses();
      window.location.href = `/courses?course=${courseId}`;
    }, 2000);

  } catch (error) {
    console.error("Error unlocking course:", error);
    showToast("Failed to unlock course.", "error");
  }
}

// 🔄 Refreshes the profile course list on the frontend
export async function refreshProfileCourses() {
  const user = auth?.currentUser;
  if (!user) return;

  try {
    const snapshot = await getDocs(collection(db, "users", user.uid, "purchases"));
    const courseList = snapshot.docs.map((doc) => doc.data());

    const container = document.getElementById("profileCourses");
    if (!container) return;

    container.innerHTML = ""; // Clear current list

    courseList.forEach((course) => {
      const div = document.createElement("div");
      div.className = "mb-2 p-3 rounded border bg-white shadow";
      div.innerHTML = `
  <h4 class="font-semibold">${course.courseId}</h4>
  <p class="text-sm text-gray-500">
    Unlocked on ${new Date(course.unlockedAt?.seconds * 1000).toLocaleDateString()}
  </p>
`;
      container.appendChild(div);
    });

  } catch (error) {
    console.error("Failed to refresh profile courses:", error);
  }
}
