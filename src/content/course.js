import { httpsCallable } from "firebase/functions";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, functions } from "../utils/firebase-config.js";
import { showTabContent, showToast } from "../utils/utils.js";
import { renderProductCatalog, setupCatalogClickHandler } from "./product-catalog.js";

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function labelForKey(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function youtubeEmbedUrl(value) {
  try {
    const url = new URL(value);
    const videoId = url.hostname === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.searchParams.get("v") ||
        (url.pathname.startsWith("/embed/") ? url.pathname.split("/")[2] : "");
    return videoId ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}` : "";
  } catch {
    return "";
  }
}

function renderMedia(media = []) {
  const wrapper = element("div", "mt-4 grid gap-4");
  media.forEach((asset) => {
    const type = String(asset.type || "").toLowerCase();
    if (type === "image") {
      const image = element("img", "max-h-[32rem] w-full rounded object-contain bg-black/20");
      image.src = asset.url;
      image.alt = asset.altText || asset.title || "Course content image";
      image.loading = "lazy";
      wrapper.appendChild(image);
      return;
    }
    if (type === "video") {
      const embedUrl = asset.embedUrl || youtubeEmbedUrl(asset.url);
      if (embedUrl) {
        const frame = element("iframe", "aspect-video w-full rounded bg-black");
        frame.src = embedUrl;
        frame.title = asset.title || "Course video";
        frame.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture";
        frame.allowFullscreen = true;
        frame.loading = "lazy";
        wrapper.appendChild(frame);
      } else if (asset.url) {
        const video = element("video", "aspect-video w-full rounded bg-black");
        video.src = asset.url;
        video.controls = true;
        video.preload = "metadata";
        video.controlsList = "nodownload noremoteplayback";
        wrapper.appendChild(video);
      }
      return;
    }
    if (asset.url) {
      const link = element(
        "a",
        "inline-flex w-fit items-center rounded border border-[#407471] px-3 py-2 text-sm text-[#7fc2bd] hover:bg-[#407471]/20",
        `Open ${asset.title || "resource"}`,
      );
      link.href = asset.url;
      link.target = "_blank";
      link.rel = "noopener";
      wrapper.appendChild(link);
    }
  });
  return wrapper;
}

function renderTemplateValues(values = {}) {
  const visibleEntries = Object.entries(values).filter(([, value]) => {
    if (value === null || value === undefined || value === "") return false;
    if (typeof value === "string") return !/^(ASSET|ITEM|BLUEPRINT|PLAN)-/.test(value);
    if (Array.isArray(value)) {
      return value.some((entry) => (
        typeof entry !== "string" || !/^(ASSET|ITEM|BLUEPRINT|PLAN)-/.test(entry)
      ));
    }
    return typeof value !== "object";
  });
  if (!visibleEntries.length) return null;
  const list = element("dl", "mt-4 grid gap-2 rounded bg-gray-950/40 p-3 text-sm");
  visibleEntries.forEach(([key, rawValue]) => {
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);
    const row = element("div", "grid gap-1 sm:grid-cols-[10rem_1fr]");
    row.append(
      element("dt", "font-medium text-gray-300", labelForKey(key)),
      element("dd", "whitespace-pre-wrap text-gray-400", value),
    );
    list.appendChild(row);
  });
  return list;
}

function formatWorkshopDateTime(value) {
  if (!value) return "";
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)
    ? `${value}+10:00`
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function renderWorkshopBooking(booking = {}) {
  if (!booking || !Object.keys(booking).length) return null;
  const section = element("section", "mt-5 rounded border border-[#407471]/70 bg-[#153b38]/40 p-4");
  section.appendChild(element("h2", "text-lg font-semibold text-white", "Your workshop booking"));
  if (booking.name) section.appendChild(element("p", "mt-1 font-medium text-[#7fc2bd]", booking.name));
  const details = element("dl", "mt-4 grid gap-3 text-sm sm:grid-cols-2");
  const entries = [
    ["Starts", formatWorkshopDateTime(booking.eventStartAt)],
    ["Ends", formatWorkshopDateTime(booking.eventEndAt)],
    ["Address", booking.eventLocation],
    ["Instructor", booking.instructor],
    ["Booking information", booking.calendarBookingReference],
  ].filter(([, value]) => value);
  entries.forEach(([label, value]) => {
    const row = element("div", "rounded bg-gray-950/30 p-3");
    row.append(
      element("dt", "font-medium text-gray-400", label),
      element("dd", "mt-1 whitespace-pre-wrap text-white", value),
    );
    details.appendChild(row);
  });
  section.appendChild(details);
  return section;
}

function renderItem(item) {
  const card = element("article", "rounded border border-gray-700 bg-gray-800/70 p-4");
  card.appendChild(element("h3", "text-lg font-semibold text-white", item.name || item.id));
  if (item.type) card.appendChild(element("p", "mt-1 text-xs uppercase tracking-wide text-[#7fc2bd]", item.type));
  if (item.shortDescription) {
    card.appendChild(element("p", "mt-3 text-gray-300", item.shortDescription));
  }
  if (item.longDescription && item.longDescription !== item.shortDescription) {
    card.appendChild(element("p", "mt-3 whitespace-pre-wrap text-gray-300", item.longDescription));
  }
  const values = renderTemplateValues(item.templateFieldValues);
  if (values) card.appendChild(values);
  if (item.media?.length) card.appendChild(renderMedia(item.media));
  return card;
}

function renderModuleContent(module, content) {
  content.textContent = "";
  content.appendChild(element("p", "text-sm font-medium text-[#7fc2bd]", `Module ${module.sortOrder}`));
  content.appendChild(element("h2", "mt-1 text-2xl font-bold text-white", module.name || module.id));
  if (module.shortDescription) {
    content.appendChild(element("p", "mt-3 text-gray-300", module.shortDescription));
  }
  if (module.longDescription && module.longDescription !== module.shortDescription) {
    content.appendChild(element("p", "mt-3 whitespace-pre-wrap text-gray-300", module.longDescription));
  }
  const values = renderTemplateValues(module.templateFieldValues);
  if (values) content.appendChild(values);
  if (module.media?.length) content.appendChild(renderMedia(module.media));
  const itemHeading = element(
    "h3",
    "mt-8 text-xl font-semibold text-white",
    module.items?.length ? "Module content" : "No content has been added to this module yet.",
  );
  content.appendChild(itemHeading);
  if (module.items?.length) {
    const items = element("div", "mt-4 grid gap-4");
    module.items.forEach((item) => items.appendChild(renderItem(item)));
    content.appendChild(items);
  }
}

async function loadCourseProgress(courseId) {
  if (!auth?.currentUser?.uid) return new Set();
  const progressRef = doc(db, "users", auth.currentUser.uid, "courseProgress", courseId);
  const snapshot = await getDoc(progressRef);
  return new Set(snapshot.exists() ? snapshot.data()?.completedModuleIds || [] : []);
}

async function saveCourseProgress(courseId, completedModuleIds) {
  if (!auth?.currentUser?.uid) return;
  const progressRef = doc(db, "users", auth.currentUser.uid, "courseProgress", courseId);
  await setDoc(progressRef, {
    courseId,
    userId: auth.currentUser.uid,
    completedModuleIds: [...completedModuleIds],
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

function progressSummary(modules, completedModuleIds, contentLabel = "Course") {
  const complete = modules.filter((module) => completedModuleIds.has(module.id)).length;
  const percent = modules.length ? Math.round((complete / modules.length) * 100) : 0;
  const wrapper = element("section", "mt-6 rounded border border-gray-700 bg-gray-950/40 p-4");
  const heading = element("div", "flex items-center justify-between gap-3 text-sm");
  heading.append(
    element("span", "font-semibold text-white", `${contentLabel} progress`),
    element("span", "text-gray-300", `${complete} of ${modules.length} modules complete`),
  );
  const track = element("div", "mt-3 h-2 overflow-hidden rounded bg-gray-700");
  const bar = element("div", "h-full rounded bg-[#407471]");
  bar.style.width = `${percent}%`;
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuenow", String(percent));
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  track.appendChild(bar);
  wrapper.append(heading, track, element("p", "mt-2 text-xs text-gray-400", `${percent}% complete`));
  return wrapper;
}

function renderCoursePlayer(payload, completedModuleIds = new Set(), options = {}) {
  const contentLabel = options.contentLabel || "Course";
  const contentLabelLower = contentLabel.toLowerCase();
  const container = document.getElementById(options.containerId || "courseDetailContainer");
  if (!container) return;
  const course = payload.course || {};
  const modules = Array.isArray(payload.modules) ? payload.modules : [];
  container.className = "mx-auto max-w-7xl rounded bg-gray-900 p-4 shadow sm:p-6";
  container.textContent = "";

  const back = element(
    "a",
    "inline-block text-sm text-[#7fc2bd] hover:underline",
    `← Back to My ${contentLabel}s`,
  );
  back.href = `/profile#${options.profileHash || "myCourses"}`;
  back.classList.add("router-link");
  container.appendChild(back);

  const header = element("header", "mt-4 border-b border-gray-700 pb-5");
  header.appendChild(element("h1", "text-3xl font-bold text-white", course.name || course.id));
  if (course.shortDescription) header.appendChild(element("p", "mt-2 text-gray-300", course.shortDescription));
  if (course.longDescription && course.longDescription !== course.shortDescription) {
    header.appendChild(element("p", "mt-3 whitespace-pre-wrap text-gray-400", course.longDescription));
  }
  if (course.media?.length) header.appendChild(renderMedia(course.media));
  container.appendChild(header);
  if (contentLabelLower === "workshop") {
    const booking = renderWorkshopBooking(payload.booking);
    if (booking) container.appendChild(booking);
  }

  if (!modules.length) {
    container.appendChild(element(
      "p",
      "mt-6 text-gray-400",
      `No ${contentLabelLower} modules have been added yet.`,
    ));
    showTabContent(options.sectionId || "courseDetailSection");
    return;
  }

  container.appendChild(progressSummary(modules, completedModuleIds, contentLabel));
  container.appendChild(element("h2", "mt-8 text-2xl font-semibold text-white", `${contentLabel} modules`));
  const moduleList = element("div", "mt-4 grid gap-3");
  modules.forEach((module, index) => {
    const row = element("div", "flex items-center gap-3 rounded border border-gray-700 bg-gray-800/70 p-3");
    const checkbox = element("input", "h-5 w-5 shrink-0 accent-[#407471]");
    checkbox.type = "checkbox";
    checkbox.checked = completedModuleIds.has(module.id);
    checkbox.setAttribute("aria-label", `Mark ${module.name || `Module ${index + 1}`} complete`);
    checkbox.addEventListener("change", async () => {
      checkbox.checked ? completedModuleIds.add(module.id) : completedModuleIds.delete(module.id);
      try {
        await saveCourseProgress(course.id, completedModuleIds);
        renderCoursePlayer(payload, completedModuleIds, options);
      } catch (error) {
        console.error("Failed to save course progress:", error);
        showToast("Could not save course progress.", "error");
      }
    });
    const button = element("button", "min-w-0 flex-1 rounded px-2 py-2 text-left hover:bg-gray-700/70");
    button.type = "button";
    button.append(
      element("span", "block text-xs uppercase tracking-wide text-[#7fc2bd]", `Module ${index + 1}`),
      element("span", "mt-1 block text-lg font-semibold text-white", module.name || module.id),
      element("span", "mt-1 block text-sm text-gray-400", module.shortDescription || "Open module"),
    );
    button.addEventListener("click", () => {
      container.className = "mx-auto max-w-5xl rounded bg-gray-900 p-4 shadow sm:p-6";
      container.textContent = "";
      const overview = element(
        "button",
        "text-sm text-[#7fc2bd] hover:underline",
        `← Back to ${contentLabelLower} overview`,
      );
      overview.type = "button";
      overview.addEventListener("click", () => renderCoursePlayer(payload, completedModuleIds, options));
      const isComplete = completedModuleIds.has(module.id);
      const completion = element(
        "button",
        isComplete
          ? "rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
          : "rounded bg-[#407471] px-3 py-2 text-sm font-semibold text-white hover:bg-[#305a56]",
        isComplete ? "Mark as not complete" : "Mark module complete",
      );
      completion.type = "button";
      completion.addEventListener("click", async () => {
        isComplete ? completedModuleIds.delete(module.id) : completedModuleIds.add(module.id);
        try {
          await saveCourseProgress(course.id, completedModuleIds);
          renderCoursePlayer(payload, completedModuleIds, options);
        } catch (error) {
          console.error("Failed to save course progress:", error);
          showToast("Could not save course progress.", "error");
        }
      });
      const content = element("main", "pt-6");
      renderModuleContent({ ...module, sortOrder: index + 1 }, content);
      container.appendChild(content);
      const actions = element(
        "div",
        "mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-gray-700 pt-4",
      );
      actions.append(overview, completion);
      container.appendChild(actions);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    row.append(checkbox, button);
    moduleList.appendChild(row);
  });
  container.appendChild(moduleList);
  showTabContent(options.sectionId || "courseDetailSection");
}

function renderCourseError(message, options = {}) {
  const contentLabel = options.contentLabel || "Course";
  const container = document.getElementById(options.containerId || "courseDetailContainer");
  if (!container) return;
  container.textContent = "";
  container.append(
    element("h1", "text-2xl font-semibold text-white", `${contentLabel} unavailable`),
    element("p", "mt-3 text-gray-300", message),
  );
  const back = element(
    "a",
    "mt-5 inline-block text-[#7fc2bd] hover:underline",
    `Back to My ${contentLabel}s`,
  );
  back.href = `/profile#${options.profileHash || "myCourses"}`;
  back.classList.add("router-link");
  container.appendChild(back);
  showTabContent(options.sectionId || "courseDetailSection");
}

export async function handleUnlockedPlanFromURL(options = {}) {
  const queryParam = options.queryParam || "course";
  const contentType = options.contentType || "course";
  const contentLabel = options.contentLabel || "Course";
  const courseId = new URLSearchParams(window.location.search).get(queryParam);
  if (!courseId) return false;
  const container = document.getElementById(options.containerId || "courseDetailContainer");
  if (container) {
    container.textContent = "";
    container.appendChild(element("p", "text-gray-400", `Loading your ${contentType}...`));
  }
  showTabContent(options.sectionId || "courseDetailSection");
  try {
    const getUnlockedCourse = httpsCallable(functions, "getUnlockedCourse");
    const response = await getUnlockedCourse({ courseId, contentType });
    const payload = response.data || {};
    renderCoursePlayer(payload, new Set(), options);
    loadCourseProgress(payload.course?.id || courseId)
      .then((progress) => renderCoursePlayer(payload, progress, options))
      .catch((progressError) => {
        console.warn(`${contentLabel} progress could not be loaded; using an empty progress state.`, progressError);
      });
  } catch (error) {
    console.error(`Failed to load unlocked ${contentType}:`, error);
    const message = error?.code?.includes("unauthenticated")
      ? `Sign in to view this ${contentType}.`
      : error?.message || `The ${contentType} could not be loaded.`;
    renderCourseError(message, options);
  }
  return true;
}

export async function handleCourseFromURL() {
  return handleUnlockedPlanFromURL();
}

export async function loadCourses() {
  await renderProductCatalog({
    gridId: "courseGrid",
    type: "course",
    emptyMessage: "No courses found.",
    errorMessage: "Failed to load courses.",
  });
}

export async function initCoursesPage() {
  setupCatalogClickHandler("courseGrid");
  if (await handleCourseFromURL()) return;
  showTabContent("coursesSection");
  await loadCourses();
}

export default initCoursesPage;
