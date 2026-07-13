import { httpsCallable } from "firebase/functions";
import { functions } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";

const getContentBuilderData = httpsCallable(functions, "getContentBuilderData");
const updateContentControlRecord = httpsCallable(functions, "updateContentControlRecord");

let state = {
  primary: "all",
  secondary: "all",
  activeFilters: [],
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
  items: { label: "Firebase Type", optionsKey: "firebaseTypes" },
  blueprints: { label: "Blueprint Type", optionsKey: "blueprintTypes" },
  plans: { label: "Plan Type", optionsKey: "planTypes" },
  campaigns: { label: "Campaign Type", optionsKey: "campaignTypes" },
};

const GLOBAL_FILTERS = [
  { id: "status", label: "Content Status" },
  { id: "publishStatus", label: "Publish Status" },
  { id: "approvalStatus", label: "Approval Status" },
  { id: "owner", label: "Owner" },
  { id: "audience", label: "Audience" },
  { id: "tags", label: "Tags" },
  { id: "template", label: "Template" },
  { id: "marketplaceVisibility", label: "Marketplace Visibility" },
  { id: "inventoryStatus", label: "Inventory Status" },
  { id: "missingData", label: "Missing Data" },
  { id: "relationshipHealth", label: "Relationship Health" },
  { id: "usedIn", label: "Used In" },
];

const ITEM_FILTERS = [
  { id: "itemType", label: "Item Type" },
  { id: "categoryId", label: "Item Category" },
  { id: "hasItemProduct", label: "Has ItemProduct" },
  { id: "isShopProduct", label: "Is Shop Product" },
  { id: "isAsset", label: "Is Asset" },
  { id: "assetType", label: "Asset Type" },
  { id: "inventoryTracked", label: "Inventory Tracked" },
  { id: "unlocksAccess", label: "Unlocks Access" },
  { id: "hasVariants", label: "Has Variants" },
  { id: "hasActivePrice", label: "Has Active Price" },
  { id: "hasPrimaryAsset", label: "Has Primary Asset" },
];

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
  if (primary === "all") return ["items", "blueprints", "plans", "campaigns"];
  return [primary];
}

function fieldValue(record, field) {
  if (field === "missingData") return record.missingData?.length ? "Yes" : "No";
  if (field === "relationshipHealth") return record.relationshipHealth || "Unknown";
  if (field === "inventoryStatus") return record.inventorySummary?.status || "";
  const value = record[field];
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return value || "";
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
  if (state.primary === "items") return record.firebaseType || record.type || "";
  if (state.primary === "blueprints") return record.blueprintType || record.type || "";
  if (state.primary === "plans") return record.planType || record.type || "";
  if (state.primary === "campaigns") return record.campaignType || record.type || "";
  return record.collectionKey;
}

