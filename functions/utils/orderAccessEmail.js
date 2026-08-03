function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function workshopLines(order = {}) {
  const lines = Array.isArray(order.products) ? order.products : order.orderLines || [];
  return lines.filter((line) =>
    String(line.productType || line.type || "").toLowerCase().includes("workshop"));
}

function formatDateTime(value) {
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

export function accessEmailDetails(order = {}) {
  const workshops = workshopLines(order);
  if (!workshops.length) {
    return {
      subjectPrefix: "content is ready",
      html: `
        <p>Your digital content has been unlocked and is ready in your Recovery Tools profile.</p>
        <p><a href="https://recoverytools.au/profile">View your unlocked content</a></p>
      `,
    };
  }
  const bookingHtml = workshops.map((line) => `
    <div style="margin:16px 0;padding:16px;border:1px solid #407471;border-radius:8px">
      <strong>${escapeHtml(line.name || line.productName || "Workshop")}</strong><br>
      ${line.variantName ? `${escapeHtml(line.variantName)}<br>` : ""}
      ${line.eventStartAt ? `<strong>Starts:</strong> ${escapeHtml(formatDateTime(line.eventStartAt))}<br>` : ""}
      ${line.eventEndAt ? `<strong>Ends:</strong> ${escapeHtml(formatDateTime(line.eventEndAt))}<br>` : ""}
      ${line.eventLocation ? `<strong>Address:</strong> ${escapeHtml(line.eventLocation)}<br>` : ""}
      ${line.instructor ? `<strong>Instructor:</strong> ${escapeHtml(line.instructor)}<br>` : ""}
      <strong>Tickets:</strong> ${Math.max(Number(line.quantity || 1), 1)}
    </div>
  `).join("");
  return {
    subjectPrefix: "workshop booking is confirmed",
    html: `
      <p>Your workshop booking is confirmed.</p>
      ${bookingHtml}
      <p>Your workshop content is also unlocked. Use My Workshops for pre-reading, downloads and modules.</p>
      <p><a href="https://recoverytools.au/profile#myWorkshops">View your workshop and content</a></p>
    `,
  };
}
