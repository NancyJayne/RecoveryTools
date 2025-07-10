// course.js
import { db } from "../utils/firebase-config.js";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from "firebase/firestore";
import { showToast, redirectToPayment } from "../utils/utils.js";
import { refreshProfileCourses } from "../profile/profile-utils.js";
import { createProductTile } from "../shop/shop-products.js";

export async function handleCourseFromURL() {
  const params = new URLSearchParams(window.location.search);
  const courseId = params.get("course");

  if (courseId) {
    try {
      const docRef = doc(db, "courses", courseId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        const course = {
          id: docSnap.id,
          ...data,
          name: data.title || data.name,
        };
        showCourseDetail(course);

        // 🧹 Push clean URL after loading
        const cleanUrl = window.location.origin + "/courses";
        window.history.pushState({}, document.title, cleanUrl);
      } else {
        console.warn("Course not found:", courseId);
        showToast("Course not found.", "error");
      }
    } catch (error) {
      console.error("Error loading course from URL:", error);
      showToast("Failed to load course.", "error");
    }
  }
}

export async function loadCourses() {
  const grid = document.getElementById("courseGrid");
  if (!grid) return;

  grid.innerHTML = ""; // clear before loading

  const spinner = document.createElement("div");
  spinner.className = "flex justify-center items-center min-h-[200px]";

  const loader = document.createElement("div");
  loader.className =
    "w-12 h-12 border-4 border-t-4 border-gray-500 border-t-transparent rounded-full animate-spin";

  spinner.appendChild(loader);
  grid.appendChild(spinner);

  try {
    const q = query(
      collection(db, "courses"),
      where("visible", "==", true),
      orderBy("title", "asc"),
    );
    const snapshot = await getDocs(q);
    const courses = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        name: data.title || data.name,
      };
    });

    grid.innerHTML = "";

    if (courses.length === 0) {
      const message = document.createElement("p");
      message.className = "text-gray-400";
      message.textContent = "No courses found.";
      grid.appendChild(message);
      return;
    }

    courses.forEach((course) => {
      const tile = createProductTile(
        { ...course, name: course.title || course.name },
        "course",
      );
      if (tile) grid.appendChild(tile);
    });

  } catch (error) {
    console.error("Error loading courses:", error);
    grid.innerHTML = "";

    const message = document.createElement("p");
    message.className = "text-red-500";
    message.textContent = "Failed to load courses.";
    grid.appendChild(message);
  }
}

export function goBackToCourses() {
  history.back();
  setTimeout(() => {
    showSection("coursesSection");
    loadCourses();
  }, 500);
}

export function showCourseDetail(course) {
  const container = document.getElementById("courseDetailContainer");
  if (!container) return;

  container.innerHTML = ""; // Clear existing content

  const image = document.createElement("img");
  image.src =
    course.image ||
    "https://firebasestorage.googleapis.com/v0/b/recovery-tools.firebasestorage.app/o/videos%2FImages%2Fcourse-placeholder.png?alt=media";
  image.alt = course.title || course.name;
  image.className = "w-full h-64 object-cover rounded mb-6";

  const title = document.createElement("h1");
  title.className = "text-3xl font-bold mb-4";
  title.textContent = course.title || course.name;

  const description = document.createElement("p");
  description.className = "text-gray-400 mb-6";
  description.textContent = course.description || "No description available.";

  const priceRow = document.createElement("div");
  priceRow.className = "flex justify-between items-center mb-6";

  const price = document.createElement("span");
  price.className = "text-green-400 text-2xl font-bold";
  price.textContent = `$${(course.price / 100).toFixed(2)}`;

  const buyBtn = document.createElement("button");
  buyBtn.className =
    "bg-[#407471] px-6 py-3 rounded text-white font-semibold hover:bg-[#305a56]";
  buyBtn.textContent = "Buy Now";
  buyBtn.addEventListener("click", () =>
    redirectToPayment(course.paymentLink),
  );

  priceRow.append(price, buyBtn);

  const backBtn = document.createElement("button");
  backBtn.className =
    "mt-6 text-[#407471] hover:underline text-sm";
  backBtn.textContent = "← Back to Courses";
  backBtn.addEventListener("click", goBackToCourses);

  container.append(image, title, description, priceRow, backBtn);

  showSection("courseDetailSection");
  window.scrollTo({ top: 0, behavior: "smooth" });
}


export async function validateTokenFromURL() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

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

  } catch (err) {
    console.error(err);
    showToast("Something went wrong validating your code.", "error");
  }
}

// ✅ content/course.js
export function initCoursesPage() {
  loadCourses();
  handleCourseFromURL();
  validateTokenFromURL();
}

export default initCoursesPage;



