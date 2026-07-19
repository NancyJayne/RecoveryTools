import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";

const getContentBuilderData = httpsCallable(functions, "getContentBuilderData");
const updateContentControlRecord = httpsCallable(functions, "updateContentControlRecord");
const exportContentBackup = httpsCallable(functions, "exportContentBackup", { timeout: 120000 });

let state = {
  primary: "all",
  secondary: "all",
  detail: "all",
  category: "all",
  tag: "all",
  owner: "all",
  updated: "all",
  options: {},
  records: {
    items: [],
    blueprints: [],
    plans: [],
    campaigns: [],
  },
};

const PRIMARY_CONFIG = {
  all: { label: "Type", optionsKey: null },
  items: { label: "Item Type", optionsKey: "itemTypes" },
  blueprints: { label: "Blueprint Type", optionsKey: "blueprintTypes" },
  plans: { label: "Plan Type", optionsKey: "planTypes" },
  campaigns: { label: "Campaign Type", optionsKey: "campaignTypes" },
};

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function recordTypeLabel(type) {
  return {
    items: "Item",
    blueprints: "Blueprint",
    plans: "Plan",
    campaigns: "Campaign",
  }[type] || "Content";
}

function recordCollectionFromPrimary(primary) {
  if (primary === "all") return ["items", "blueprints", "plans"];
  return [primary];
}

function fillObjectSelect(select, values = []) {
  if (!select) return;
  select.innerHTML = values.map((value) =>
    `<option value="${escapeHTML(value.id)}">${escapeHTML(value.name)}</option>`,
  ).join("");
}

function categoryName(categoryId) {
  return (state.options.categoryOptions || [])
    .find((category) => category.id === categoryId)?.name || categoryId || "-";
}

function knownTags() {
  const tags = [
    ...(state.options.tagOptions || []).map((tag) => tag.name || tag.id),
    ...Object.values(state.records)
      .flatMap((records) => records.flatMap((record) => record.tags || [])),
  ];
  return uniqueTags(tags).sort((a, b) => a.localeCompare(b));
}

