function dateValue(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const source = typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)
    ? `${value}+10:00`
    : value;
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function accessExpiry(grant = {}, from = new Date()) {
  const explicitEnd = dateValue(grant.endsAt);
  if (explicitEnd) return explicitEnd;
  const durationType = String(grant.durationType || "permanent").toLowerCase();
  const durationValue = Number(grant.durationValue || 0);
  if (!durationValue || ["permanent", "lifetime", "none"].includes(durationType)) return null;
  const expiresAt = new Date(from);
  if (["day", "days"].includes(durationType)) expiresAt.setUTCDate(expiresAt.getUTCDate() + durationValue);
  else if (["week", "weeks"].includes(durationType)) expiresAt.setUTCDate(expiresAt.getUTCDate() + durationValue * 7);
  else if (["month", "months"].includes(durationType)) {
    expiresAt.setUTCMonth(expiresAt.getUTCMonth() + durationValue);
  }
  else if (["year", "years"].includes(durationType)) {
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + durationValue);
  }
  else return null;
  return expiresAt;
}
