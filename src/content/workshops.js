// ✅ workshops.js module with corrected structure

import { db, auth } from "../utils/firebase-config.js";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { DateTime } from "luxon";
import { showToast, showSection } from "../utils/utils.js";
import { formatCalendarDate } from "../utils/calendar.js";
import { formatWorkshopForViewer } from "../utils/date-utils.js";

const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const workshopGrid = document.getElementById("workshopGrid");
const pastWorkshopGrid = document.getElementById("pastWorkshopGrid");
const filterLocation = document.getElementById("filterLocation");
const filterTag = document.getElementById("filterTag");

let allWorkshops = [];
const placeholderImg =
  "https://firebasestorage.googleapis.com/v0/b/" +
  "recovery-tools.firebasestorage.app/o/videos%2FImages%2Fworkshop-placeholder.png?alt=media";
const btnBaseClasses =
  "px-4 py-2 rounded text-white font-semibold flex items-center gap-2";

export function showWorkshopDetail(workshop, overrideTZ = userTimezone) {
  const container = document.getElementById("workshopDetailContainer");
  if (!container) return;

  let eventDateFormatted = "Date not set";
  let eventDateForCalendar = null;

  if (workshop.dateUTC && workshop.timezone) {
    const dt = DateTime.fromISO(workshop.dateUTC, { zone: "utc" }).setZone(overrideTZ);
    eventDateFormatted = dt.toFormat("dd/MM/yyyy hh:mm a") + ` (${overrideTZ})`;
    eventDateForCalendar = new Date(dt.toISO());
  }

  const locationQuery = workshop.location
    ? encodeURIComponent(workshop.location)
    : null;
  const mapsLink = locationQuery
    ? `https://www.google.com/maps/search/?api=1&query=${locationQuery}`
    : null;

  let calendarLink = null;
  if (eventDateForCalendar) {
    const params = [
      `text=${encodeURIComponent(workshop.name)}`,
      `dates=${formatCalendarDate(eventDateForCalendar)}/${formatCalendarDate(eventDateForCalendar, true)}`,
      `details=${encodeURIComponent(workshop.description || "")}`,
      `location=${encodeURIComponent(workshop.location || "")}`,
    ].join("&");
    calendarLink = `https://www.google.com/calendar/render?action=TEMPLATE&${params}`;
  }

  container.textContent = "";

  const img = document.createElement("img");
  img.src = workshop.image || placeholderImg;
  img.alt = workshop.name;
  img.className = "w-full h-64 object-cover rounded mb-6";
  container.appendChild(img);

  const title = document.createElement("h1");
  title.textContent = workshop.name;
  title.className = "text-3xl font-bold mb-4";
  container.appendChild(title);

  const dateDiv = document.createElement("div");
  dateDiv.className = "text-gray-400 mb-2";
  dateDiv.innerHTML = `<strong>Date:</strong> ${eventDateFormatted}`;
  container.appendChild(dateDiv);

  const locDiv = document.createElement("div");
  locDiv.className = "text-gray-400 mb-6";
  locDiv.innerHTML = `<strong>Location:</strong> ${workshop.location || "Location not set"}`;
  container.appendChild(locDiv);

  const desc = document.createElement("p");
  desc.className = "text-gray-400 mb-6";
  desc.textContent = workshop.description || "No description available.";
  container.appendChild(desc);

  const btnGroup = document.createElement("div");
  btnGroup.className = "flex flex-wrap gap-3 mb-6 items-center";

  const price = document.createElement("span");
  price.className = "text-green-400 text-2xl font-bold";
  price.textContent = `$${(workshop.price / 100).toFixed(2)}`;
  btnGroup.appendChild(price);

  const regBtn = document.createElement("button");
  regBtn.className = "bg-[#407471] px-6 py-3 rounded text-white font-semibold hover:bg-[#305a56]";
  regBtn.textContent = "Register Now";
  regBtn.onclick = () => redirectToPayment(workshop.paymentLink);
  btnGroup.appendChild(regBtn);

  if (mapsLink) {
    const mapAnchor = document.createElement("a");
    mapAnchor.href = mapsLink;
    mapAnchor.target = "_blank";
    mapAnchor.className = `bg-blue-600 hover:bg-blue-700 ${btnBaseClasses}`;
    mapAnchor.innerHTML = "📍 <span>View Location</span>";
    btnGroup.appendChild(mapAnchor);
  }

  if (calendarLink) {
    const calAnchor = document.createElement("a");
    calAnchor.href = calendarLink;
    calAnchor.target = "_blank";
    calAnchor.className = `bg-yellow-500 hover:bg-yellow-600 ${btnBaseClasses}`;
    calAnchor.innerHTML = "🗕️ <span>Add to Google Calendar</span>";
    btnGroup.appendChild(calAnchor);

    const icalBtn = document.createElement("button");
    icalBtn.className = `bg-purple-600 hover:bg-purple-700 ${btnBaseClasses}`;
    icalBtn.innerHTML = "🗓️ <span>Add to iCal</span>";
    icalBtn.onclick = () =>
      downloadICS(
        workshop.name,
        eventDateForCalendar.toISOString(),
        workshop.location || "",
        workshop.description || "",
      );
    btnGroup.appendChild(icalBtn);
  }

  if (auth.currentUser) {
    const promoteBtn = document.createElement("button");
    promoteBtn.className = `bg-indigo-600 hover:bg-indigo-700 ${btnBaseClasses}`;
    promoteBtn.innerHTML = "📣 <span>Promote This Event</span>";
    promoteBtn.onclick = () => copyReferralLink(workshop.id);
    btnGroup.appendChild(promoteBtn);
  }

  const shareBtn = document.createElement("button");
  shareBtn.className = `bg-gray-700 hover:bg-gray-800 ${btnBaseClasses}`;
  shareBtn.innerHTML = "💬 <span>Share This Workshop</span>";
  shareBtn.onclick = () => copyWorkshopLink(workshop.id);
  btnGroup.appendChild(shareBtn);

  container.appendChild(btnGroup);

  const backBtn = document.createElement("button");
  backBtn.className = "mt-6 text-[#407471] hover:underline text-sm";
  backBtn.textContent = "← Back to Workshops";
  backBtn.onclick = goBackToWorkshops;
  container.appendChild(backBtn);

  showSection("workshopDetailSection");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export async function loadWorkshops() {
  try {
    const snapshot = await getDocs(
      query(
        collection(db, "workshops"),
        where("visible", "==", true),
        orderBy("dateUTC", "desc"),
      ),
    );
    allWorkshops = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderWorkshopGrids();
    populateFilterOptions();
  } catch (err) {
    console.error("Failed to load workshops:", err);
    showToast("Failed to load workshops.", "error");
  }
}

function renderWorkshopGrids() {
  const now = DateTime.now().toUTC();
  const userTZ = userTimezone;
  workshopGrid.innerHTML = "";
  pastWorkshopGrid.innerHTML = "";

  const filtered = allWorkshops.filter((w) => {
    const inFuture = DateTime.fromISO(w.dateUTC).toUTC() > now;
    const matchLocation = !filterLocation?.value || w.location?.includes(filterLocation.value);
    const matchTag = !filterTag?.value || w.tags?.includes(filterTag.value);
    return matchLocation && matchTag && inFuture;
  });

  const past = allWorkshops.filter((w) => DateTime.fromISO(w.dateUTC).toUTC() <= now);

  for (const workshop of filtered) {
    const card = createWorkshopCard(workshop, userTZ);
    workshopGrid.appendChild(card);
  }

  for (const workshop of past) {
    const card = createWorkshopCard(workshop, userTZ);
    pastWorkshopGrid.appendChild(card);
  }
}

function createWorkshopCard(workshop, userTZ) {
  const card = document.createElement("div");
  card.className = "bg-gray-800 p-4 rounded shadow cursor-pointer hover:bg-gray-700";
  card.innerHTML = `
    <h3 class="text-lg font-bold text-white mb-1">${workshop.title}</h3>
    <p class="text-sm text-gray-400">📍 ${workshop.location || "TBA"}</p>
    <p class="text-sm text-gray-400">🕒 ${formatWorkshopForViewer(workshop, userTZ)} (${userTZ})</p>
  `;
  card.addEventListener("click", () => showWorkshopDetail(workshop));
  return card;
}

function populateFilterOptions() {
  const locations = [...new Set(allWorkshops.map((w) => w.location).filter(Boolean))];
  const tags = [...new Set(allWorkshops.flatMap((w) => w.tags || []))];

  if (filterLocation) {
    filterLocation.innerHTML = "<option value=\"\">All Locations</option>" +
      locations.map((l) => `<option value="${l}">${l}</option>`).join("");
  }

  if (filterTag) {
    filterTag.innerHTML = "<option value=\"\">All Tags</option>" +
      tags.map((t) => `<option value="${t}">${t}</option>`).join("");
  }

  filterLocation?.addEventListener("change", renderWorkshopGrids);
  filterTag?.addEventListener("change", renderWorkshopGrids);
}

export function goBackToWorkshops() {
  history.back();
  setTimeout(() => {
    showSection("workshopsSection");
    loadWorkshops();
  }, 500);
}

export function downloadICS(title, startDateISO, location, description) {
  const start = new Date(startDateISO);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const pad = (num) => (num < 10 ? "0" + num : num);

  const formatICSDate = (date) => {
    return date.getUTCFullYear() +
      pad(date.getUTCMonth() + 1) +
      pad(date.getUTCDate()) + "T" +
      pad(date.getUTCHours()) +
      pad(date.getUTCMinutes()) +
      pad(date.getUTCSeconds()) + "Z";
  };

  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RecoveryTools Workshop//EN",
    "BEGIN:VEVENT",
    `UID:${Date.now()}@recoverytools`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${formatICSDate(start)}`,
    `DTEND:${formatICSDate(end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/\s+/g, "_")}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
  showToast("Workshop added to your calendar!", "success");
}

export function initWorkshopsPage() {
  loadWorkshops();
}