function normalizedTag(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueTags(tags = []) {
  const seen = new Set();
  return tags.filter((tag) => {
    const key = normalizedTag(tag);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function quickTagRow(value = "", createNew = false, unavailableTags = []) {
  const unavailable = new Set(unavailableTags.map(normalizedTag));
  const currentKey = normalizedTag(value);
  const options = knownTags().filter((tag) =>
    normalizedTag(tag) === currentKey || !unavailable.has(normalizedTag(tag)),
  );
  const selectVisibility = createNew ? "hidden" : "";
  const inputVisibility = createNew ? "" : "hidden";
  return `<div class="quick-tag-row flex gap-2">
    <select class="quick-tag-select min-w-0 flex-1 rounded bg-gray-800 px-3 py-2 text-white ${selectVisibility}">
      <option value="">${options.length ? "Choose tag" : "All available tags are already selected"}</option>
      ${options.map((tag) => `
        <option value="${escapeHTML(tag)}"${tag === value ? " selected" : ""}>${escapeHTML(tag)}</option>
      `).join("")}
    </select>
    <input
      class="quick-tag-new min-w-0 flex-1 rounded bg-gray-800 px-3 py-2 text-white ${inputVisibility}"
      placeholder="Enter new tag name"
      value="${createNew ? escapeHTML(value) : ""}"
    >
    <button type="button" class="remove-quick-tag rounded border border-gray-700 px-3 py-2">Remove</button>
  </div>`;
}

function renderQuickTags(tags = []) {
  const rows = document.getElementById("quickEditTagRows");
  if (!rows) return;
  const selected = uniqueTags(tags);
  rows.innerHTML = (selected.length ? selected : [""]).map((tag) =>
    quickTagRow(tag, false, selected.filter((otherTag) =>
      normalizedTag(otherTag) !== normalizedTag(tag),
    )),
  ).join("");
}

function selectedQuickTags() {
  return uniqueTags([...document.querySelectorAll(".quick-tag-row")].map((row) =>
    row.querySelector(".quick-tag-new:not(.hidden)")?.value || row.querySelector(".quick-tag-select")?.value,
  ).map((tag) => tag?.trim()).filter(Boolean));
}

function refreshQuickTagOptions() {
  const rows = [...document.querySelectorAll("#quickEditTagRows .quick-tag-row")];
  rows.forEach((row) => {
    const select = row.querySelector(".quick-tag-select");
    if (!select || select.classList.contains("hidden")) return;
    const current = select.value;
    const selectedElsewhere = rows
      .filter((otherRow) => otherRow !== row)
      .map((otherRow) =>
        otherRow.querySelector(".quick-tag-new:not(.hidden)")?.value ||
        otherRow.querySelector(".quick-tag-select")?.value,
      )
      .filter(Boolean);
    const unavailable = new Set(selectedElsewhere.map(normalizedTag));
    const options = knownTags().filter((tag) =>
      normalizedTag(tag) === normalizedTag(current) || !unavailable.has(normalizedTag(tag)),
    );
    select.innerHTML = [
      `<option value="">${options.length ? "Choose tag" : "All available tags are already selected"}</option>`,
      ...options.map((tag) =>
        `<option value="${escapeHTML(tag)}">${escapeHTML(tag)}</option>`,
      ),
    ].join("");
    if (options.some((tag) => normalizedTag(tag) === normalizedTag(current))) {
      select.value = options.find((tag) => normalizedTag(tag) === normalizedTag(current));
    }
  });
}

function handleQuickTagChange(event) {
  if (event.target.classList.contains("quick-tag-new")) {
    const row = event.target.closest(".quick-tag-row");
    const duplicate = [...document.querySelectorAll("#quickEditTagRows .quick-tag-row")]
      .filter((otherRow) => otherRow !== row)
      .some((otherRow) => normalizedTag(
        otherRow.querySelector(".quick-tag-new:not(.hidden)")?.value ||
        otherRow.querySelector(".quick-tag-select")?.value,
      ) === normalizedTag(event.target.value));
    if (duplicate && normalizedTag(event.target.value)) {
      event.target.value = "";
      showToast("That tag is already selected.", "error");
    }
  }
  refreshQuickTagOptions();
}

function syncCommerceControls() {
  document.querySelectorAll("[data-control-toggle]").forEach((label) => {
    const selected = label.querySelector("input")?.checked === true;
    label.classList.toggle("border-[#407471]", selected);
    label.classList.toggle("bg-[#153b38]", selected);
    label.classList.toggle("text-white", selected);
    label.classList.toggle("border-gray-700", !selected);
    label.classList.toggle("bg-gray-800", !selected);
    label.classList.toggle("text-gray-300", !selected);
  });
  document.getElementById("quickEditPricingFields")?.classList.toggle(
    "hidden",
    document.getElementById("quickEditIsShopProduct")?.checked !== true,
  );
}

function isoFromLocalInput(id) {
  const value = document.getElementById(id)?.value || "";
  return value ? new Date(value).toISOString() : "";
}

function fillSelect(select, values = [], fallback = "") {
  if (!select) return;
  const current = select.value;
  const options = values.length ? values : fallback ? [fallback] : [];
  select.innerHTML = options
    .map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
    .join("");
  if (options.includes(current)) {
    select.value = current;
  }
}

function setSelectValue(select, value) {
  if (!select) return;
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return;
  if (![...select.options].some((option) => option.value === cleanValue)) {
    select.insertAdjacentHTML(
      "afterbegin",
      `<option value="${escapeHTML(cleanValue)}">${escapeHTML(cleanValue)}</option>`,
    );
  }
  select.value = cleanValue;
}

function allRecords() {
  return recordCollectionFromPrimary(state.primary).flatMap((key) =>
    (state.records[key] || []).map((record) => ({ ...record, collectionKey: key })),
  );
}

function findRecord(collectionKey, recordId) {
  return (state.records[collectionKey] || [])
    .find((record) => record.id === recordId);
}

function searchableText(record) {
  return [
    record.id,
    record.name,
    record.type,
    record.firebaseType,
    record.itemType,
    record.categoryId,
    record.template,
    record.status,
    record.publishStatus,
    record.approvalStatus,
    record.owner,
    ...(record.tags || []),
  ].join(" ").toLowerCase();
}

function currentSecondaryValue(record) {
  return record.type ||
    record.itemType ||
    record.blueprintType ||
    record.planType ||
    record.campaignType ||
    "";
}

function recordMatchesDetail(record) {
  if (state.detail === "all") return true;
  if (state.detail.startsWith("status:")) {
    const expected = state.detail.slice("status:".length);
    const status = String(record.status || "").toLowerCase();
    if (expected === "awaiting-approval") {
      return ["review", "pending", "awaiting approval", "awaiting-approval"].includes(status);
    }
    if (expected === "active") return ["active", "published"].includes(status);
    return status === expected;
  }
  if (state.detail === "website-visible") {
    return record.websiteVisible === true || record.productVisible === true ||
      ["users", "unlocked"].includes(String(record.visibility || "").toLowerCase());
  }
  if (state.detail === "featured") return record.productFeatured === true;
  if (state.detail === "product") return record.hasItemProduct === true || record.isShopProduct === true;
  if (state.detail === "inventory-tracked") return record.inventoryTracked === true;
  return true;
}

function updatedDateMatches(record) {
  if (state.updated === "all") return true;
  const updatedAt = new Date(record.updatedAt || "");
  const hasValidUpdatedAt = !Number.isNaN(updatedAt.getTime());
  if (state.updated === "missing") return !hasValidUpdatedAt;

  const createdAt = new Date(record.createdAt || "");
  const effectiveDate = hasValidUpdatedAt ? updatedAt : createdAt;
  const [direction, amountText, unit] = state.updated.split(":");
  if (Number.isNaN(effectiveDate.getTime())) return false;

  const amount = Number(amountText);
  const cutoff = new Date();
  if (unit === "months") cutoff.setMonth(cutoff.getMonth() - amount);
  if (unit === "years") cutoff.setFullYear(cutoff.getFullYear() - amount);
  return direction === "within" ? effectiveDate >= cutoff : effectiveDate < cutoff;
}

function filteredRecords() {
  const search = String(document.getElementById("contentControlsSearch")?.value || "").toLowerCase().trim();

  return allRecords().filter((record) => {
    if (search && !searchableText(record).includes(search)) return false;
    if (state.secondary !== "all" && currentSecondaryValue(record) !== state.secondary) return false;
    if (state.category !== "all" && record.categoryId !== state.category) return false;
    if (state.tag !== "all" && !(record.tags || []).some((tag) => normalizedTag(tag) === state.tag)) return false;
    if (state.owner === "unassigned" && String(record.owner || "").trim()) return false;
    if (state.owner !== "all" && state.owner !== "unassigned" && normalizedTag(record.owner) !== state.owner) {
      return false;
    }
    if (!updatedDateMatches(record)) return false;
    return recordMatchesDetail(record);
  });
}

function renderPrimaryButtons() {
  document.querySelectorAll(".content-primary-filter").forEach((button) => {
    const active = button.dataset.primaryFilter === state.primary;
    button.classList.toggle("bg-[#407471]", active);
    button.classList.toggle("bg-gray-700", !active);
  });
}

function renderSecondaryFilter() {
  const label = document.getElementById("contentControlsSecondaryLabel");
  const select = document.getElementById("contentControlsSecondaryFilter");
  if (!select) return;

  const config = PRIMARY_CONFIG[state.primary] || PRIMARY_CONFIG.all;
  if (label) label.textContent = config.label;

  const values = config.optionsKey
    ? state.options[config.optionsKey] || []
    : [...new Set([
      ...(state.options.itemTypes || []),
      ...(state.options.blueprintTypes || []),
      ...(state.options.planTypes || []),
    ])].sort((a, b) => a.localeCompare(b));
  const validValues = new Set(["all", ...values]);
  if (!validValues.has(state.secondary)) {
    state.secondary = "all";
  }

  select.innerHTML = [
    `<option value="all">${state.primary === "all" ? "All types" :
      `All ${escapeHTML(config.label.toLowerCase())}`}</option>`,
    ...values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`),
  ].join("");
  select.value = state.secondary;
}

function renderCategoryFilter() {
  const select = document.getElementById("contentControlsCategoryFilter");
  if (!select) return;
  const categories = [...(state.options.categoryOptions || [])]
    .filter((category) => category.id)
    .sort((a, b) => categoryName(a.id).localeCompare(categoryName(b.id)));
  select.innerHTML = [
    "<option value=\"all\">All categories</option>",
    ...categories.map((category) =>
      `<option value="${escapeHTML(category.id)}">${escapeHTML(categoryName(category.id))}</option>`,
    ),
  ].join("");
  if (![...select.options].some((option) => option.value === state.category)) state.category = "all";
  select.value = state.category;
}

function renderTagFilter() {
  const select = document.getElementById("contentControlsTagFilter");
  if (!select) return;
  const tags = knownTags();
  select.innerHTML = [
    "<option value=\"all\">All tags</option>",
    ...tags.map((tag) => `<option value="${escapeHTML(normalizedTag(tag))}">${escapeHTML(tag)}</option>`),
  ].join("");
  if (![...select.options].some((option) => option.value === state.tag)) state.tag = "all";
  select.value = state.tag;
}

function renderOwnerFilter() {
  const select = document.getElementById("contentControlsOwnerFilter");
  if (!select) return;
  const owners = [...new Set(allRecords().map((record) => String(record.owner || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  select.innerHTML = [
    "<option value=\"all\">All owners</option>",
    "<option value=\"unassigned\">Unassigned</option>",
    ...owners.map((owner) => `<option value="${escapeHTML(normalizedTag(owner))}">${escapeHTML(owner)}</option>`),
  ].join("");
  if (![...select.options].some((option) => option.value === state.owner)) state.owner = "all";
  select.value = state.owner;
}

function renderUpdatedFilter() {
  const select = document.getElementById("contentControlsUpdatedFilter");
  if (!select) return;
  const options = [
    ["within:1:months", "Less than 1 month"],
    ["within:6:months", "Less than 6 months"],
    ["within:1:years", "Less than 1 year"],
    ["within:3:years", "Less than 3 years"],
    ["within:5:years", "Less than 5 years"],
    ["older:1:years", "More than 1 year"],
    ["older:3:years", "More than 3 years"],
    ["older:5:years", "More than 5 years"],
  ];
  select.innerHTML = [
    "<option value=\"all\">Any last update</option>",
    "<option value=\"missing\">No valid update date</option>",
    ...options.map(([value, label]) => `<option value="${value}">${label}</option>`),
  ].join("");
  select.value = state.updated;
}

function detailFilterOptions() {
  return [
    { value: "website-visible", label: "Visible on website" },
    { value: "featured", label: "Featured" },
    { value: "product", label: "Product" },
    { value: "inventory-tracked", label: "Inventory tracked" },
    { value: "status:draft", label: "Draft" },
    { value: "status:awaiting-approval", label: "Awaiting approval" },
    { value: "status:active", label: "Active" },
    { value: "status:archived", label: "Archived" },
    { value: "status:paused", label: "Paused" },
  ];
}

function renderDetailFilter() {
  const select = document.getElementById("contentControlsAddFilter");
  if (!select) return;
  select.innerHTML = [
    "<option value=\"all\">All records</option>",
    ...detailFilterOptions().map((option) =>
      `<option value="${escapeHTML(option.value)}">${escapeHTML(option.label)}</option>`,
    ),
  ].join("");
  if (![...select.options].some((option) => option.value === state.detail)) state.detail = "all";
  select.value = state.detail;
}

function statusBadge(record) {
  const status = record.status || "draft";
  const classes = status === "active"
    ? "bg-green-900/60 text-green-200"
    : status === "archived"
      ? "bg-gray-700 text-gray-200"
      : "bg-yellow-900/60 text-yellow-100";
  return `<span class="rounded px-2 py-1 text-xs font-semibold ${classes}">${escapeHTML(status)}</span>`;
}

function relationshipSummary(record) {
  if (record.collectionKey !== "items") return record.relationshipSummary || "-";
  const parts = [
    record.hasItemProduct ? "Product" : "",
    record.hasActivePrice ? "Price" : "",
    record.hasVariants ? `${record.variantCount || 0} variants` : "",
    record.hasPrimaryAsset ? "Primary asset" : "",
    record.unlocksAccess ? "Access" : "",
  ].filter(Boolean);
  return parts.join(" | ") || "No related records";
}

function relationshipHighlights(record) {
  if (record.collectionKey === "items") {
    if (record.hasItemProduct || record.isShopProduct) {
      const productName = record.productName || record.productId || "Product relationship";
      const price = record.productEffectiveShopPrice ?? record.productPrice;
      const numericPrice = Number(price);
      const details = [
        record.productShopStatus || "draft",
        price === null || price === undefined || price === "" || !Number.isFinite(numericPrice)
          ? "No price"
          : `$${numericPrice.toFixed(2)}`,
        record.productVisible ? "Marketplace visible" : "Marketplace hidden",
        record.hasVariants ? `${record.variantCount || 0} variants` : "No variants",
        record.hasPrimaryAsset ? "Primary asset" : "No primary asset",
      ];
      return `
        <div class="mt-3 rounded border border-green-800/70 bg-green-950/30 p-3 text-sm">
          <div class="font-semibold text-green-200">Product: ${escapeHTML(productName)}</div>
          <div class="mt-1 text-xs text-green-100/80">${escapeHTML(details.join(" / "))}</div>
        </div>
      `;
    }
    return `
      <div class="mt-3 text-xs text-gray-500">Not linked to a product.</div>
    `;
  }

  const relationships = [
    ["Items", record.linkedItemIds?.length || 0],
    ["Blueprints", record.linkedBlueprintIds?.length || 0],
    ["Plans", record.linkedPlanIds?.length || 0],
  ].filter(([, count]) => count > 0);
  if (!relationships.length) return `<div class="mt-3 text-xs text-gray-500">No linked components.</div>`;
  return `
    <div class="mt-3 flex flex-wrap gap-2">
      ${relationships.map(([label, count]) => `
        <span class="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300">
          ${count} linked ${escapeHTML(label.toLowerCase())}
        </span>
      `).join("")}
    </div>
  `;
}

function renderRows() {
  const list = document.getElementById("contentControlsList");
  const summary = document.getElementById("contentControlsSummary");
  if (!list) return;

  const records = filteredRecords();
  if (summary) summary.textContent = `${records.length} records shown`;

  if (!records.length) {
    list.textContent = "No records match these filters.";
    return;
  }

  list.innerHTML = records.map((record) => `
    <article class="rounded border border-gray-700 bg-gray-900/50 p-4">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div class="min-w-0">
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <span class="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300">
              ${escapeHTML(recordTypeLabel(record.collectionKey))}
            </span>
            <span class="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200">
              ${escapeHTML(currentSecondaryValue(record) || "No type")}
            </span>
            ${statusBadge(record)}
          </div>
          <h3 class="break-words text-lg font-semibold text-white">${escapeHTML(record.name)}</h3>
          <p class="mt-1 text-sm text-gray-300">${escapeHTML(categoryName(record.categoryId))}</p>
          <p class="break-all text-xs text-gray-400">${escapeHTML(record.id)}</p>
          ${relationshipHighlights(record)}
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="quick-edit-content-btn rounded bg-gray-700 px-3 py-2 text-sm text-white"
            data-record-type="${escapeHTML(record.collectionKey)}"
            data-record-id="${escapeHTML(record.id)}"
          >
            Quick Edit
          </button>
          <button
            type="button"
            class="edit-content-builder-btn rounded border border-gray-600 px-3 py-2 text-sm text-white
              hover:border-[#407471]"
            data-record-type="${escapeHTML(record.collectionKey)}"
            data-record-id="${escapeHTML(record.id)}"
          >
            Edit in Builder
          </button>
        </div>
      </div>
      <div class="mt-4 grid gap-2 text-xs text-gray-400 md:grid-cols-2">
        <div><strong class="text-gray-300">Template:</strong> ${escapeHTML(record.template || "-")}</div>
        <div><strong class="text-gray-300">Updated:</strong> ${escapeHTML(record.updatedAt || "-")}</div>
      </div>
    </article>
  `).join("");
}

function typeOptionsForRecord(record) {
  if (record.collectionKey === "items") return state.options.itemTypes || [];
  if (record.collectionKey === "blueprints") return state.options.blueprintTypes || [];
  if (record.collectionKey === "plans") return state.options.planTypes || [];
  if (record.collectionKey === "campaigns") return state.options.campaignTypes || [];
  return [];
}

function renderClassificationFields(record) {
  const container = document.getElementById("quickEditTypeFields");
  if (!container) return;

  if (record.collectionKey === "items") {
    container.innerHTML = `
      <label class="block">
        Type
        <select id="quickEditType" class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"></select>
      </label>
      <label class="block">
        Item Kind
        <select id="quickEditItemKind" class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"></select>
      </label>
      <label class="block">
        Category
        <select id="quickEditCategoryId" class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"></select>
      </label>
    `;
    fillSelect(document.getElementById("quickEditType"), state.options.itemTypes || [], "tool");
    fillSelect(document.getElementById("quickEditItemKind"), state.options.itemKinds || [], "Shop Product");
    fillObjectSelect(document.getElementById("quickEditCategoryId"), state.options.categoryOptions || []);
    setSelectValue(document.getElementById("quickEditType"), record.type);
    setSelectValue(document.getElementById("quickEditItemKind"), record.itemKind);
    setSelectValue(document.getElementById("quickEditCategoryId"), record.categoryId);
    return;
  }

  container.innerHTML = `
    <label class="block md:col-span-2">
      ${escapeHTML(PRIMARY_CONFIG[record.collectionKey]?.label || "Type")}
      <select id="quickEditType" class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"></select>
    </label>
  `;
  fillSelect(document.getElementById("quickEditType"), typeOptionsForRecord(record), record.type);
  setSelectValue(document.getElementById("quickEditType"), currentSecondaryValue(record));
}

function renderQuickEditRelationshipSummary(record) {
  const container = document.getElementById("quickEditRelationshipSummary");
  if (!container) return;
  container.innerHTML = `
    <h4 class="mb-2 font-semibold text-white">Relationship summary</h4>
    <p class="text-sm">${escapeHTML(relationshipSummary(record))}</p>
    ${record.missingData?.length ? `
      <div class="mt-3 rounded border border-yellow-600/60 bg-yellow-900/20 p-2 text-xs text-yellow-100">
        ${escapeHTML(record.missingData.join(" | "))}
      </div>
    ` : ""}
  `;
}

function openQuickEdit(record) {
  const drawer = document.getElementById("contentQuickEditDrawer");
  if (!drawer) return;

  document.getElementById("contentQuickEditMeta").textContent =
    `${recordTypeLabel(record.collectionKey)} | ${record.id}`;
  document.getElementById("quickEditRecordId").value = record.id;
  document.getElementById("quickEditRecordType").value = record.collectionKey;
  document.getElementById("quickEditName").value = record.name || "";
  document.getElementById("quickEditOwner").value = record.owner || "";
  renderQuickTags(record.tags || []);

  fillSelect(document.getElementById("quickEditStatus"), state.options.contentStatuses || [], "draft");
  fillSelect(document.getElementById("quickEditVisibility"), state.options.visibilityValues || [], "private");
  setSelectValue(document.getElementById("quickEditStatus"), record.status);
  setSelectValue(document.getElementById("quickEditVisibility"), record.visibility);
  document.getElementById("quickEditAmendmentComments").value = record.amendmentComments || "";
  document.getElementById("quickEditScheduledActiveAt").value = record.scheduledActiveAt?.slice(0, 16) || "";
  document.getElementById("quickEditScheduledPauseAt").value = record.scheduledPauseAt?.slice(0, 16) || "";
  const commerce = document.getElementById("quickEditCommerceFields");
  commerce?.classList.toggle("hidden", record.collectionKey !== "items");
  if (commerce) commerce.dataset.hasProduct = record.hasItemProduct === true ? "true" : "false";
  if (record.collectionKey === "items") {
    document.getElementById("quickEditWebsiteVisible").checked =
      record.websiteVisible === true || record.productVisible === true ||
      record.requestedWebsiteVisible === true || record.requestedProductVisible === true;
    document.getElementById("quickEditIsShopProduct").checked = record.isShopProduct === true;
    document.getElementById("quickEditFeatured").checked = record.productFeatured === true;
    document.getElementById("quickEditNormalPrice").value = record.productRetailPrice ?? record.productPrice ?? "";
    document.getElementById("quickEditSalePrice").value = record.productSalePrice ?? "";
    document.getElementById("quickEditSaleStartsAt").value = record.saleStartsAt?.slice(0, 16) || "";
    document.getElementById("quickEditSaleEndsAt").value = record.saleEndsAt?.slice(0, 16) || "";
    syncCommerceControls();
  }

  renderClassificationFields(record);
  renderQuickEditRelationshipSummary(record);
  drawer.classList.remove("hidden");
}

function closeQuickEdit() {
  document.getElementById("contentQuickEditDrawer")?.classList.add("hidden");
}

function quickEditPayload() {
  const recordType = document.getElementById("quickEditRecordType")?.value || "";
  const updates = {
    name: document.getElementById("quickEditName")?.value || "",
    status: document.getElementById("quickEditStatus")?.value || "",
    visibility: document.getElementById("quickEditVisibility")?.value || "",
    owner: document.getElementById("quickEditOwner")?.value || "",
    tags: selectedQuickTags(),
    amendmentComments: document.getElementById("quickEditAmendmentComments")?.value || "",
    scheduledActiveAt: isoFromLocalInput("quickEditScheduledActiveAt"),
    scheduledPauseAt: isoFromLocalInput("quickEditScheduledPauseAt"),
    type: document.getElementById("quickEditType")?.value || "",
  };

  if (recordType === "items") {
    updates.itemKind = document.getElementById("quickEditItemKind")?.value || "";
    updates.categoryId = document.getElementById("quickEditCategoryId")?.value || "";
    updates.websiteVisible = document.getElementById("quickEditWebsiteVisible")?.checked === true;
    updates.isShopProduct = document.getElementById("quickEditIsShopProduct")?.checked === true;
    const hasProduct = document.getElementById("quickEditCommerceFields")?.dataset.hasProduct === "true";
    if (updates.isShopProduct || hasProduct) {
      updates.productRelation = {
        effectiveShopPrice: Number(document.getElementById("quickEditNormalPrice")?.value || 0),
        retailPrice: Number(document.getElementById("quickEditNormalPrice")?.value || 0),
        salePrice: document.getElementById("quickEditSalePrice")?.value === ""
          ? null
          : Number(document.getElementById("quickEditSalePrice").value),
        saleStartsAt: isoFromLocalInput("quickEditSaleStartsAt"),
        saleEndsAt: isoFromLocalInput("quickEditSaleEndsAt"),
        featured: document.getElementById("quickEditFeatured")?.checked === true,
        visible: document.getElementById("quickEditWebsiteVisible")?.checked === true,
      };
    }
  }

  return {
    recordType,
    recordId: document.getElementById("quickEditRecordId")?.value || "",
    updates,
  };
}

function isRetryableAuthError(error) {
  return [
    "functions/unauthenticated",
    "functions/permission-denied",
    "unauthenticated",
    "permission-denied",
  ].includes(error?.code);
}

async function updateQuickEditWithFreshSession(payload) {
  await auth?.authStateReady?.();
  try {
    return await updateContentControlRecord(payload);
  } catch (error) {
    if (!auth?.currentUser || !isRetryableAuthError(error)) throw error;
    await auth.currentUser.getIdToken(true);
    return updateContentControlRecord(payload);
  }
}

async function saveQuickEdit(event) {
  event.preventDefault();
  const submitButton = event.target.querySelector("button[type='submit']");
  try {
    submitButton.disabled = true;
    submitButton.textContent = "Saving...";
    await updateQuickEditWithFreshSession(quickEditPayload());
    showToast("Content record updated.", "success");
    closeQuickEdit();
    try {
      await loadData();
    } catch (refreshError) {
      console.error("Content saved, but the list could not be refreshed:", refreshError);
      showToast("Saved successfully. Use Refresh if the updated value is not shown yet.", "warning");
    }
  } catch (err) {
    console.error("Failed to update content record:", err);
    const message = isRetryableAuthError(err)
      ? "Your session could not be refreshed. Your Quick Edit changes are still open; try Save again."
      : err.message || "Failed to update content record.";
    showToast(message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Save changes";
  }
}

function rerender() {
  renderPrimaryButtons();
  renderSecondaryFilter();
  renderCategoryFilter();
  renderTagFilter();
  renderOwnerFilter();
  renderUpdatedFilter();
  renderDetailFilter();
  renderRows();
}

async function loadData() {
  const list = document.getElementById("contentControlsList");
  if (list) list.textContent = "Loading content controls...";

  const result = await getContentBuilderData();
  state = {
    ...state,
    options: result.data?.options || {},
    records: result.data?.records || state.records,
  };
  rerender();
}

function saveJsonDownload(payload, fileName) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadContentBackup() {
  const button = document.getElementById("downloadContentBackupBtn");
  if (button) {
    button.disabled = true;
    button.textContent = "Preparing backup...";
  }

  try {
    const response = await exportContentBackup();
    const backup = response.data || {};
    const fileName = backup.suggestedFileName || `recovery-tools-full-backup-${Date.now()}.json`;
    saveJsonDownload(backup, fileName);
    showToast("Full backup downloaded. Store it securely because it contains customer data.", "success");
  } catch (err) {
    console.error("Failed to download full backup:", err);
    showToast(err.message || "Failed to download full backup.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Download full backup";
    }
  }
}

function createContentFromFilters() {
  let entity = {
    items: "item",
    blueprints: "blueprint",
    plans: "plan",
  }[state.primary] || "item";
  if (state.primary === "all" && state.secondary !== "all") {
    const matchingEntities = [
      ["item", "itemTypes"],
      ["blueprint", "blueprintTypes"],
      ["plan", "planTypes"],
    ].filter(([, optionKey]) => (state.options[optionKey] || []).includes(state.secondary));
    if (matchingEntities.length === 1) entity = matchingEntities[0][0];
  }
  const search = String(document.getElementById("contentControlsSearch")?.value || "").trim();
  const params = new URLSearchParams({ new: "1", entity });

  if (search) params.set("name", search);
  if (state.secondary !== "all") params.set("contentType", state.secondary);
  if (state.category !== "all") params.set("category", state.category);
  if (state.tag !== "all") params.set("tag", state.tag);
  if (state.detail.startsWith("status:")) params.set("status", state.detail.slice("status:".length));
  if (["product", "featured"].includes(state.detail)) {
    params.set("product", "1");
  }
  if (state.detail === "website-visible") {
    params.set("websiteVisible", "1");
    params.set("visibility", "users");
  }
  if (state.detail === "featured") params.set("featured", "1");
  if (state.detail === "inventory-tracked") params.set("inventoryTracked", "1");

  history.pushState({}, "", `/admin/content/builder?${params.toString()}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function bindEvents() {
  document.querySelectorAll(".content-primary-filter").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      state.primary = button.dataset.primaryFilter || "all";
      state.secondary = "all";
      state.detail = "all";
      rerender();
    });
  });

  document.getElementById("contentControlsSearch")?.addEventListener("input", renderRows);
  document.getElementById("contentControlsSecondaryFilter")?.addEventListener("change", (event) => {
    state.secondary = event.target.value || "all";
    renderRows();
  });
  document.getElementById("contentControlsCategoryFilter")?.addEventListener("change", (event) => {
    state.category = event.target.value || "all";
    renderRows();
  });
  document.getElementById("contentControlsTagFilter")?.addEventListener("change", (event) => {
    state.tag = event.target.value || "all";
    renderRows();
  });
  document.getElementById("contentControlsOwnerFilter")?.addEventListener("change", (event) => {
    state.owner = event.target.value || "all";
    renderRows();
  });
  document.getElementById("contentControlsUpdatedFilter")?.addEventListener("change", (event) => {
    state.updated = event.target.value || "all";
    renderRows();
  });
  document.getElementById("refreshContentControlsBtn")?.addEventListener("click", () => {
    loadData().catch((err) => {
      console.error("Failed to refresh content controls:", err);
      showToast("Failed to refresh content controls.", "error");
    });
  });
  document.getElementById("downloadContentBackupBtn")?.addEventListener("click", downloadContentBackup);
  document.getElementById("createFilteredContentBtn")?.addEventListener("click", createContentFromFilters);

  document.getElementById("contentControlsAddFilter")?.addEventListener("change", (event) => {
    state.detail = event.target.value || "all";
    renderRows();
  });

  document.getElementById("contentControlsList")?.addEventListener("click", (event) => {
    const quickEditButton = event.target.closest(".quick-edit-content-btn");
    if (quickEditButton) {
      const record = findRecord(quickEditButton.dataset.recordType, quickEditButton.dataset.recordId);
      if (record) openQuickEdit({ ...record, collectionKey: quickEditButton.dataset.recordType });
      return;
    }

    const builderButton = event.target.closest(".edit-content-builder-btn");
    if (!builderButton) return;
    const params = new URLSearchParams({
      type: builderButton.dataset.recordType || "",
      id: builderButton.dataset.recordId || "",
    });
    history.pushState({}, "", `/admin/content/builder?${params.toString()}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  document.getElementById("contentQuickEditForm")?.addEventListener("submit", saveQuickEdit);
  document.getElementById("closeContentQuickEditBtn")?.addEventListener("click", closeQuickEdit);
  document.getElementById("cancelContentQuickEditBtn")?.addEventListener("click", closeQuickEdit);
  document.getElementById("addQuickEditTagBtn")?.addEventListener("click", () => {
    document.getElementById("quickEditTagRows")?.insertAdjacentHTML(
      "beforeend",
      quickTagRow("", false, selectedQuickTags()),
    );
    refreshQuickTagOptions();
  });
  document.getElementById("createQuickEditTagBtn")?.addEventListener("click", () => {
    document.getElementById("quickEditTagRows")?.insertAdjacentHTML("beforeend", quickTagRow("", true));
    document.querySelector("#quickEditTagRows .quick-tag-row:last-child .quick-tag-new")?.focus();
  });
  document.getElementById("quickEditTagRows")?.addEventListener("click", (event) => {
    const row = event.target.closest(".remove-quick-tag")?.closest(".quick-tag-row");
    if (!row) return;
    row.remove();
    refreshQuickTagOptions();
  });
  document.getElementById("quickEditTagRows")?.addEventListener("change", handleQuickTagChange);
  document.getElementById("quickEditTagRows")?.addEventListener("input", refreshQuickTagOptions);
  document.querySelectorAll("[data-content-action]").forEach((button) => button.addEventListener("click", () => {
    const status = button.dataset.contentAction;
    document.getElementById("quickEditStatus").value = status;
    if (status === "draft") document.getElementById("quickEditAmendmentComments")?.focus();
  }));
  document.querySelectorAll("[data-control-toggle] input").forEach((input) =>
    input.addEventListener("change", syncCommerceControls),
  );
}

export async function setupContentControls() {
  const section = document.getElementById("adminContentControlsSection");
  if (!section || section.dataset.initialized === "true") return;
  section.dataset.initialized = "true";
  bindEvents();

  try {
    await loadData();
  } catch (err) {
    console.error("Failed to load content controls:", err);
    showToast(err.message || "Failed to load content controls.", "error");
  }
}
