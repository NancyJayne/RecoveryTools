// utils/calendar.js

import { DateTime } from "luxon";

/**
 * Format a Date object to Google Calendar format with timezone support.
 * Returns a UTC ISO string formatted as: YYYYMMDDTHHMMSSZ
 *
 * @param {Date|string|number} dateInput - Local date input
 * @param {string} timezone - IANA timezone string, e.g. 'Australia/Brisbane'
 * @param {boolean} end - Whether to add one hour for end time
 * @returns {string} Google Calendar formatted datetime
 */
export function formatCalendarDate(dateInput, timezone = "Australia/Sydney", end = false) {
  const dateTime = DateTime.fromJSDate(new Date(dateInput), { zone: timezone });
  const finalTime = end ? dateTime.plus({ hours: 1 }) : dateTime;
  return finalTime.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
}

/**
 * Converts UTC time to formatted local time string with timezone name
 * e.g. '27/05/2025 10:30 AM (AEST)'
 *
 * @param {string|Date} utcDateTime - ISO string or Date object
 * @param {string} timezone - IANA timezone string to convert to
 * @returns {string}
 */
export function formatLocalCalendarLabel(utcDateTime, timezone = "Australia/Sydney") {
  return DateTime.fromISO(utcDateTime, { zone: "utc" })
    .setZone(timezone)
    .toFormat("dd/MM/yyyy hh:mm a '()'", { 
      locale: "en-AU", 
      timeZoneName: "short", 
    })
    .replace("()", DateTime.now().setZone(timezone).offsetNameShort); // Insert AEST/ACST/etc
}