function filteredRecords() {
  const search = String(document.getElementById("contentControlsSearch")?.value || "").toLowerCase().trim();

  return allRecords().filter((record) => {
    if (search && !searchableText(record).includes(search)) return false;
    if (state.secondary !== "all" && currentSecondaryValue(record) !== state.secondary) return false;
    return state.activeFilters.every((filter) => {
      const value = fieldValue(record, filter.id);
      return String(value || "").trim() !== "";
    });
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
    : ["items", "blueprints", "plans", "campaigns"];
  const validValues = new Set(["all", ...values]);
  if (!validValues.has(state.secondary)) {
    state.secondary = "all";
  }

  select.innerHTML = [
    `<option value="all">All ${escapeHTML(config.label.toLowerCase())}</option>`,
    ...values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`),
  ].join("");
  select.value = state.secondary;
}

function renderAddFilterOptions() {
  const select = document.getElementById("contentControlsAddFilter");
  if (!select) return;

  const filters = state.primary === "items"
    ? [...ITEM_FILTERS, ...GLOBAL_FILTERS]
    : GLOBAL_FILTERS;
  const activeIds = new Set(state.activeFilters.map((filter) => filter.id));

  select.innerHTML = [
    "<option value=\"\">Add filter...</option>",
    ...filters
      .filter((filter) => !activeIds.has(filter.id))
      .map((filter) => `<option value="${escapeHTML(filter.id)}">${escapeHTML(filter.label)}</option>`),
  ].join("");
}

function renderFilterChips() {
  const chips = document.getElementById("contentControlsFilterChips");
  if (!chips) return;

  chips.innerHTML = state.activeFilters.map((filter) => `
    <button
      type="button"
      class="remove-content-filter rounded bg-[#407471] px-2 py-1 text-white"
      data-filter-id="${escapeHTML(filter.id)}"
    >
      ${escapeHTML(filter.label)} x
    </button>
  `).join("");
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

function renderRows() {
  const list = document.getElementById("contentControlsList");
  const summary = document.getElementById("contentControlsSummary");
  if (!list) return;

  const records = filteredRecords();
  const secondaryLabel = PRIMARY_CONFIG[state.primary]?.label || "Type";
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
            ${statusBadge(record)}
          </div>
          <h3 class="break-words text-lg font-semibold text-white">${escapeHTML(record.name)}</h3>
          <p class="break-all text-xs text-gray-400">${escapeHTML(record.id)}</p>
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
          <button type="button" class="rounded border border-gray-600 px-3 py-2 text-sm text-white">
            Relationships
          </button>
        </div>
      </div>
      <div class="mt-4 grid gap-2 text-xs text-gray-400 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <strong class="text-gray-300">${escapeHTML(secondaryLabel)}:</strong>
          ${escapeHTML(currentSecondaryValue(record) || "-")}
        </div>
        <div><strong class="text-gray-300">Template:</strong> ${escapeHTML(record.template || "-")}</div>
        <div><strong class="text-gray-300">Approval:</strong> ${escapeHTML(record.approvalStatus || "-")}</div>
        <div><strong class="text-gray-300">Updated:</strong> ${escapeHTML(record.updatedAt || "-")}</div>
        <div class="md:col-span-2 xl:col-span-4">
          <strong class="text-gray-300">Relationships:</strong>
          ${escapeHTML(relationshipSummary(record))}
        </div>
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
        Firebase Type
        <select id="quickEditFirebaseType" class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"></select>
      </label>
      <label class="block">
        Item Type
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
    fillSelect(document.getElementById("quickEditFirebaseType"), state.options.firebaseTypes || [], "tool");
    fillSelect(document.getElementById("quickEditType"), state.options.itemTypes || [], "Physical Product");
    fillSelect(document.getElementById("quickEditItemKind"), state.options.itemKinds || [], "Shop Product");
    fillSelect(
      document.getElementById("quickEditCategoryId"),
      (state.options.categoryOptions || []).map((option) => option.id),
      "CAT-TREAT",
    );
    setSelectValue(document.getElementById("quickEditFirebaseType"), record.firebaseType);
    setSelectValue(document.getElementById("quickEditType"), record.itemType || record.type);
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
  document.getElementById("quickEditTags").value = (record.tags || []).join(", ");

  fillSelect(document.getElementById("quickEditStatus"), state.options.contentStatuses || [], "draft");
  fillSelect(document.getElementById("quickEditPublishStatus"), state.options.publishStatuses || [], "unpublished");
  fillSelect(
    document.getElementById("quickEditApprovalStatus"),
    state.options.approvalStatuses || [],
    "not submitted",
  );
  fillSelect(document.getElementById("quickEditVisibility"), state.options.visibilityValues || [], "private");
  setSelectValue(document.getElementById("quickEditStatus"), record.status);
  setSelectValue(document.getElementById("quickEditPublishStatus"), record.publishStatus);
  setSelectValue(document.getElementById("quickEditApprovalStatus"), record.approvalStatus);
  setSelectValue(document.getElementById("quickEditVisibility"), record.visibility);

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
    publishStatus: document.getElementById("quickEditPublishStatus")?.value || "",
    approvalStatus: document.getElementById("quickEditApprovalStatus")?.value || "",
    visibility: document.getElementById("quickEditVisibility")?.value || "",
    owner: document.getElementById("quickEditOwner")?.value || "",
    tags: splitCsv(document.getElementById("quickEditTags")?.value),
    type: document.getElementById("quickEditType")?.value || "",
  };

  if (recordType === "items") {
    updates.firebaseType = document.getElementById("quickEditFirebaseType")?.value || "";
    updates.itemKind = document.getElementById("quickEditItemKind")?.value || "";
    updates.categoryId = document.getElementById("quickEditCategoryId")?.value || "";
  }

  return {
    recordType,
    recordId: document.getElementById("quickEditRecordId")?.value || "",
    updates,
  };
}

async function saveQuickEdit(event) {
  event.preventDefault();
  const submitButton = event.target.querySelector("button[type='submit']");
  try {
    submitButton.disabled = true;
    submitButton.textContent = "Saving...";
    await updateContentControlRecord(quickEditPayload());
    showToast("Content record updated.", "success");
    closeQuickEdit();
    await loadData();
  } catch (err) {
    console.error("Failed to update content record:", err);
    showToast(err.message || "Failed to update content record.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Save changes";
  }
}

function rerender() {
  renderPrimaryButtons();
  renderSecondaryFilter();
  renderAddFilterOptions();
  renderFilterChips();
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

function bindEvents() {
  document.querySelectorAll(".content-primary-filter").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      state.primary = button.dataset.primaryFilter || "all";
      state.secondary = "all";
      state.activeFilters = [];
      rerender();
    });
  });

  document.getElementById("contentControlsSearch")?.addEventListener("input", renderRows);
  document.getElementById("contentControlsSecondaryFilter")?.addEventListener("change", (event) => {
    state.secondary = event.target.value || "all";
    renderRows();
  });
  document.getElementById("refreshContentControlsBtn")?.addEventListener("click", () => {
    loadData().catch((err) => {
      console.error("Failed to refresh content controls:", err);
      showToast("Failed to refresh content controls.", "error");
    });
  });

  document.getElementById("contentControlsAddFilter")?.addEventListener("change", (event) => {
    const filterId = event.target.value;
    if (!filterId) return;
    const filter = [...ITEM_FILTERS, ...GLOBAL_FILTERS].find((item) => item.id === filterId);
    if (filter) state.activeFilters.push(filter);
    event.target.value = "";
    rerender();
  });

  document.getElementById("contentControlsFilterChips")?.addEventListener("click", (event) => {
    const button = event.target.closest(".remove-content-filter");
    if (!button) return;
    state.activeFilters = state.activeFilters.filter((filter) => filter.id !== button.dataset.filterId);
    rerender();
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
    history.pushState({}, "", `/admin/builder?${params.toString()}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  document.getElementById("contentQuickEditForm")?.addEventListener("submit", saveQuickEdit);
  document.getElementById("closeContentQuickEditBtn")?.addEventListener("click", closeQuickEdit);
  document.getElementById("cancelContentQuickEditBtn")?.addEventListener("click", closeQuickEdit);
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
