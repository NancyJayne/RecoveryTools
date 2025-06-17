// src/utils/date-utils.js
import { DateTime } from "luxon";

/**
 * Get user's local timezone (e.g., "Australia/Brisbane")
 * @returns {string}
 */
export function detectUserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Populate a select dropdown with Australian timezone options
 * @param {HTMLSelectElement} selectEl
 * @param {string} selected
 */
export function populateTimezoneDropdown(selectEl, selected = "") {
  const zones = [
    "Australia/Sydney",
    "Australia/Melbourne",
    "Australia/Brisbane",
    "Australia/Perth",
    "Australia/Adelaide",
    "Australia/Darwin",
    "Australia/Hobart",
  ];
  selectEl.innerHTML = zones
    .map((zone) => {
      const isSelected = zone === selected ? "selected" : "";
      return `<option value="${zone}" ${isSelected}>${zone}</option>`;
    })
    .join("");
}

/**
 * Convert local datetime string (dd/MM/yyyy HH:mm) and timezone into UTC ISO
 * @param {string} localDateTime - e.g. "30/07/2025 10:00"
 * @param {string} timezone - e.g. "Australia/Brisbane"
 * @returns {string} UTC ISO string
 */
export function convertToUTC(localDateTime, timezone) {
  const [date, time] = localDateTime.split(" ");
  const [day, month, year] = date.split("/").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  return DateTime.fromObject({ year, month, day, hour, minute }, { zone: timezone })
    .toUTC()
    .toISO();
}

/**
 * Convert UTC ISO date to local formatted string in user's timezone
 * @param {string} utcISO
 * @param {string} timezone
 * @returns {string} DD/MM/YYYY HH:mm
 */
export function formatLocalTime(utcISO, timezone) {
  return DateTime.fromISO(utcISO, { zone: "utc" })
    .setZone(timezone)
    .toFormat("dd/MM/yyyy HH:mm");
}

/**
 * Get current datetime in user's timezone as DD/MM/YYYY HH:mm
 * @param {string} timezone
 * @returns {string}
 */
export function getNowInUserTimezone(timezone) {
  return DateTime.now().setZone(timezone).toFormat("dd/MM/yyyy HH:mm");
}

/**
 * Format a Firestore timestamp or JS Date into DD/MM/YYYY HH:MM (24hr) format
 * @param {Timestamp|Date|string|number|null} timestamp 
 * @returns {string}
 */
export function formatDateTime(timestamp) {
  if (!timestamp) return "—";

  const date = typeof timestamp?.toDate === "function"
    ? timestamp.toDate()
    : new Date(timestamp);

  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(",", "");
}

/**
 * Fallback formatter for workshops
 * @param {Object} workshop - Workshop object containing dateUTC
 * @param {string} timezone - User timezone
 * @returns {string} - Formatted date string
 */
export function formatWorkshopForViewer(workshop, timezone) {
  if (!workshop?.dateUTC) return "Date not set";
  try {
    return DateTime.fromISO(workshop.dateUTC, { zone: "utc" })
      .setZone(timezone)
      .toFormat("dd/MM/yyyy HH:mm");
  } catch {
    return workshop.dateUTC;
  }
}
