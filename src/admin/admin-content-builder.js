import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { assertAssetUploadSize } from "../utils/asset-upload.js";
import { functions, storage } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";

const getContentBuilderData = httpsCallable(functions, "getContentBuilderData");
const createContentBuilderRecord = httpsCallable(functions, "createContentBuilderRecord");
const upsertContentBuilderTemplate = httpsCallable(functions, "upsertContentBuilderTemplate");
const upsertContentCategory = httpsCallable(functions, "upsertContentCategory");
const updateContentControlRecord = httpsCallable(functions, "updateContentControlRecord");
const upsertAdminAsset = httpsCallable(functions, "upsertAdminAsset");
let assetDrawerField = null;
let assetDrawerFile = null;
let resumeAssetSaveAfterFileSelection = false;
let adminLinkedVariantBubbleCloseTimer = null;
let entityStockDrawerSnapshot = [];
let linkedRecordSelectorContext = null;
let contentBuilderCreationStack = [];
let productDrawerReturnFocus = null;
let pendingStandaloneProductId = "";

const CONTENT_BUILDER_STACK_KEY = "recovery-tools-content-builder-creation-stack";

let state = {
  options: {
    itemTypes: [],
    itemKinds: [],
    categoryOptions: [],
    blueprintTypes: [],
    planTypes: [],
    campaignTypes: [],
    tagOptions: [],
    instructorOptions: [],
    supplierOptions: [],
    entityTypeDefinitions: [],
    templateDefinitions: {},
    statuses: [],
  },
  records: {
    items: [],
    blueprints: [],
    plans: [],
    campaigns: [],
    assets: [],
    products: [],
  },
  pendingPayload: null,
  editingRecord: null,
  currentStep: 1,
  duplicateWarningActive: false,
  isDirty: false,
  retainedProductVariantContentLinks: [],
  pendingAction: "save",
};

const BUILDER_STEP_LABELS = {
  item: ["1. Details", "2. Build", "3. Review & save", "4. Connections"],
  blueprint: ["1. Details", "2. Build", "3. Review & save", "4. Connections"],
  plan: ["1. Details", "2. Build", "3. Review & save", "4. Connections"],
  campaign: ["1. Details", "2. Build", "3. Review & save", "4. Connections"],
};

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function externalUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(url)) return `https://${url}`;
  return "";
}

function recordCollectionName(recordType) {
  return {
    item: "items",
    blueprint: "blueprints",
    plan: "plans",
    campaign: "campaigns",
  }[recordType] || "items";
}

function singularRecordType(recordType) {
  return {
    items: "item",
    item: "item",
    blueprints: "blueprint",
    blueprint: "blueprint",
    plans: "plan",
    plan: "plan",
    campaigns: "campaign",
    campaign: "campaign",
  }[recordType] || "item";
}

function typeOptionsKey(recordType) {
  return {
    item: "itemTypes",
    blueprint: "blueprintTypes",
    plan: "planTypes",
    campaign: "campaignTypes",
  }[recordType] || "itemTypes";
}

function setInputValue(id, value = "") {
  const input = document.getElementById(id);
  if (!input) return;
  input.value = value ?? "";
}

function datetimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function isoFromDatetimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function setCheckboxValue(id, value) {
  const input = document.getElementById(id);
  if (!input) return;
  input.checked = value === true;
}

function setSelectValue(id, value) {
  const select = document.getElementById(id);
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

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueValues(values = []) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizedType(value) {
  return String(value || "").trim().toLowerCase();
}

const DEFAULT_FIELD_GROUPS = {
  item: ["core", "classification", "content", "media", "publishing", "relationships"],
  blueprint: ["core", "classification", "content", "publishing", "relationships"],
  plan: ["core", "classification", "content", "publishing", "relationships"],
};

const FIELD_GROUP_LABELS = {
  core: "Core details",
  classification: "Type, category and tags",
  content: "Content",
  clinical: "Clinical details",
  method: "Method steps",
  dosage: "Dosage and progression",
  findings: "Findings",
  media: "Media and assets",
  publishing: "Publishing",
  access: "Access",
  commerce: "Commerce",
  inventory: "Inventory",
  relationships: "Reusable connections",
  campaign: "Campaign matching",
};

function selectedEntityTypeDefinition() {
  const entityKind = currentRecordType();
  const type = normalizedType(document.getElementById("contentType")?.value);
  return (state.options.entityTypeDefinitions || []).find((definition) =>
    normalizedType(definition.entityKind) === entityKind &&
    normalizedType(definition.type) === type,
  ) || null;
}

function activeFieldGroups() {
  const recordType = currentRecordType();
  const definition = selectedEntityTypeDefinition();
  const configured = Array.isArray(definition?.fieldGroupIds)
    ? definition.fieldGroupIds.map(normalizedType).filter(Boolean)
    : [];
  return new Set(configured.length ? configured : DEFAULT_FIELD_GROUPS[recordType] || DEFAULT_FIELD_GROUPS.item);
}

function fieldGroupAllowed(element) {
  const recordTypes = String(element?.dataset?.recordTypes || "")
    .split(/[|,\s]+/)
    .map(normalizedType)
    .filter(Boolean);
  if (recordTypes.length && !recordTypes.includes(currentRecordType())) return false;
  const requiredType = normalizedType(element?.dataset?.requiredType);
  if (requiredType && requiredType !== normalizedType(document.getElementById("contentType")?.value)) {
    return false;
  }
  const configured = String(element?.dataset?.fieldGroup || "")
    .split(/[|,\s]+/)
    .map(normalizedType)
    .filter(Boolean);
  if (!configured.length) return true;
  const active = activeFieldGroups();
  return configured.some((group) => active.has(group));
}

function applyTypeDrivenFieldGroups() {
  const active = activeFieldGroups();
  document.querySelectorAll("[data-field-group]").forEach((element) => {
    if (element.classList.contains("builder-step-panel")) return;
    element.classList.toggle("hidden", !fieldGroupAllowed(element));
  });

  const summary = document.getElementById("contentTypeFieldSummary");
  if (summary) {
    summary.textContent = `This Type shows: ${[...active]
      .map((group) => FIELD_GROUP_LABELS[group] || group)
      .join(", ")}.`;
  }
  showBuilderStep(state.currentStep);
}

function hiddenRelationshipIds(inputId) {
  return splitCsv(document.getElementById(inputId)?.value);
}

function setHiddenRelationshipIds(inputId, ids = []) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.value = uniqueValues(ids).join(", ");
}

function blueprintItemComponentsFromPicker() {
  return [...document.querySelectorAll(
    ".content-relationship-checkbox[data-relation-kind=\"items\"]:checked",
  )].map((checkbox) => {
    const row = checkbox.closest(".content-relationship-row");
    const item = (state.records.items || []).find((record) => record.id === checkbox.value);
    const quantity = optionalNumberFromElement(row?.querySelector(".blueprint-item-quantity")) ?? 1;
    const unitCost = Number(item?.itemUnitCost ?? 0) || 0;
    return { itemId: checkbox.value, quantity, unitCost, estimatedCost: quantity * unitCost };
  });
}

function updateBlueprintEstimatedCost() {
  const output = document.getElementById("contentBlueprintEstimatedCost");
  if (!output) return 0;
  const isBlueprint = currentRecordType() === "blueprint";
  const total = isBlueprint
    ? blueprintItemComponentsFromPicker().reduce((sum, component) => sum + component.estimatedCost, 0)
    : 0;
  output.classList.toggle("hidden", !isBlueprint);
  output.textContent = `Estimated Item cost for one Blueprint output: $${total.toFixed(2)}`;
  return total;
}

function blueprintVariantRecipeCostFromBuilder() {
  const firstRecipe = document.querySelector(".content-entity-variant-row");
  if (!firstRecipe) return 0;
  return [...firstRecipe.querySelectorAll(".blueprint-variant-recipe-row")]
    .reduce((total, row) => {
      const itemId = row.querySelector(".blueprint-variant-recipe-item")?.value || "";
      const item = (state.records.items || []).find((record) => record.id === itemId);
      const quantity = optionalNumberFromElement(
        row.querySelector(".blueprint-variant-recipe-quantity"),
      ) ?? 0;
      return total + quantity * (Number(item?.itemUnitCost ?? 0) || 0);
    }, 0);
}

function updateConnectedProductCostPreview() {
  let cost = 0;
  const blueprintId = document.getElementById("contentProductBlueprintId")?.value || "";
  const costBlueprint = (state.records.blueprints || []).find((blueprint) => blueprint.id === blueprintId);
  if (costBlueprint) cost = Number(costBlueprint.estimatedUnitCost ?? 0) || 0;
  else if (currentRecordType() === "blueprint") cost = blueprintVariantRecipeCostFromBuilder();
  if (!costBlueprint && currentRecordType() === "item") {
    cost = optionalNumberFromElement(document.querySelector(
      ".content-variant-connection-row .variant-unit-cost",
    )) ?? 0;
  }
  const price = optionalNumberFromInput("contentProductPrice");
  const costOutput = document.getElementById("contentProductSourceCost");
  const marginOutput = document.getElementById("contentProductApproxMargin");
  if (costOutput) costOutput.textContent = `$${cost.toFixed(2)}`;
  if (marginOutput) {
    if (price === null) {
      marginOutput.textContent = "Enter a selling price";
    } else {
      const margin = price - cost;
      const percentage = price > 0 ? (margin / price) * 100 : 0;
      marginOutput.textContent = `$${margin.toFixed(2)} (${percentage.toFixed(1)}%)`;
    }
  }
  return cost;
}

function renderProductBlueprintOptions(selectedId = "") {
  setInputValue("contentProductBlueprintId", selectedId);
  const blueprint = (state.records.blueprints || []).find((record) => record.id === selectedId);
  const label = document.getElementById("contentProductBlueprintLabel");
  if (label) label.textContent = blueprint
    ? `${blueprint.name || blueprint.id} ($${Number(blueprint.estimatedUnitCost ?? 0).toFixed(2)})`
    : "Not connected";
  updateConnectedProductCostPreview();
}

function relationshipPickerMarkup(kind, records, selectedIds, itemComponents = []) {
  const selected = new Set(selectedIds);
  const componentMap = new Map(itemComponents.map((component) => [component.itemId, component]));
  const ordered = [...records].sort((left, right) => {
    const selectedDifference = Number(selected.has(right.id)) - Number(selected.has(left.id));
    if (selectedDifference) return selectedDifference;
    return String(left.name || left.id).localeCompare(String(right.name || right.id));
  });
  const rows = ordered.length
    ? ordered.map((record) => {
      const searchable = [record.id, record.name, record.type, ...(record.tags || [])].join(" ");
      const tagLabel = record.tags?.length
        ? ` | ${escapeHTML(record.tags.join(", "))}`
        : "";
      const showBlueprintQuantity = kind === "items" && currentRecordType() === "blueprint";
      const component = componentMap.get(record.id) || {};
      const unitCost = Number(record.itemUnitCost ?? 0) || 0;
      return `
        <label
          class="content-relationship-row flex cursor-pointer items-start gap-2 rounded px-2 py-2 hover:bg-gray-800"
          data-search="${escapeHTML(searchable.toLowerCase())}"
        >
          <input
            type="checkbox"
            class="content-relationship-checkbox mt-0.5 accent-[#407471]"
            data-relation-kind="${escapeHTML(kind)}"
            value="${escapeHTML(record.id)}"
            ${selected.has(record.id) ? "checked" : ""}
          >
          <span class="min-w-0">
            <span class="block text-sm text-white">${escapeHTML(record.name || record.id)}</span>
            <span class="block break-all text-xs text-gray-400">
              ${escapeHTML(record.id)} | ${escapeHTML(record.type || "untyped")}${tagLabel}
            </span>
          </span>
          ${showBlueprintQuantity ? `
            <span class="ml-auto grid min-w-[10rem] grid-cols-2 gap-2 text-xs text-gray-300">
              <input class="blueprint-item-quantity rounded bg-gray-800 px-2 py-1 text-white"
                type="number" min="0" step="0.01" value="${escapeHTML(component.quantity ?? 1)}"
                aria-label="Quantity used">
              <span class="self-center">$${unitCost.toFixed(2)} each</span>
            </span>` : ""}
        </label>
      `;
    }).join("")
    : "<p class=\"px-2 py-3 text-xs text-gray-500\">No records available.</p>";

  return `
    <div
      class="content-relationship-picker rounded border border-gray-700 bg-gray-900/60 p-2"
      data-relation-kind="${escapeHTML(kind)}"
    >
      <input
        type="search"
        class="content-relationship-search w-full rounded bg-gray-800 px-3 py-2 text-white"
        placeholder="Search by name, type, tag, or ID"
      >
      <div class="mt-2 max-h-56 space-y-1 overflow-auto">
        ${rows}
      </div>
    </div>
  `;
}

function renderRelationshipPickers() {
  const recordType = currentRecordType();
  const currentId = state.editingRecord?.id || "";
  const sections = {
    item: document.getElementById("contentItemPickerSection"),
    blueprint: document.getElementById("contentBlueprintPickerSection"),
    plan: document.getElementById("contentPlanPickerSection"),
  };

  sections.item?.classList.toggle("hidden", recordType !== "plan");
  sections.blueprint?.classList.toggle("hidden", recordType !== "plan");
  sections.plan?.classList.toggle("hidden", recordType !== "plan");

  const pickerConfig = [
    ["items", "contentItemPicker", "contentLinkedItemIds", state.records.items || []],
    ["blueprints", "contentBlueprintPicker", "contentLinkedBlueprintIds", state.records.blueprints || []],
    [
      "plans",
      "contentPlanPicker",
      "contentLinkedPlanIds",
      (state.records.plans || []).filter((record) => record.id !== currentId),
    ],
  ];

  const existingComponents = document.querySelector(".blueprint-item-quantity")
    ? blueprintItemComponentsFromPicker()
    : state.editingRecord?.linkedItemComponents || [];
  pickerConfig.forEach(([kind, containerId, inputId, records]) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = relationshipPickerMarkup(
      kind,
      records,
      hiddenRelationshipIds(inputId),
      kind === "items" ? existingComponents : [],
    );
  });
  updateBlueprintEstimatedCost();

}

function syncRelationshipPicker(kind) {
  const inputId = {
    items: "contentLinkedItemIds",
    blueprints: "contentLinkedBlueprintIds",
    plans: "contentLinkedPlanIds",
  }[kind];
  if (!inputId) return;
  const ids = [...document.querySelectorAll(`.content-relationship-checkbox[data-relation-kind="${kind}"]:checked`)]
    .map((input) => input.value);
  setHiddenRelationshipIds(inputId, ids);
}

function knownContentTags(searchValue = "") {
  const categoryId = document.getElementById("contentTagCategoryFilter")?.value || "";
  const search = normalizedText(searchValue);
  const allRecords = Object.values(state.records || {}).flatMap((records) => records || []);
  return uniqueValues([
    ...(state.options.tagOptions || [])
      .filter((tag) => (!categoryId || tag.categoryId === categoryId) &&
        (!search || normalizedText(`${tag.name || ""} ${tag.id || ""}`).includes(search)))
      .map((tag) => tag.name || tag.id),
    ...(!categoryId && !search ? allRecords.flatMap((record) => record.tags || []) : []),
  ])
    .sort((left, right) => left.localeCompare(right));
}

function tagRowMarkup(value = "") {
  const selectedValue = String(value || "").trim();
  const selectedKey = selectedValue.toLowerCase();
  const isKnownTag = (state.options.tagOptions || []).some((tag) =>
    normalizedText(tag.name || tag.id) === selectedKey);
  const customValue = selectedValue && !isKnownTag ? selectedValue : "";
  const categoryId = document.getElementById("contentTagCategoryFilter")?.value || "";
  return `
    <div class="content-tag-row grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
      <div class="relative">
        <input class="content-tag-select w-full rounded bg-gray-800 px-3 py-2 text-white"
          value="${escapeHTML(selectedValue)}" placeholder="Search and choose an existing tag"
          autocomplete="off" role="combobox" aria-expanded="false">
        <div class="content-tag-options absolute z-30 mt-1 hidden max-h-56 w-full overflow-y-auto rounded border border-gray-700 bg-gray-900 p-1 text-white shadow-xl"></div>
      </div>
      <button type="button" class="content-tag-add-row rounded border border-[#407471] px-3 py-2 text-xs text-[#9edbd7] hover:bg-[#153b38]">Add another tag</button>
      <button type="button" class="content-tag-create px-2 py-2 text-xs text-gray-300 underline decoration-gray-500 underline-offset-4 hover:text-[#9edbd7]">Create new tag</button>
      <input
        class="content-tag-new rounded bg-gray-800 px-3 py-2 text-white ${customValue ? "" : "hidden"}"
        placeholder="New tag"
        value="${escapeHTML(customValue)}"
      >
      <select class="content-tag-new-category rounded bg-gray-800 px-3 py-2 text-white ${customValue ? "" : "hidden"}" aria-label="New tag category">
        <option value="">Choose tag category</option>
        ${(state.options.categoryOptions || []).map((category) => `
          <option value="${escapeHTML(category.id)}"${category.id === categoryId ? " selected" : ""}>${escapeHTML(categoryDisplayName(category))}</option>
        `).join("")}
      </select>
      <button type="button" class="content-tag-save-new hidden rounded border border-[#407471] px-3 py-2 text-xs text-[#9edbd7] hover:bg-[#153b38]">Save & select</button>
      <button
        type="button"
        class="content-tag-remove rounded border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800"
      >
        Remove
      </button>
    </div>
  `;
}

function selectedTagsFromControls() {
  const rows = [...document.querySelectorAll("#contentTagRows .content-tag-row")];
  return uniqueValues(rows.map((row) => {
    const selected = row.querySelector(".content-tag-select")?.value || "";
    if (!row.querySelector(".content-tag-new")?.classList.contains("hidden")) {
      return row.querySelector(".content-tag-new")?.value || selected;
    }
    const existing = (state.options.tagOptions || []).find((tag) =>
      normalizedText(tag.name || tag.id) === normalizedText(selected));
    return existing ? existing.name || existing.id : "";
  }));
}

function syncTagInput() {
  const hiddenInput = document.getElementById("contentTags");
  if (!hiddenInput) return;
  hiddenInput.value = selectedTagsFromControls().join(", ");
}

function renderTagControls(tags = []) {
  const rows = document.getElementById("contentTagRows");
  if (!rows) return;
  const selectedTags = uniqueValues(tags);
  rows.innerHTML = (selectedTags.length ? selectedTags : [""])
    .map((tag) => tagRowMarkup(tag))
    .join("");
  syncTagInput();
}

function addTagRow(value = "") {
  const rows = document.getElementById("contentTagRows");
  if (!rows) return;
  rows.insertAdjacentHTML("beforeend", tagRowMarkup(value));
  syncTagInput();
}

function renderTagSuggestions(row, open = true) {
  const input = row?.querySelector(".content-tag-select");
  const list = row?.querySelector(".content-tag-options");
  if (!input || !list) return;
  const options = knownContentTags(input.value);
  list.innerHTML = options.length
    ? options.map((tag) => `<button type="button" data-tag-value="${escapeHTML(tag)}"
        class="content-tag-option block w-full rounded px-3 py-2 text-left text-sm text-white hover:bg-[#153b38] hover:text-[#9edbd7]">${escapeHTML(tag)}</button>`).join("")
    : `<p class="px-3 py-2 text-sm text-gray-400">No matching tags in this category.</p>`;
  list.classList.toggle("hidden", !open);
  input.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeTagSuggestions(exceptRow = null) {
  document.querySelectorAll("#contentTagRows .content-tag-row").forEach((row) => {
    if (row === exceptRow) return;
    row.querySelector(".content-tag-options")?.classList.add("hidden");
    row.querySelector(".content-tag-select")?.setAttribute("aria-expanded", "false");
  });
}

function handleTagRowsChange(event) {
  const row = event.target.closest(".content-tag-row");
  if (!row) return;

  if (event.target.classList.contains("content-tag-select")) {
    const match = (state.options.tagOptions || []).some((tag) =>
      normalizedText(tag.name || tag.id) === normalizedText(event.target.value));
    if (match) {
      row.querySelector(".content-tag-new")?.classList.add("hidden");
      row.querySelector(".content-tag-new-category")?.classList.add("hidden");
      row.querySelector(".content-tag-save-new")?.classList.add("hidden");
      row.dataset.newTagName = "";
      row.dataset.newTagCategoryId = "";
    }
  }

  syncTagInput();
}

function refreshExistingTagOptions() {
  document.querySelectorAll("#contentTagRows .content-tag-row").forEach((row) => {
    renderTagSuggestions(row, false);
  });
}

function handleTagRowsInput(event) {
  if (event.target.classList.contains("content-tag-select")) {
    const row = event.target.closest(".content-tag-row");
    closeTagSuggestions(row);
    renderTagSuggestions(row);
  }
  syncTagInput();
}

function handleTagRowsClick(event) {
  const option = event.target.closest(".content-tag-option");
  if (option) {
    const row = option.closest(".content-tag-row");
    const input = row?.querySelector(".content-tag-select");
    if (input) input.value = option.dataset.tagValue || "";
    row?.querySelector(".content-tag-options")?.classList.add("hidden");
    input?.setAttribute("aria-expanded", "false");
    if (input) handleTagRowsChange({ target: input });
    state.isDirty = true;
    return;
  }
  if (event.target.classList.contains("content-tag-add-row")) {
    addTagRow();
    return;
  }
  if (event.target.classList.contains("content-tag-create")) {
    const row = event.target.closest(".content-tag-row");
    row?.querySelector(".content-tag-options")?.classList.add("hidden");
    row?.querySelector(".content-tag-select")?.setAttribute("aria-expanded", "false");
    const input = row?.querySelector(".content-tag-new");
    const category = row?.querySelector(".content-tag-new-category");
    if (input) {
      input.value = row.querySelector(".content-tag-select")?.value.trim() || input.value;
      input.classList.remove("hidden");
      input.focus();
    }
    if (category) {
      category.value = document.getElementById("contentTagCategoryFilter")?.value || category.value;
      category.classList.remove("hidden");
    }
    row?.querySelector(".content-tag-save-new")?.classList.remove("hidden");
    return;
  }
  if (event.target.classList.contains("content-tag-save-new")) {
    const row = event.target.closest(".content-tag-row");
    const name = row?.querySelector(".content-tag-new")?.value.trim() || "";
    const categoryId = row?.querySelector(".content-tag-new-category")?.value || "";
    if (!name || !categoryId) {
      showToast("Enter a tag name and choose its category.", "error");
      return;
    }
    const existing = (state.options.tagOptions || []).find((tag) =>
      normalizedText(tag.name || tag.id) === normalizedText(name));
    const tag = existing || { id: name, name, categoryId };
    if (!existing) state.options.tagOptions = [...(state.options.tagOptions || []), tag];
    row.dataset.newTagName = existing ? "" : name;
    row.dataset.newTagCategoryId = existing ? "" : categoryId;
    const select = row.querySelector(".content-tag-select");
    if (select) select.value = tag.name || tag.id;
    row.querySelector(".content-tag-new")?.classList.add("hidden");
    row.querySelector(".content-tag-new-category")?.classList.add("hidden");
    event.target.classList.add("hidden");
    syncTagInput();
    state.isDirty = true;
    showToast(existing ? "Existing tag selected." : "Tag selected; it will be created when content is saved.", "success");
    return;
  }
  if (!event.target.classList.contains("content-tag-remove")) return;
  const rows = document.getElementById("contentTagRows");
  const row = event.target.closest(".content-tag-row");
  if (!rows || !row) return;

  if (rows.querySelectorAll(".content-tag-row").length <= 1) {
    const select = row.querySelector(".content-tag-select");
    const input = row.querySelector(".content-tag-new");
    const category = row.querySelector(".content-tag-new-category");
    if (select) select.value = "";
    if (input) {
      input.value = "";
      input.classList.add("hidden");
    }
    if (category) {
      category.value = "";
      category.classList.add("hidden");
    }
  } else {
    row.remove();
  }
  syncTagInput();
}

function optionalNumberFromInput(id) {
  const rawValue = document.getElementById(id)?.value;
  if (rawValue === undefined || String(rawValue).trim() === "") return null;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseProductVariants(value) {
  const raw = String(value || "").trim();
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Continue with the legacy pipe-delimited format.
    }
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        variantId = "",
        name = "",
        colour = "",
        size = "",
        sku = "",
        priceOverride = "",
        stock = "",
        status = "active",
        contentVariantId = "",
        calendarBookingReference = "",
        seatCapacity = "",
        eventStartAt = "",
        eventEndAt = "",
        eventLocation = "",
        instructor = "",
        deliveryMode = "",
        physicalFulfilment = "",
        shortDescription = "",
        longDescription = "",
        inclusions = "",
      ] = line.split("|").map((part) => part.trim());
      return {
        variantId,
        name,
        colour,
        size,
        sku,
        priceOverride: priceOverride ? Number(priceOverride) : null,
        stock: stock ? Number(stock) : 0,
        status: status || "active",
        contentVariantId,
        deliveryMode,
        physicalFulfilment,
        calendarBookingReference,
        seatCapacity: seatCapacity ? Number(seatCapacity) : null,
        eventStartAt,
        eventEndAt,
        eventLocation,
        instructor,
        shortDescription,
        longDescription,
        inclusions,
      };
    });
}

function serializeProductVariants(variants = []) {
  return JSON.stringify(variants.map((variant) => ({
    variantId: variant.variantId || variant.productVariantId || variant.id || "",
    name: variant.name || variant.variantName || "",
    colour: variant.colour || "",
    size: variant.size || "",
    weight: variant.weight ?? null,
    weightUnit: variant.weightUnit || "g",
    length: variant.length ?? null,
    width: variant.width ?? null,
    height: variant.height ?? null,
    dimensionUnit: variant.dimensionUnit || "cm",
    sku: variant.sku || "",
    priceOverride: variant.priceOverride ?? null,
    stock: variant.stock ?? variant.stockQuantity ?? 0,
    status: variant.status || "active",
    contentVariantId: variant.contentVariantId || "",
    contentVariantLinkReviewed: variant.contentVariantLinkReviewed === true || Boolean(variant.contentVariantId),
    calendarBookingReference: variant.calendarBookingReference || "",
    seatCapacity: variant.seatCapacity ?? null,
    nearCapacityWarning: variant.nearCapacityWarning ?? null,
    eventStartAt: variant.eventStartAt || "",
    eventEndAt: variant.eventEndAt || "",
    eventLocation: variant.eventLocation || "",
    instructor: variant.instructor || "",
    deliveryMode: variant.deliveryMode || "",
    physicalFulfilment: variant.physicalFulfilment || "",
    shortDescription: variant.shortDescription || "",
    longDescription: variant.longDescription || "",
    inclusions: variant.inclusions || "",
    manualInclusions: Array.isArray(variant.manualInclusions) ? variant.manualInclusions : [],
    primaryAssetId: variant.primaryAssetId || "",
    promotionAssetIds: Array.isArray(variant.promotionAssetIds) ? variant.promotionAssetIds : [],
    prerequisiteProductVariants: Array.isArray(variant.prerequisiteProductVariants)
      ? variant.prerequisiteProductVariants : [],
    bundleComponents: Array.isArray(variant.bundleComponents) ? variant.bundleComponents : [],
  })));
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function canonicalAssetType(value) {
  const types = [
    "Image", "Video", "Audio", "PDF", "Document", "Illustration", "Presentation",
    "Canva Design", "Logo", "Icon", "Animation", "Download",
  ];
  return types.find((type) => normalizedText(type) === normalizedText(value)) || "Document";
}

function fillSelect(select, values, fallback = "") {
  if (!select) return;
  const current = select.value;
  const options = values?.length ? values : fallback ? [fallback] : [];
  select.innerHTML = options
    .map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
    .join("");
  if (options.includes(current)) select.value = current;
}

function categoryDisplayName(record) {
  const id = String(record?.id || "").trim();
  const name = String(record?.name || "").trim();
  if (name && normalizedType(name) !== normalizedType(id)) return name;
  const fallback = (state.options.categoryOptions || [])
    .find((category) => category.id === id && category.name && category.name !== id)?.name;
  if (fallback) return fallback;
  return id
    .replace(/^CAT[-_]/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function fillCategorySelect(select, includeBlank = false) {
  if (!select) return;
  const current = select.value;
  const options = [...(state.options.categoryOptions || [])]
    .filter((record) => record.id)
    .map((record) => ({ ...record, displayName: categoryDisplayName(record) }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  select.innerHTML = [
    ...(includeBlank ? ["<option value=\"\">No default category</option>"] : []),
    ...options.map((record) => {
      return `<option value="${escapeHTML(record.id)}">${escapeHTML(record.displayName)}</option>`;
    }),
    ...(select.id === "contentProductCategoryId"
      ? ["<option value=\"__create_category__\">＋ Create new category…</option>"]
      : []),
  ].join("");
  if (options.some((record) => record.id === current)) select.value = current;
  if (select.id === "contentProductCategoryId" && select.value !== "__create_category__") {
    select.dataset.previousCategoryId = select.value;
  }
}

function fillTagCategoryFilter() {
  const select = document.getElementById("contentTagCategoryFilter");
  if (!select) return;
  const current = select.value;
  const categories = [...(state.options.categoryOptions || [])]
    .filter((record) => record.id)
    .map((record) => ({ ...record, displayName: categoryDisplayName(record) }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  select.innerHTML = [
    "<option value=\"\">All categories</option>",
    ...categories.map((record) =>
      `<option value="${escapeHTML(record.id)}">${escapeHTML(record.displayName)}</option>`),
  ].join("");
  if (categories.some((record) => record.id === current)) select.value = current;
}

function templateDefinitions(recordType, typeValue = "") {
  const definitions = state.options.templateDefinitions?.[recordType] || [];
  const normalizedValue = normalizedType(typeValue);
  return definitions.filter((template) =>
    template.active !== false &&
    (!normalizedValue || normalizedType(template.appliesTo) === normalizedValue),
  );
}

function entityVariantId(name, index) {
  const token = String(name || `Variant ${index + 1}`)
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
  return `VAR-${token || index + 1}`;
}

function entityVariantTemplateOptions(selectedId = "") {
  const definitions = templateDefinitions(
    currentRecordType(),
    document.getElementById("contentType")?.value || "",
  );
  return ["<option value=\"\">Choose template</option>", ...definitions.map((definition) => `
    <option value="${escapeHTML(definition.id)}"${definition.id === selectedId ? " selected" : ""}>
      ${escapeHTML(`${definition.templateName || "Template"} / ${definition.name || definition.id}`)}
    </option>
  `)].join("");
}

function templateBehaviourDefaults(template) {
  const defaults = template?.defaults || {};
  return {
    isShopProduct: defaults.isShopProduct === true,
    requiresShipping: defaults.requiresShipping === true,
    inventoryTracked: defaults.inventoryTracked === true,
    soldByRecoveryTools: defaults.soldByRecoveryTools !== false,
    unlocksAccess: defaults.unlocksAccess === true,
    requiresCalendar: defaults.requiresCalendar === true,
    requiresSessionTime: defaults.requiresSessionTime === true,
    tracksSeats: defaults.tracksSeats === true,
    requiresLocation: defaults.requiresLocation === true,
    requiresInstructor: defaults.requiresInstructor === true,
    issuesCertificate: defaults.issuesCertificate === true,
  };
}

function variantBehaviourMarkup(template) {
  const defaults = templateBehaviourDefaults(template);
  const labels = [
    ["inventoryTracked", "Track entity inventory"],
  ];
  return `
    <section class="mt-3 rounded border border-gray-700 bg-gray-950/50 p-3">
      <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-300">Item behaviours</h4>
      <div class="mt-2 flex flex-wrap gap-2">
        ${labels.map(([key, label]) => `
          <span class="rounded border px-2 py-1 text-xs ${defaults[key]
    ? "border-[#407471] bg-[#153b38] text-[#bce7e4]"
    : "border-gray-700 text-gray-500"}">${escapeHTML(label)}: ${defaults[key] ? "Yes" : "No"}</span>
        `).join("")}
      </div>
    </section>`;
}

function variantTemplateFieldsMarkup(template) {
  if (!template) return "<p class=\"mt-3 text-xs text-gray-400\">Choose a template to display this variant's fields.</p>";
  return renderTemplateCustomFields(template);
}

function closeProductCategoryCreator({ restoreSelection = true } = {}) {
  const panel = document.getElementById("contentProductCategoryCreate");
  const select = document.getElementById("contentProductCategoryId");
  panel?.classList.add("hidden");
  panel?.classList.remove("flex");
  if (restoreSelection && select?.value === "__create_category__") {
    select.value = select.dataset.previousCategoryId || "";
  }
}

async function saveProductCategory() {
  const input = document.getElementById("contentProductCategoryNewName");
  const name = input?.value.trim() || "";
  if (!name) {
    showToast("Enter a category name.", "error");
    input?.focus();
    return;
  }
  const button = document.getElementById("saveContentProductCategoryBtn");
  if (button) button.disabled = true;
  try {
    const response = await upsertContentCategory({ name });
    const category = response.data?.category;
    if (!category?.id) throw new Error("The category was saved but could not be reloaded.");
    state.options.categoryOptions = [
      ...(state.options.categoryOptions || []).filter((option) => option.id !== category.id),
      category,
    ];
    fillCategorySelect(document.getElementById("contentProductCategoryId"), true);
    fillTagCategoryFilter();
    document.querySelectorAll(".content-tag-new-category")
      .forEach((select) => fillCategorySelect(select, true));
    setSelectValue("contentProductCategoryId", category.id);
    document.getElementById("contentProductCategoryId").dataset.previousCategoryId = category.id;
    if (input) input.value = "";
    closeProductCategoryCreator({ restoreSelection: false });
    renderMarketplaceTileControls();
    refreshMarketplacePreviews();
    state.isDirty = true;
    showToast(response.data?.created === false
      ? "Existing category selected."
      : "Category created and selected.", "success");
  } catch (error) {
    showToast(error.message || "Failed to create category.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function defaultTemplateDefinition(recordType = currentRecordType(), typeValue = "") {
  const definitions = templateDefinitions(
    recordType,
    typeValue || document.getElementById("contentType")?.value || "",
  );
  return definitions.find((definition) => definition.isDefault === true) || definitions[0] || null;
}

function variantStockMarkup(variant, defaults) {
  if (currentRecordType() !== "item" || defaults.inventoryTracked !== true) return "";
  const suppliers = state.options.supplierOptions || [];
  const selectedSupplier = suppliers.find((supplier) => supplier.id === variant.supplierId);
  const supplierOptions = suppliers.map((supplier) => `
    <option value="${escapeHTML(supplier.id)}"
      data-ordering-url="${escapeHTML(supplier.orderingUrl || supplier.website || "")}"
      ${supplier.id === variant.supplierId ? "selected" : ""}>
      ${escapeHTML(supplier.name || supplier.id)}
    </option>`).join("");
  const orderingUrl = externalUrl(
    variant.purchaseUrl || selectedSupplier?.orderingUrl || selectedSupplier?.website,
  );
  return `
    <section class="variant-item-stock-fields mt-3 rounded border border-gray-700 bg-gray-950/50 p-3"
      data-entity-variant-id="${escapeHTML(variant.entityVariantId || "")}">
      <h5 class="font-medium text-white">Item stock · ${escapeHTML(variant.name || variant.entityVariantId || "Variant")}</h5>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label class="block text-xs text-gray-300">Quantity on hand
          <input class="variant-stock-qty mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" step="1" value="${escapeHTML(variant.stockQty ?? "")}">
        </label>
        <label class="block text-xs text-gray-300">Reorder level
          <input class="variant-reorder-level mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" step="1" value="${escapeHTML(variant.reorderLevel ?? "")}">
        </label>
        <label class="block text-xs text-gray-300">Stock unit
          <input class="variant-inventory-unit mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(variant.inventoryUnit || "")}" placeholder="boxes, pieces, rolls">
        </label>
        <label class="block text-xs text-gray-300">Storage location
          <input class="variant-inventory-location mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(variant.inventoryLocation || "")}">
        </label>
        <label class="block text-xs text-gray-300">Approximate unit cost (AUD)
          <input class="variant-unit-cost mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" step="0.01" value="${escapeHTML(variant.unitCost ?? "")}">
        </label>
        <label class="block text-xs text-gray-300">Supplier
          <select class="variant-supplier-id mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
            <option value="">Choose supplier</option>
            ${supplierOptions}
          </select>
          <span class="mt-1 block text-xs text-gray-400">Select from the Suppliers sheet imported into the system.</span>
        </label>
        <label class="block text-xs text-gray-300">Cost reference
          <input class="variant-cost-reference mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(variant.costReference || "")}" placeholder="Quote, invoice or catalogue reference">
          <span class="mt-1 block text-xs text-gray-400">The source used to verify this unit cost.</span>
        </label>
        <label class="block text-xs text-gray-300">Item ordering page
          <input class="variant-purchase-url mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="url" value="${escapeHTML(variant.purchaseUrl || "")}" placeholder="Optional direct URL for this exact Item">
          <span class="mt-1 block text-xs text-gray-400">Overrides the supplier's general ordering page for this Item.</span>
        </label>
        <div class="flex items-end">
          <button type="button" class="open-variant-ordering-page w-full rounded border border-[#407471] px-3 py-2 text-[#9edbd7] disabled:cursor-not-allowed disabled:border-gray-700 disabled:text-gray-500"
            data-ordering-url="${escapeHTML(orderingUrl)}" ${orderingUrl ? "" : "disabled"}>
            Open ordering page
          </button>
        </div>
      </div>
    </section>`;
}

function updateVariantOrderingButton(row) {
  if (!row) return;
  const directUrl = row.querySelector(".variant-purchase-url")?.value.trim() || "";
  const supplierSelect = row.querySelector(".variant-supplier-id");
  const supplierUrl = supplierSelect?.selectedOptions?.[0]?.dataset.orderingUrl || "";
  const url = externalUrl(directUrl || supplierUrl);
  const button = row.querySelector(".open-variant-ordering-page");
  if (!button) return;
  button.dataset.orderingUrl = url;
  button.disabled = !url;
}

function renderVariantStepRows(variants) {
  const definitions = templateDefinitions(currentRecordType(), document.getElementById("contentType")?.value);
  const connections = document.getElementById("contentVariantConnectionRows");
  const review = document.getElementById("contentVariantReviewRows");
  const actions = document.getElementById("contentVariantActionRows");
  if (connections) connections.innerHTML = variants.map((variant, index) => {
    const template = definitions.find((candidate) => candidate.id === variant.templateVariantId);
    const defaults = templateBehaviourDefaults(template);
    return `<details class="content-variant-connection-row rounded border border-gray-700 bg-gray-900/60" ${index === 0 ? "open" : ""} data-entity-variant-id="${escapeHTML(variant.entityVariantId)}">
      <summary class="cursor-pointer bg-gray-800/70 p-3 text-sm text-white">${escapeHTML(variant.name || `Variant ${index + 1}`)} · ${escapeHTML(template ? templateOptionLabel(template) : "No template")} · ${escapeHTML(variant.owner || "Recovery Tools")}</summary>
      <div class="p-3">
      <div class="grid gap-3 md:grid-cols-2">
        <label class="inline-flex items-center gap-2">
          <input class="variant-add-to-shop accent-[#407471]" type="checkbox" ${variant.shopEnabled === true ? "checked" : ""}>
          Add this variant to the Shop Product
        </label>
        <label class="inline-flex items-center gap-2">
          <input class="variant-add-to-library accent-[#407471]" type="checkbox" ${variant.libraryVisible === true ? "checked" : ""}>
          Add this variant to the Library
        </label>
        ${currentRecordType() === "blueprint" ? `
        <label class="inline-flex items-center gap-2 md:col-span-2">
          <input class="variant-use-as-manufacturing accent-[#407471]" type="checkbox"
            ${variant.manufacturingRecipe === true ||
              (variant.manufacturingRecipe !== false && isProductManufactureBlueprint()) ? "checked" : ""}>
          Use this Blueprint variant as a Product manufacturing / cost recipe
        </label>
        <p class="text-xs text-gray-400 md:col-span-2">Internal only. The Item recipe entered on Build supplies the parts, quantities and estimated cost.</p>
        ` : ""}
      </div>
      ${currentRecordType() === "item" ? variantBehaviourMarkup(template) : ""}
      ${variantStockMarkup(variant, defaults)}
      </div>
    </details>`;
  }).join("");
  if (review) review.innerHTML = variants.map((variant, index) => {
    const template = definitions.find((candidate) => candidate.id === variant.templateVariantId);
    const entityDefaults = variant.behaviourDefaults || templateBehaviourDefaults(template);
    const enabled = entityDefaults.inventoryTracked === true ? "Track entity inventory" : "";
    const connections = [
      variant.shopEnabled ? "Shop Product" : "",
      variant.libraryVisible ? "Library" : "",
      variant.manufacturingRecipe ? "Manufacturing recipe" : "",
    ].filter(Boolean).join(", ");
    return `<details class="rounded border border-gray-700 bg-gray-900/60" ${index === 0 ? "open" : ""}>
      <summary class="cursor-pointer bg-gray-800/70 p-3 text-sm text-white">${escapeHTML(variant.name || `Variant ${index + 1}`)} · ${escapeHTML(template ? templateOptionLabel(template) : "No template")} · ${escapeHTML(variant.owner || "Recovery Tools")}</summary>
      <div class="p-3">
      <dl class="mt-2 grid gap-2 text-xs text-gray-300 sm:grid-cols-2">
        <div><dt class="text-gray-500">Template</dt><dd>${escapeHTML(templateOptionLabel(template))}</dd></div>
        <div><dt class="text-gray-500">Status</dt><dd>${escapeHTML(variant.status || "draft")}</dd></div>
        <div class="sm:col-span-2"><dt class="text-gray-500">Connections</dt><dd>${escapeHTML(connections || "None")}</dd></div>
        ${currentRecordType() === "item" ? `<div class="sm:col-span-2"><dt class="text-gray-500">Enabled behaviours</dt><dd>${escapeHTML(enabled || "Standard Item")}</dd></div>` : ""}
      </dl>
      </div>
    </details>`;
  }).join("");
  if (actions) actions.innerHTML = variants.map((variant, index) => `
    <details class="content-variant-action-row rounded border border-gray-700 bg-gray-900/60" ${index === 0 ? "open" : ""} data-entity-variant-id="${escapeHTML(variant.entityVariantId)}">
      <summary class="cursor-pointer bg-gray-800/70 p-3 text-sm text-white">${escapeHTML(variant.name || `Variant ${index + 1}`)} · ${escapeHTML(variant.owner || "Recovery Tools")}</summary>
      <div class="p-3">
      <div class="mt-3 grid gap-3 md:grid-cols-3">
        <label class="block text-xs text-gray-300">Status
          <select class="content-entity-variant-status mt-1 w-full rounded border px-3 py-2 ${lifecycleStatusClasses(variant.status)}">${compactSelectOptions(["draft", "review", "active", "paused", "archived"], variant.status || "draft")}</select>
        </label>
        <label class="block text-xs text-gray-300">Set active at
          <input class="content-entity-variant-active-at mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="datetime-local" value="${escapeHTML(variant.scheduledActiveAt || "")}">
        </label>
        <label class="block text-xs text-gray-300">Pause at
          <input class="content-entity-variant-pause-at mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="datetime-local" value="${escapeHTML(variant.scheduledPauseAt || "")}">
        </label>
      </div>
      </div>
    </details>`).join("");
}

function compactSelectOptions(values, selectedValue) {
  return values.map((value) => {
    const selected = value === selectedValue ? " selected" : "";
    return `<option value="${value}"${selected}>${value}</option>`;
  }).join("");
}

function variantReferenceRowMarkup(value = "") {
  return `
    <div class="content-entity-variant-reference-row flex gap-2">
      <input class="content-entity-variant-reference min-w-0 flex-1 rounded bg-gray-800 px-3 py-2 text-white"
        value="${escapeHTML(value)}" placeholder="Internal or source reference">
      <button type="button" class="remove-content-entity-variant-reference rounded border border-gray-600 px-3 py-2 text-xs text-gray-300">Remove</button>
    </div>`;
}

function blueprintRecipeItemOptions(selectedId = "") {
  return ["<option value=\"\">Choose Item</option>", ...(state.records.items || []).map((item) => {
    const selected = item.id === selectedId ? " selected" : "";
    const cost = Number(item.itemUnitCost ?? 0).toFixed(2);
    return `<option value="${escapeHTML(item.id)}"${selected}>` +
      `${escapeHTML(item.name || item.id)} ($${cost})</option>`;
  })].join("");
}

const lifecycleStatusClassNames = [
  "border-violet-500", "bg-violet-950", "text-violet-100", "ring-violet-500/40",
  "border-blue-500", "bg-blue-950", "text-blue-100", "ring-blue-500/40",
  "border-emerald-500", "bg-emerald-950", "text-emerald-100", "ring-emerald-500/40",
  "border-amber-500", "bg-amber-950", "text-amber-100", "ring-amber-500/40",
  "border-gray-600", "bg-gray-900", "text-gray-300", "ring-gray-500/40",
  "bg-gray-800", "bg-gray-950", "text-white", "ring-1",
];

function lifecycleStatusClasses(value) {
  const lifecycle = normalizedText(value || "draft");
  if (lifecycle === "draft") return "border-violet-500 bg-violet-950 text-violet-100 ring-1 ring-violet-500/40";
  if (lifecycle === "review") return "border-blue-500 bg-blue-950 text-blue-100 ring-1 ring-blue-500/40";
  if (lifecycle === "active") return "border-emerald-500 bg-emerald-950 text-emerald-100 ring-1 ring-emerald-500/40";
  if (lifecycle === "paused") return "border-amber-500 bg-amber-950 text-amber-100 ring-1 ring-amber-500/40";
  return "border-gray-600 bg-gray-900 text-gray-300 ring-1 ring-gray-500/40";
}

function applyLifecycleStatusHighlight(control, value = control?.value) {
  if (!control) return;
  control.classList.remove(...lifecycleStatusClassNames);
  control.classList.add(...lifecycleStatusClasses(value).split(" "));
}

function workshopOperationsSourceOptions(sourceType, selectedId = "") {
  const records = sourceType === "Product" ? state.records.products || [] : state.records.items || [];
  return [`<option value="">Choose ${sourceType}</option>`, ...records.map((record) => {
    const selected = record.id === selectedId ? " selected" : "";
    return `<option value="${escapeHTML(record.id)}"${selected}>${escapeHTML(record.name || record.id)}</option>`;
  })].join("");
}

function workshopOperationsVariantOptions(sourceType, sourceId, selectedId = "") {
  const record = (sourceType === "Product" ? state.records.products || [] : state.records.items || [])
    .find((candidate) => candidate.id === sourceId);
  const variants = sourceType === "Product" ? record?.variants || [] : record?.entityVariants || [];
  return [`<option value="">Default ${sourceType} stock</option>`, ...(variants || []).map((variant) => {
    const id = sourceType === "Product"
      ? variant.variantId || variant.id : variant.entityVariantId || variant.id;
    return `<option value="${escapeHTML(id)}"${id === selectedId ? " selected" : ""}>${escapeHTML(variant.name || id)}</option>`;
  })].join("");
}

function itemVariantsForRecipe(itemId) {
  const item = (state.records.items || []).find((record) => record.id === itemId);
  return Array.isArray(item?.entityVariants) ? item.entityVariants : [];
}

function blueprintRecipeVariantOptions(itemId, selectedId = "") {
  const variants = itemVariantsForRecipe(itemId);
  if (!variants.length) return "<option value=\"\">Default Item stock</option>";
  return [
    `<option value="">${variants.length > 1 ? "Choose Item variant" : "Default Item variant"}</option>`,
    ...variants.map((variant) => {
      const variantId = variant.entityVariantId || "";
      return `<option value="${escapeHTML(variantId)}"${variantId === selectedId ? " selected" : ""}>` +
        `${escapeHTML(variant.name || variantId)}</option>`;
    }),
  ].join("");
}

function recipeComponentUnitCost(itemId, itemVariantId = "") {
  const item = (state.records.items || []).find((record) => record.id === itemId);
  const variant = itemVariantsForRecipe(itemId).find((candidate) =>
    candidate.entityVariantId === itemVariantId);
  return Number(variant?.unitCost ?? item?.itemUnitCost ?? 0) || 0;
}

function blueprintVariantRecipeMarkup(variant) {
  if (currentRecordType() !== "blueprint") return "";
  const blueprintType = normalizedType(document.getElementById("contentType")?.value);
  if (!["product manufacture", "workshop operations"].includes(blueprintType)) return "";
  const workshopOperations = blueprintType === "workshop operations";
  const components = Array.isArray(variant.linkedItemComponents) ? variant.linkedItemComponents : [];
  const rows = components.map((component, index) => {
    const sourceType = component.productId ? "Product" : "Item";
    const sourceId = component.productId || component.itemId || "";
    const sourceVariantId = component.productVariantId || component.itemVariantId || "";
    return `
    <div class="blueprint-variant-recipe-row grid gap-2 rounded border border-gray-700 p-2 ${workshopOperations ? "md:grid-cols-2 xl:grid-cols-[8rem_1fr_1fr_8rem_11rem_10rem_auto]" : "md:grid-cols-[1fr_1fr_7rem_auto]"}"
      data-component-id="${escapeHTML(component.componentId || `COMPONENT-${index + 1}`)}">
      ${workshopOperations ? `<select class="blueprint-variant-recipe-source-type rounded bg-gray-800 px-2 py-2 text-white" aria-label="Stock source type">
        ${compactSelectOptions(["Item", "Product"], sourceType)}
      </select>` : ""}
      <select class="blueprint-variant-recipe-item rounded bg-gray-800 px-2 py-2 text-white">
        ${workshopOperations ? workshopOperationsSourceOptions(sourceType, sourceId) : blueprintRecipeItemOptions(component.itemId)}
      </select>
      <select class="blueprint-variant-recipe-item-variant rounded bg-gray-800 px-2 py-2 text-white"
        aria-label="${sourceType} variant">
        ${workshopOperations ? workshopOperationsVariantOptions(sourceType, sourceId, sourceVariantId) : blueprintRecipeVariantOptions(component.itemId, component.itemVariantId)}
      </select>
      <input class="blueprint-variant-recipe-quantity rounded bg-gray-800 px-2 py-2 text-white"
        type="number" min="0" step="0.01" value="${escapeHTML(component.quantity ?? 1)}" aria-label="Quantity">
      ${workshopOperations ? `
      <select class="blueprint-variant-recipe-quantity-basis rounded bg-gray-800 px-2 py-2 text-white" aria-label="Quantity basis">
        ${compactSelectOptions(["fixed", "capacity", "confirmed-attendees", "actual-attendees"], component.quantityBasis || "fixed")}
      </select>
      <select class="blueprint-variant-recipe-inventory-treatment rounded bg-gray-800 px-2 py-2 text-white" aria-label="Inventory treatment">
        ${compactSelectOptions(["bring-return", "consumable", "take-home", "reference", "digital-instruction"], component.inventoryTreatment || "bring-return")}
      </select>` : ""}
      <button type="button" class="remove-blueprint-variant-recipe-row rounded border border-red-700 px-3 py-1 text-red-200">Remove</button>
    </div>`;
  }).join("");
  const total = components.reduce((sum, component) => sum + Number(component.estimatedCost ?? 0), 0);
  return `
    <details class="mt-3 rounded border border-gray-700 p-3">
      <summary class="cursor-pointer font-semibold text-white">${workshopOperations ? "Workshop equipment, consumables and giveaways" : "Variant-specific Item recipe"}</summary>
      ${workshopOperations ? "<p class=\"mt-2 text-xs text-gray-400\">Allocate exact Items, Item variants, Products, or Product variants. Use fixed for a session total, or multiply by capacity, confirmed attendees, or actual attendance. Consumables and take-home stock are only deducted when explicitly issued.</p>" : ""}
      <div class="blueprint-variant-recipe-rows mt-3 space-y-2">${rows || "<p class=\"text-xs text-gray-400\">No variant-specific Items yet.</p>"}</div>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" class="add-blueprint-variant-recipe-row rounded border border-[#407471] px-3 py-1 text-xs text-[#9edbd7]">Add ${workshopOperations ? "requirement" : "Item"}</button>
        <span class="blueprint-variant-recipe-total text-sm text-white">Estimated cost: $${total.toFixed(2)}</span>
      </div>
    </details>`;
}

function renderEntityVariantRows(variants = []) {
  const container = document.getElementById("contentEntityVariantRows");
  if (!container) return;
  const normalizedVariants = variants.length ? variants : [{
    name: "Primary",
    templateVariantId: document.getElementById("contentTemplate")?.value || "",
    status: "draft",
  }];
  const countText = document.getElementById("contentVariantCountText");
  if (countText) {
    countText.textContent = `${normalizedVariants.length} variant${normalizedVariants.length === 1 ? "" : "s"} in this record`;
  }
  container.innerHTML = normalizedVariants.map((variant, index) => {
    const templateVariantId = variant.templateVariantId || variant.variantId || variant.templateId || "";
    const variantId = variant.entityVariantId || entityVariantId(variant.name || `Variant ${index + 1}`, index);
    const template = templateDefinitions(currentRecordType(), document.getElementById("contentType")?.value)
      .find((candidate) => candidate.id === templateVariantId);
    const expanded = variant.expanded === true || (index === 0 && variant.expanded !== false);
    return `
    <details class="content-entity-variant-row overflow-hidden rounded-lg border border-gray-600 border-l-4 border-l-[#407471] bg-gray-900/80 shadow-md"
      ${expanded ? "open" : ""}
      data-entity-variant-id="${escapeHTML(variantId)}"
      data-size-label="${escapeHTML(variant.sizeLabel || "")}"
      data-created-by-uid="${escapeHTML(variant.createdByUid || "")}"
      data-created-by-email="${escapeHTML(variant.createdByEmail || "")}"
      data-approved-by-uid="${escapeHTML(variant.approvedByUid || "")}"
      data-approved-by-email="${escapeHTML(variant.approvedByEmail || "")}">
      <summary class="cursor-pointer list-none bg-gray-800/90 p-4 text-sm marker:hidden hover:bg-gray-800">
        <div class="grid items-center gap-3 sm:grid-cols-[auto_auto_1fr_1fr_1fr]">
          <span class="content-entity-variant-chevron text-lg font-semibold text-[#9edbd7]">${expanded ? "−" : "+"}</span>
          <span class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#407471] bg-[#153b38] font-semibold text-[#bce7e4]">${index + 1}</span>
          <span><span class="block text-xs font-medium uppercase tracking-wide text-[#9edbd7]">${index === 0 ? "Primary variant" : `Additional variant ${index + 1}`}</span><strong class="variant-summary-name mt-0.5 block text-base text-white">${escapeHTML(variant.name || `Variant ${index + 1}`)}</strong></span>
          <span><span class="block text-xs text-gray-500">Template</span><span class="text-gray-200">${escapeHTML(template ? templateOptionLabel(template) : "Not selected")}</span></span>
          <span><span class="block text-xs text-gray-500">Owner</span><span class="variant-summary-owner text-gray-200">${escapeHTML(variant.owner || state.editingRecord?.owner || "Recovery Tools")}</span></span>
        </div>
      </summary>
      <div class="border-t border-gray-700 bg-gray-950/30 p-4">
      <div class="mb-3 flex justify-end">
        ${index === 0 ? "" : `<button type="button" class="remove-content-entity-variant rounded border border-red-700 px-3 py-1 text-xs text-red-200">Remove variant</button>`}
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label class="block text-xs text-gray-300">
          Variant name
          <input class="content-entity-variant-name mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            value="${escapeHTML(variant.name || "")}" placeholder="30 minutes">
        </label>
        <label class="block text-xs text-gray-300">
          Template / template variant
          <select class="content-entity-variant-template mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
            ${entityVariantTemplateOptions(templateVariantId)}
          </select>
        </label>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" class="edit-entity-variant-template rounded border border-gray-500 px-3 py-1 text-xs text-white" ${template ? "" : "disabled"}>Edit selected template</button>
        ${templateDefinitions(currentRecordType(), document.getElementById("contentType")?.value).length
    ? ""
    : `<button type="button" class="create-entity-variant-template rounded border border-[#407471] px-3 py-1 text-xs text-[#9edbd7]">Create first template</button>`}
      </div>
      <div class="entity-variant-template-fields">${variantTemplateFieldsMarkup(template, currentRecordType(), variant)}</div>
      <section class="mt-4 text-xs text-gray-300">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span>References</span>
          <button type="button" class="add-content-entity-variant-reference rounded border border-[#407471] px-3 py-1 text-xs text-[#9edbd7]">Add another</button>
        </div>
        <div class="content-entity-variant-reference-rows mt-2 space-y-2">
          ${(Array.isArray(variant.references) && variant.references.length
    ? variant.references
    : [variant.reference || ""]).map((reference) => variantReferenceRowMarkup(reference)).join("")}
        </div>
      </section>
      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <label class="block text-xs text-gray-300">
          Owner
          <input class="content-entity-variant-owner mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            value="${escapeHTML(variant.owner || state.editingRecord?.owner || "Recovery Tools")}">
        </label>
        <label class="block text-xs text-gray-300">
          Owner type
          <select class="content-entity-variant-owner-type mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
            ${compactSelectOptions(
    ["admin", "therapist", "affiliate"],
    variant.ownerType || state.editingRecord?.ownerType || "admin",
  )}
          </select>
        </label>
      </div>
      ${blueprintVariantRecipeMarkup(variant)}
      <div class="mt-4 border-t border-gray-700 pt-3 text-xs text-gray-400">
        <p>Creator: ${escapeHTML(variant.createdByEmail || "Set when saved")}</p>
        <p class="mt-1">Approved by: ${escapeHTML(variant.approvedByEmail || "Not approved")}</p>
      </div>
      </div>
    </details>
  `; }).join("");
  normalizedVariants.forEach((variant, index) => {
    restoreTemplateFieldValuesInRoot(
      container.querySelectorAll(".content-entity-variant-row")[index],
      variant.templateFieldValues || {},
    );
  });
  renderVariantStepRows(normalizedVariants.map((variant, index) => ({
    ...variant,
    entityVariantId: variant.entityVariantId || entityVariantId(variant.name || `Variant ${index + 1}`, index),
  })));
}

function entityVariantsFromBuilder() {
  return [...document.querySelectorAll(".content-entity-variant-row")].map((row, index) => {
    const name = row.querySelector(".content-entity-variant-name")?.value.trim() || `Variant ${index + 1}`;
    const variantId = row.dataset.entityVariantId || entityVariantId(name, index);
    const actionRow = document.querySelector(
      `.content-variant-review-row[data-entity-variant-id="${CSS.escape(variantId)}"]`,
    ) || document.querySelector(
      `.content-variant-action-row[data-entity-variant-id="${CSS.escape(variantId)}"]`,
    );
    const connectionRow = document.querySelector(`.content-variant-connection-row[data-entity-variant-id="${CSS.escape(variantId)}"]`);
    const templateVariantId = row.querySelector(".content-entity-variant-template")?.value || "";
    const definition = templateDefinitions(currentRecordType(), document.getElementById("contentType")?.value)
      .find((candidate) => candidate.id === templateVariantId);
    const recipeComponents = [...row.querySelectorAll(".blueprint-variant-recipe-row")].map((recipeRow) => {
      const sourceType = recipeRow.querySelector(".blueprint-variant-recipe-source-type")?.value || "Item";
      const sourceId = recipeRow.querySelector(".blueprint-variant-recipe-item")?.value || "";
      const sourceVariantId = recipeRow.querySelector(".blueprint-variant-recipe-item-variant")?.value || "";
      const itemId = sourceType === "Item" ? sourceId : "";
      const itemVariantId = sourceType === "Item" ? sourceVariantId : "";
      const productId = sourceType === "Product" ? sourceId : "";
      const productVariantId = sourceType === "Product" ? sourceVariantId : "";
      const quantity = optionalNumberFromElement(
        recipeRow.querySelector(".blueprint-variant-recipe-quantity"),
      ) ?? 0;
      const unitCost = recipeComponentUnitCost(itemId, itemVariantId);
      return {
        componentId: recipeRow.dataset.componentId || `COMPONENT-${index + 1}`,
        itemId,
        itemVariantId,
        productId,
        productVariantId,
        quantity,
        unit: "each",
        quantityBasis: recipeRow.querySelector(".blueprint-variant-recipe-quantity-basis")?.value || "fixed",
        inventoryTreatment:
          recipeRow.querySelector(".blueprint-variant-recipe-inventory-treatment")?.value || "bring-return",
        deductOnIssue: ["consumable", "take-home"].includes(
          recipeRow.querySelector(".blueprint-variant-recipe-inventory-treatment")?.value,
        ),
        unitCost,
        estimatedCost: quantity * unitCost,
      };
    }).filter((component) => (component.itemId || component.productId) && component.quantity > 0);
    const references = uniqueValues([...row.querySelectorAll(".content-entity-variant-reference")]
      .map((input) => input.value));
    return {
      entityVariantId: variantId,
      name,
      templateId: definition?.templateId || "",
      templateVariantId,
      durationMinutes: null,
      // Retain legacy values without exposing a generic field. Element-specific
      // size or label fields belong in the selected variant template.
      sizeLabel: row.dataset.sizeLabel || "",
      reference: references[0] || "",
      references,
      owner: row.querySelector(".content-entity-variant-owner")?.value.trim() || "",
      ownerType: row.querySelector(".content-entity-variant-owner-type")?.value || "admin",
      templateFieldValues: templateFieldValuesFromBuilder({ root: row }),
      behaviourDefaults: templateBehaviourDefaults(definition),
      shopEnabled: connectionRow?.querySelector(".variant-add-to-shop")?.checked === true,
      libraryVisible: connectionRow?.querySelector(".variant-add-to-library")?.checked === true,
      manufacturingRecipe:
        connectionRow?.querySelector(".variant-use-as-manufacturing")?.checked === true,
      linkedItemComponents: recipeComponents,
      estimatedUnitCost: recipeComponents.reduce((sum, component) => sum + component.estimatedCost, 0),
      stockQty: optionalNumberFromElement(connectionRow?.querySelector(".variant-stock-qty")),
      reorderLevel: optionalNumberFromElement(connectionRow?.querySelector(".variant-reorder-level")),
      inventoryUnit: connectionRow?.querySelector(".variant-inventory-unit")?.value.trim() || "",
      inventoryLocation: connectionRow?.querySelector(".variant-inventory-location")?.value.trim() || "",
      unitCost: optionalNumberFromElement(connectionRow?.querySelector(".variant-unit-cost")),
      supplierId: connectionRow?.querySelector(".variant-supplier-id")?.value || "",
      costReference: connectionRow?.querySelector(".variant-cost-reference")?.value.trim() || "",
      purchaseUrl: connectionRow?.querySelector(".variant-purchase-url")?.value.trim() || "",
      status: actionRow?.querySelector(".content-entity-variant-status")?.value || "draft",
      scheduledActiveAt: actionRow?.querySelector(".content-entity-variant-active-at")?.value || "",
      scheduledPauseAt: actionRow?.querySelector(".content-entity-variant-pause-at")?.value || "",
      createdByUid: row.dataset.createdByUid || "",
      createdByEmail: row.dataset.createdByEmail || "",
      approvedByUid: row.dataset.approvedByUid || "",
      approvedByEmail: row.dataset.approvedByEmail || "",
      expanded: row.open === true,
      sortOrder: index + 1,
    };
  });
}

function optionalNumberFromElement(input) {
  if (!input || input.value === "") return null;
  const amount = Number(input.value);
  return Number.isFinite(amount) ? amount : null;
}

function addEntityVariantRow() {
  const existingVariants = entityVariantsFromBuilder().map((variant) => ({
    ...variant,
    expanded: false,
  }));
  renderEntityVariantRows([
    ...existingVariants,
    { name: "", templateVariantId: "", durationMinutes: null, expanded: true },
  ]);
}

function updateBlueprintVariantRecipeTotals() {
  document.querySelectorAll(".content-entity-variant-row").forEach((variantRow) => {
    let total = 0;
    variantRow.querySelectorAll(".blueprint-variant-recipe-row").forEach((recipeRow) => {
      const sourceType = recipeRow.querySelector(".blueprint-variant-recipe-source-type")?.value || "Item";
      const itemId = recipeRow.querySelector(".blueprint-variant-recipe-item")?.value || "";
      const itemVariantId =
        recipeRow.querySelector(".blueprint-variant-recipe-item-variant")?.value || "";
      const quantity = optionalNumberFromElement(
        recipeRow.querySelector(".blueprint-variant-recipe-quantity"),
      ) ?? 0;
      total += sourceType === "Item" ? quantity * recipeComponentUnitCost(itemId, itemVariantId) : 0;
    });
    const output = variantRow.querySelector(".blueprint-variant-recipe-total");
    if (output) output.textContent = `Estimated cost: $${total.toFixed(2)}`;
  });
}

function generatedProductVariantId(entityVariantId) {
  const productToken = document.getElementById("contentProductId")?.value ||
    document.getElementById("contentId")?.value ||
    document.getElementById("contentName")?.value || "PRODUCT";
  const cleanToken = (value) => String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `PV-${cleanToken(productToken)}-${cleanToken(entityVariantId)}`;
}

function primaryImageAssetIdForEntityVariant(entityVariant) {
  const assetIds = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
      return;
    }
    const id = String(value || "").trim();
    if (id) assetIds.push(id);
  };
  visit(entityVariant?.templateFieldValues || {});
  return assetIds.find((assetId) => {
    const asset = (state.records.assets || []).find((entry) =>
      (entry.assetId || entry.id) === assetId);
    return normalizedText(asset?.assetType || asset?.type) === "image";
  }) || "";
}

function populateProductVariantsFromEntity() {
  const input = document.getElementById("contentProductVariants");
  if (!input) return;
  const current = parseProductVariants(input.value);
  const entityVariants = entityVariantsFromBuilder();
  const selected = entityVariants.filter((variant) => variant.shopEnabled === true);
  // Product variants are independent records once created. Entity-variant Shop
  // checkboxes may add a Product variant, but deselecting a checkbox must not
  // silently delete an existing sellable variant. Use the explicit Remove
  // Product variant control for deletion.
  const retained = [...current];
  const usedVariantIds = new Set();

  selected.forEach((entityVariant) => {
    let productVariant = retained.find((variant) => variant.contentVariantId === entityVariant.entityVariantId);
    if (!productVariant) {
      productVariant = retained.find((variant) =>
        !usedVariantIds.has(variant.variantId) &&
        normalizedText(variant.name) === normalizedText(entityVariant.name));
    }
    if (productVariant) {
      productVariant.contentVariantId = entityVariant.entityVariantId;
      productVariant.primaryAssetId = productVariant.primaryAssetId ||
        primaryImageAssetIdForEntityVariant(entityVariant);
      usedVariantIds.add(productVariant.variantId);
      return;
    }
    const generated = {
      variantId: generatedProductVariantId(entityVariant.entityVariantId),
      name: entityVariant.name,
      colour: "",
      size: entityVariant.sizeLabel || "",
      sku: "",
      priceOverride: null,
      stock: 0,
      status: "draft",
      contentVariantId: entityVariant.entityVariantId,
      primaryAssetId: primaryImageAssetIdForEntityVariant(entityVariant),
    };
    retained.push(generated);
    usedVariantIds.add(generated.variantId);
  });

  input.value = serializeProductVariants(retained);
  renderSelectedProductVariantRows(retained);
  renderProductVariantContentLinkRows(productVariantContentLinksFromRows(true));
  updateProductPhysicalFields();
}

function renderSelectedProductVariantRows(productVariants = currentProductVariants()) {
  const container = document.getElementById("contentProductVariantRows");
  if (!container) return;
  const summary = document.getElementById("contentProductVariantSummary");
  if (!productVariants.length) {
    if (summary) summary.textContent = "No Product variants yet.";
    container.innerHTML = "<p class=\"text-sm text-gray-400\">Add a Product variant or select an entity variant for Shop.</p>";
    renderMarketplaceTileControls();
    return;
  }
  if (summary) {
    summary.textContent = `${productVariants.length} Product variant${productVariants.length === 1 ? "" : "s"}`;
  }
  const affiliateAvailable = document.getElementById("contentProductAvailableToAffiliates")?.checked === true;
  const productPrice = optionalNumberFromInput("contentProductPrice");
  const productAffiliatePrice = optionalNumberFromInput("contentProductWholesalePrice");
  const productShortDescription = document.getElementById("contentShortDescription")?.value || "";
  const productLongDescription = document.getElementById("contentLongDescription")?.value || "";
  const productMarketplaceMode = document.getElementById("contentProductMarketplaceMode")?.value || "hidden";
  const availableEntityVariants = entityVariantsFromBuilder();
  const sourceNote = (source, restoreTarget = "") => `
    <span class="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
      <span>${escapeHTML(source)}</span>
      ${restoreTarget ? `<button type="button" data-restore-variant-field="${escapeHTML(restoreTarget)}"
        class="text-[#9edbd7] underline decoration-dotted underline-offset-2">Restore inherited value</button>` : ""}
    </span>`;
  const instructorOptions = (selectedInstructor = "") => {
    const options = [...(state.options.instructorOptions || [])];
    if (selectedInstructor && !options.some((option) =>
      option.id === selectedInstructor || option.name === selectedInstructor)) {
      options.push({ id: selectedInstructor, name: selectedInstructor, email: "" });
    }
    return options.map((option) => {
      const selected = option.id === selectedInstructor || option.name === selectedInstructor
        ? " selected"
        : "";
      const label = option.email ? `${option.name} (${option.email})` : option.name;
      return `<option value="${escapeHTML(option.id || option.name)}"${selected}>${escapeHTML(label)}</option>`;
    }).join("");
  };
  container.innerHTML = productVariants.map((productVariant, index) => {
    const entityVariant = availableEntityVariants.find((variant) =>
      variant.entityVariantId === productVariant.contentVariantId) || {};
    const entityVariantOptions = availableEntityVariants.map((variant) => {
      const id = variant.entityVariantId || "";
      const selected = id && id === productVariant.contentVariantId ? " selected" : "";
      const label = variant.name && variant.name !== id ? `${variant.name} (${id})` : variant.name || id;
      return `<option value="${escapeHTML(id)}"${selected}>${escapeHTML(label)}</option>`;
    }).join("");
    const entityVariantLinkReviewed = productVariant.contentVariantLinkReviewed === true ||
      Boolean(productVariant.contentVariantId);
    const entityVariantLinkValue = productVariant.contentVariantId ||
      (entityVariantLinkReviewed ? "__none__" : "");
    return `
      <div class="content-product-variant-row overflow-hidden rounded-lg border border-gray-600 border-l-4 border-l-[#407471] bg-gray-900/80"
        data-content-variant-id="${escapeHTML(productVariant.contentVariantId || "")}"
        data-product-variant-id="${escapeHTML(productVariant.variantId || "")}"
        data-purchase-setup-reviewed="${productVariant.purchaseSetupReviewed === true}">
        <div class="bg-gray-800/90 p-3">
          <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
            <button type="button" data-duplicate-product-variant class="rounded border border-[#407471] px-3 py-2 text-xs text-[#9edbd7]">Duplicate variant</button>
            <label class="w-full max-w-sm text-xs font-medium text-gray-200">Connect to Entity Variant
              <select class="product-variant-content-variant mt-1 w-full rounded border px-3 py-2 text-white ${entityVariantLinkReviewed ? "border-[#407471] bg-gray-950" : "border-purple-500 bg-purple-950/40 ring-1 ring-purple-500"}">
                <option value=""${entityVariantLinkValue ? "" : " selected"}>Review entity variant connection</option>
                <option value="__none__"${entityVariantLinkValue === "__none__" ? " selected" : ""}>None</option>
                ${entityVariantOptions}
              </select>
            </label>
          </div>
          ${marketplaceVariantCardPreview(productVariant, entityVariant, index === 0, true)}
        </div>
        <div class="product-variant-editor-panel hidden grid gap-3 border-t border-gray-700 bg-gray-950/30 p-4 md:grid-cols-2 xl:grid-cols-4">
          <div class="variant-editor-heading rounded border border-[#407471] bg-gray-900/80 p-4 md:col-span-2 xl:col-span-4">
            <div>
              <h5 class="variant-editor-heading-title font-semibold text-white">Product variant details</h5>
              <p class="mt-1 text-xs text-gray-400">Edit this section, then select Done to return to the variant detail preview.</p>
            </div>
          </div>
          <div class="variant-editor-done-footer flex justify-end md:col-span-2 xl:col-span-4">
            <button type="button" data-close-variant-section class="rounded border border-[#407471] px-3 py-1 text-[#9edbd7]">Done</button>
          </div>
          <section data-variant-editor-section="image" class="rounded border border-[#407471] bg-gray-900/80 p-4 md:col-span-2 xl:col-span-4">
            <h5 class="font-semibold text-white">Marketplace image</h5>
            <label class="mt-3 block text-sm">Hero image Asset
              <select class="product-variant-primary-asset mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
                ${marketplaceAssetOptions(productVariant.primaryAssetId, "image", "Choose an image")}
              </select>
              <span class="mt-1 block text-xs text-gray-400">Only the Asset selected here is public.</span>
            </label>
          </section>
          <section data-variant-editor-section="identity" class="grid gap-3 rounded border border-[#407471] bg-gray-900/80 p-4 md:col-span-2 md:grid-cols-2 xl:col-span-4 xl:grid-cols-4">
            <div class="md:col-span-2 xl:col-span-4">
              <h5 class="font-semibold text-white">Product variant details</h5>
              <p class="text-xs text-gray-400">Identity and labels for this sellable variant.</p>
              <div class="mt-3 flex flex-wrap items-end gap-2 rounded border border-gray-700 bg-gray-950/50 p-3">
                <label class="min-w-52 flex-1 text-xs text-gray-300">Copy settings from another variant
                  <select class="copy-product-variant-source mt-1 w-full rounded bg-gray-800 px-3 py-2 text-sm text-white">
                    <option value="">Choose Product variant</option>
                    ${productVariants.filter((candidate) => candidate.variantId !== productVariant.variantId)
    .map((candidate) => `<option value="${escapeHTML(candidate.variantId)}">${escapeHTML(candidate.name || candidate.variantId)}</option>`).join("")}
                  </select>
                </label>
                <button type="button" data-copy-product-variant-settings class="rounded border border-[#407471] px-3 py-2 text-xs text-[#9edbd7]">Copy settings</button>
              </div>
            </div>
            <label class="block text-sm">Selling name
              <input class="product-variant-name mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(productVariant.name || entityVariant.name || "")}">
              ${sourceNote(entityVariant.name && normalizedText(productVariant.name) === normalizedText(entityVariant.name) ? "Inherited from Item variant" : productVariant.name ? "Variant override" : "Not configured", "name")}
            </label>
            <label class="block text-sm">Product variant ID
            <input class="product-variant-id mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(productVariant.variantId || "")}">
            </label>
            <label class="block text-sm">Exact variant SKU
            <input class="product-variant-sku mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(productVariant.sku || "")}" placeholder="Auto-filled if blank">
            ${sourceNote("Variant override")}
            </label>
            <label class="block text-sm">Variant colour
            <input class="product-variant-colour mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(productVariant.colour || "")}">
            ${sourceNote(entityVariant.colour && normalizedText(productVariant.colour) === normalizedText(entityVariant.colour) ? "Inherited from Item variant" : productVariant.colour ? "Variant override" : "Not configured", "colour")}
            </label>
            <label class="block text-sm">Customer size label
            <input class="product-variant-size mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(productVariant.size || entityVariant.sizeLabel || "")}">
            ${sourceNote(entityVariant.sizeLabel && normalizedText(productVariant.size) === normalizedText(entityVariant.sizeLabel) ? "Inherited from Item variant" : productVariant.size ? "Variant override" : "Not configured", "size")}
            </label>
            <label class="block text-sm">Shipping weight
              <span class="mt-1 flex gap-2"><input class="product-variant-weight min-w-0 flex-1 rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" step="0.01" value="${escapeHTML(productVariant.weight ?? "")}">
              <select class="product-variant-weight-unit rounded bg-gray-800 px-3 py-2 text-white">${compactSelectOptions(["g", "kg"], productVariant.weightUnit || "g")}</select></span>
              ${sourceNote(productVariant.weight !== null && productVariant.weight !== undefined ? "Variant override" : "Inherited from Item variant", "weight")}
            </label>
            <div class="rounded border border-gray-700 p-3 text-sm md:col-span-2 xl:col-span-4">
              <span class="font-medium text-white">Shipping dimensions</span>
              <div class="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                <label>Length<input class="product-variant-length mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" step="0.01" value="${escapeHTML(productVariant.length ?? "")}"></label>
                <label>Width<input class="product-variant-width mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" step="0.01" value="${escapeHTML(productVariant.width ?? "")}"></label>
                <label>Height<input class="product-variant-height mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" step="0.01" value="${escapeHTML(productVariant.height ?? "")}"></label>
                <label>Unit<select class="product-variant-dimension-unit mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">${compactSelectOptions(["mm", "cm", "m"], productVariant.dimensionUnit || "cm")}</select></label>
              </div>
            </div>
          </section>
          <section data-variant-editor-section="description" class="grid gap-3 rounded border border-[#407471] bg-gray-900/80 p-4 md:col-span-2 xl:col-span-4">
            <div>
              <h5 class="font-semibold text-white">Description overrides</h5>
              <p class="text-xs text-gray-400">Leave these blank to use the main Product descriptions.</p>
            </div>
            <label class="block text-sm">Variant short-description override
              <input class="product-variant-short-description mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
                value="${escapeHTML(productVariant.shortDescription || "")}" placeholder="Use the main Product description">
              ${sourceNote(productVariant.shortDescription ? "Variant override" : productShortDescription ? "Inherited from Product" : "Not configured", "shortDescription")}
            </label>
            <label class="block text-sm">Variant long-description override
              <textarea class="product-variant-long-description mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
                rows="4" placeholder="Use the main Product description">${escapeHTML(productVariant.longDescription || "")}</textarea>
              ${sourceNote(productVariant.longDescription ? "Variant override" : productLongDescription ? "Inherited from Product" : "Not configured", "longDescription")}
            </label>
            <div class="flex justify-end">
              <button type="button" data-close-variant-section
                class="rounded border border-[#407471] px-4 py-2 text-[#9edbd7]">Done</button>
            </div>
          </section>
          <section data-variant-editor-section="price" class="rounded border border-[#407471] bg-gray-900/80 p-4 md:col-span-2 xl:col-span-4">
            <h5 class="font-semibold text-white">Marketplace price</h5>
            <label class="mt-3 block text-sm">Variant price override
              <input class="product-variant-price mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
                type="number" min="0" step="0.01" value="${escapeHTML(productVariant.priceOverride ?? "")}" placeholder="Use main Product price">
              ${sourceNote(productVariant.priceOverride !== null && productVariant.priceOverride !== undefined ? "Variant override" : productPrice !== null ? "Inherited from Product" : "Not configured", "price")}
            </label>
          </section>
          <section data-variant-editor-section="purchase" class="flex min-w-0 flex-col gap-4 rounded border border-[#407471] bg-gray-900/80 p-4 md:col-span-2 xl:col-span-4">
          <div class="grid gap-3 rounded border border-gray-700 p-3 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <h6 class="font-semibold text-white">Inventory or tickets</h6>
              <p class="text-xs text-gray-400">Bundle inclusions can deduct only their exact Product stock or Workshop tickets. Entity stock remains separate.</p>
            </div>
          <label class="product-variant-stock-field block text-sm">Product stock
            <input class="product-variant-stock mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" step="1" value="${escapeHTML(productVariant.stock ?? 0)}">
            <span class="mt-1 block text-xs text-gray-400">Finished sellable stock. This is separate from the connected Item variant stock.</span>
          </label>
          <label class="product-variant-seats-field hidden block text-sm">Ticket / seat capacity
            <input class="product-variant-seat-capacity mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" step="1" value="${escapeHTML(productVariant.seatCapacity ?? "")}">
          </label>
          <label class="product-variant-seats-field hidden block text-sm">Near capacity warning
            <input class="product-variant-near-capacity-warning mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" step="1" value="${escapeHTML(productVariant.nearCapacityWarning ?? "")}" placeholder="Example: 10">
            <span class="mt-1 block text-xs text-gray-400">Show “Almost sold out” when this many seats or fewer remain.</span>
          </label>
          </div>
          <div class="grid gap-3 rounded border border-gray-700 p-3 md:grid-cols-2">
            <div class="md:col-span-2">
              <h6 class="font-semibold text-white">Delivery and booking</h6>
            </div>
          <label class="product-variant-calendar-field hidden block text-sm">Calendar / booking reference
            <input class="product-variant-calendar-reference mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(productVariant.calendarBookingReference || "")}" placeholder="Calendar ID, booking link or reference">
          </label>
          <label class="product-variant-delivery-field block text-sm">Delivery mode
            <select class="product-variant-delivery-mode mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
              <option value="">Select delivery mode</option>
              <option value="physical"${productVariant.deliveryMode === "physical" ? " selected" : ""}>Physical delivery</option>
              <option value="in-person"${productVariant.deliveryMode === "in-person" ? " selected" : ""}>In person</option>
              <option value="online-live"${productVariant.deliveryMode === "online-live" ? " selected" : ""}>Online live</option>
              <option value="online-self-paced"${productVariant.deliveryMode === "online-self-paced" ? " selected" : ""}>Online self-paced</option>
              <option value="hybrid"${productVariant.deliveryMode === "hybrid" ? " selected" : ""}>Hybrid</option>
              <option value="digital-download"${productVariant.deliveryMode === "digital-download" ? " selected" : ""}>Digital download</option>
            </select>
          </label>
          <label class="product-variant-physical-fulfilment-field hidden block text-sm">Physical fulfilment
            <select class="product-variant-physical-fulfilment mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
              ${compactSelectOptions(
    ["none", "shipping", "pickup", "shipping-or-pickup"],
    productVariant.physicalFulfilment || "none",
  )}
            </select>
          </label>
          <label class="product-variant-session-field hidden block text-sm">Session starts
            <input class="product-variant-event-start mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="datetime-local" value="${escapeHTML(productVariant.eventStartAt || "")}">
          </label>
          <label class="product-variant-session-field hidden block text-sm">Session ends
            <input class="product-variant-event-end mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="datetime-local" value="${escapeHTML(productVariant.eventEndAt || "")}">
          </label>
          <label class="product-variant-location-field hidden block text-sm md:col-span-2">Location
            <input class="product-variant-event-location mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(productVariant.eventLocation || "")}" placeholder="Venue, address or online location">
          </label>
          <label class="product-variant-instructor-field hidden block text-sm md:col-span-2">Instructor
            <select class="product-variant-instructor mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
              <option value="">Choose instructor</option>
              ${instructorOptions(productVariant.instructor || "") ||
                "<option value=\"\" disabled>No instructors saved</option>"}
            </select>
            ${sourceNote(productVariant.physicalFulfilment && productVariant.physicalFulfilment !== "inherit" ? "Variant override" : "Inherited from Product", "fulfilment")}
          </label>
          </div>
          <div class="rounded border border-gray-700 p-3">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h6 class="font-semibold text-white">Inclusions</h6>
                <p class="mt-1 text-xs text-gray-400">Select an exact Product variant when needed, set its quantity, and choose whether that Product stock or Workshop ticket allocation is deducted.</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button type="button" class="import-blueprint-inclusions rounded border border-blue-500 px-3 py-1 text-xs text-blue-200">Import from connected Blueprint</button>
                <button type="button" class="add-product-manual-inclusion rounded border border-gray-600 px-3 py-1 text-xs text-gray-200">Add unlinked inclusion</button>
              </div>
            </div>
            <div class="product-bundle-component-rows mt-3 space-y-2">${bundleComponentsMarkup(productVariant.bundleComponents || [])}</div>
            <div class="product-manual-inclusion-rows mt-2 space-y-2">${manualInclusionsMarkup(productVariant.manualInclusions, productVariant.inclusions)}</div>
            <div class="mt-3 flex justify-end"><button type="button" class="add-product-bundle-component rounded border border-[#407471] px-3 py-1 text-xs text-[#9edbd7]">Add or edit linked Products</button></div>
          </div>
          </section>
          <div data-variant-editor-section="visibility" class="rounded border border-gray-700 p-3 md:col-span-2 xl:col-span-4">
            <h5 class="font-semibold text-white">Marketplace visibility</h5>
            <div class="mt-3 grid gap-3 md:grid-cols-3">
              <label class="block text-sm">Variant visibility override
                <select class="product-variant-marketplace-mode mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
                  <option value="inherit"${!productVariant.marketplaceMode || productVariant.marketplaceMode === "inherit" ? " selected" : ""}>Use main Product setting</option>
                  <option value="active"${productVariant.marketplaceMode === "active" ? " selected" : ""}>Visible and available now</option>
                  <option value="scheduled"${productVariant.marketplaceMode === "scheduled" ? " selected" : ""}>Hidden until the start date</option>
                  <option value="coming-soon"${productVariant.marketplaceMode === "coming-soon" ? " selected" : ""}>Coming soon until the start date</option>
                  <option value="hidden"${productVariant.marketplaceMode === "hidden" ? " selected" : ""}>Hidden</option>
                </select>
                ${sourceNote(productVariant.marketplaceMode && productVariant.marketplaceMode !== "inherit" ? "Variant override" : `Inherited from Product (${productMarketplaceMode})`, "visibility")}
              </label>
              <label class="block text-sm">Start selling
                <input class="product-variant-marketplace-start mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
                  type="datetime-local" value="${escapeHTML(datetimeLocalValue(productVariant.marketplaceStartsAt))}">
              </label>
              <label class="block text-sm">Stop selling / hide
                <input class="product-variant-marketplace-end mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
                  type="datetime-local" value="${escapeHTML(datetimeLocalValue(productVariant.marketplaceEndsAt))}">
              </label>
            </div>
          </div>
          <div data-variant-editor-section="sale" class="rounded border border-gray-700 p-3 md:col-span-2 xl:col-span-4">
            <h5 class="font-semibold text-white">Sale</h5>
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <label class="product-variant-affiliate-pricing-field ${affiliateAvailable ? "" : "hidden"} block text-sm">Variant affiliate-price override
                <input class="product-variant-wholesale-price mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
                  type="number" min="0" step="0.01" value="${escapeHTML(productVariant.wholesalePrice ?? "")}">
                ${sourceNote(productVariant.wholesalePrice !== null && productVariant.wholesalePrice !== undefined ? "Variant override" : productAffiliatePrice !== null ? "Inherited from Product" : "Not configured", "affiliatePrice")}
              </label>
              <label class="product-variant-affiliate-pricing-field ${affiliateAvailable ? "" : "hidden"} block text-sm">Wholesale minimum quantity
                <input class="product-variant-wholesale-min-quantity mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
                  type="number" min="1" step="1" value="${escapeHTML(productVariant.wholesaleMinQuantity ?? "")}">
              </label>
              <label class="block text-sm md:col-span-2">Sale price
                <input class="product-variant-sale-price mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
                  type="number" min="0" step="0.01" value="${escapeHTML(productVariant.salePrice ?? "")}">
              </label>
              <label class="block text-sm">Sale starts
                <input class="product-variant-sale-start mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
                  type="datetime-local" value="${escapeHTML(datetimeLocalValue(productVariant.saleStartsAt))}">
              </label>
              <label class="block text-sm">Sale ends
                <input class="product-variant-sale-end mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
                  type="datetime-local" value="${escapeHTML(datetimeLocalValue(productVariant.saleEndsAt))}">
              </label>
            </div>
          </div>
          <div data-variant-editor-section="promotion" class="rounded border border-gray-700 p-3 md:col-span-2 xl:col-span-4">
            <h5 class="font-semibold text-white">Promotion videos</h5>
            <p class="mt-1 text-xs text-gray-400">Only Assets selected here are public. Linked Item, Blueprint and Plan material remains private.</p>
            <div class="mt-3">
              <label class="block text-sm">Choose an existing promotion video Asset
                <select class="product-variant-promotion-asset-picker mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
                  ${marketplaceAssetOptions([], "video", "Choose a video Asset")}
                </select>
              </label>
              <button type="button"
                class="add-existing-product-variant-promotion-asset mt-2 rounded border border-gray-600 px-3 py-1 text-xs text-gray-200 hover:border-[#407471]">
                Attach selected video
              </button>
              <select class="product-variant-promotion-assets hidden" multiple aria-hidden="true" tabindex="-1">
                ${marketplaceAssetOptions(productVariant.promotionAssetIds || [], "video")}
              </select>
              <div class="product-variant-promotion-selection mt-3 space-y-2">
                ${promotionSelectedAssetsMarkup(productVariant.promotionAssetIds || [])}
              </div>
              <button type="button"
                class="create-product-variant-promotion-asset mt-3 rounded border border-[#407471] px-3 py-1 text-xs text-[#9edbd7] hover:bg-[#153b38]"
                data-field-name="Promotion video" data-asset-type="Video">Add new video Asset</button>
            </div>
          </div>
          <div data-variant-editor-section="prerequisites" class="rounded border border-gray-700 p-3 md:col-span-2 xl:col-span-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h5 class="font-semibold text-white">Purchase prerequisites</h5>
                <p class="mt-1 text-xs text-gray-400">Choose an exact Product variant for automatic purchase/access checks, or an Item such as an external qualification for future manual verification.</p>
              </div>
            </div>
            <div class="product-prerequisite-rows mt-3 space-y-2">${prerequisiteRowsMarkup(productVariant.prerequisiteProductVariants || [], productVariant.variantId || "")}</div>
            <div class="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" class="choose-external-qualification rounded border border-[#407471] px-3 py-1 text-xs text-[#9edbd7]">Add or edit external qualifications</button>
              <button type="button" class="add-product-prerequisite rounded border border-[#407471] px-3 py-1 text-xs text-[#9edbd7]">Add or edit Product prerequisites</button>
            </div>
          </div>
          <div data-variant-editor-section="visibility" class="variant-editor-actions rounded border border-gray-700 p-3 md:col-span-2 xl:col-span-4">
            <h5 class="font-semibold text-white">Variant status and save</h5>
            <p class="mt-1 text-xs text-gray-400">Choose one status, then save this variant to return to its detail preview.</p>
            <select class="product-variant-status hidden" aria-hidden="true" tabindex="-1">
              ${compactSelectOptions(["draft", "review", "active", "paused", "archived"], productVariant.status || "draft")}
            </select>
            <div class="mt-3 flex flex-wrap items-center gap-4">
              ${["draft", "review", "active", "paused", "archived"].map((status) => `
                <label class="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm ${lifecycleStatusClasses(status)}">
                  <input type="checkbox" class="product-variant-status-checkbox accent-[#407471]"
                    data-product-variant-status="${status}"${(productVariant.status || "draft") === status ? " checked" : ""}>
                  ${status === "paused" ? "Paused / hidden" : status[0].toUpperCase() + status.slice(1)}
                </label>`).join("")}
              <button type="button" data-save-variant-editor class="rounded bg-[#407471] px-4 py-2 text-sm font-semibold text-white hover:bg-[#305a56]">Save variant</button>
            </div>
          </div>
        </div>
      </div>`;
  }).join("");
  container.querySelectorAll(
    ".product-prerequisite-product-selector, .product-prerequisite-item-selector",
  ).forEach(refreshLinkedTemplatePickerLabel);
  syncProductArchivedFromVariants(productVariants);
  const connections = document.getElementById("contentVariantOwnedConnections");
  if (connections && !productVariants.some((variant) =>
    variant.variantId === connections.dataset.activeProductVariantId)) {
    connections.dataset.activeProductVariantId = productVariants[0]?.variantId || "";
  }
  filterVariantOwnedConnections(connections?.dataset.activeProductVariantId || "");
  renderMarketplaceTileControls();
}

function syncSelectedProductVariantRows() {
  const input = document.getElementById("contentProductVariants");
  if (!input) return;
  const current = parseProductVariants(input.value);
  const variants = [...document.querySelectorAll(".content-product-variant-row")].map((row, index) => {
    const contentVariantSelection = row.querySelector(".product-variant-content-variant")?.value || "";
    const contentVariantId = contentVariantSelection === "__none__" ? "" : contentVariantSelection;
    const existingId = row.dataset.productVariantId || "";
    const existing = current.find((variant) =>
      variant.variantId === existingId ||
      contentVariantId && variant.contentVariantId === contentVariantId) || {};
    return {
      variantId: row.querySelector(".product-variant-id")?.value.trim() ||
        existingId || generatedProductVariantId(contentVariantId || `CUSTOM-${index + 1}`),
      name: row.querySelector(".product-variant-name")?.value.trim() || "Variant",
      colour: row.querySelector(".product-variant-colour")?.value.trim() || "",
      size: row.querySelector(".product-variant-size")?.value.trim() || "",
      weight: optionalNumberFromElement(row.querySelector(".product-variant-weight")),
      weightUnit: row.querySelector(".product-variant-weight-unit")?.value || "g",
      length: optionalNumberFromElement(row.querySelector(".product-variant-length")),
      width: optionalNumberFromElement(row.querySelector(".product-variant-width")),
      height: optionalNumberFromElement(row.querySelector(".product-variant-height")),
      dimensionUnit: row.querySelector(".product-variant-dimension-unit")?.value || "cm",
      sku: row.querySelector(".product-variant-sku")?.value.trim() || "",
      priceOverride: optionalNumberFromElement(row.querySelector(".product-variant-price")),
      marketplaceMode: row.querySelector(".product-variant-marketplace-mode")?.value || "inherit",
      marketplaceStartsAt: isoFromDatetimeLocal(
        row.querySelector(".product-variant-marketplace-start")?.value || "",
      ),
      marketplaceEndsAt: isoFromDatetimeLocal(
        row.querySelector(".product-variant-marketplace-end")?.value || "",
      ),
      salePrice: optionalNumberFromElement(row.querySelector(".product-variant-sale-price")),
      wholesalePrice: optionalNumberFromElement(row.querySelector(".product-variant-wholesale-price")),
      wholesaleMinQuantity: optionalNumberFromElement(
        row.querySelector(".product-variant-wholesale-min-quantity"),
      ) || 1,
      saleStartsAt: isoFromDatetimeLocal(row.querySelector(".product-variant-sale-start")?.value || ""),
      saleEndsAt: isoFromDatetimeLocal(row.querySelector(".product-variant-sale-end")?.value || ""),
      stock: optionalNumberFromElement(row.querySelector(".product-variant-stock")) ?? 0,
      status: row.dataset.pendingStatus ||
        row.querySelector(".product-variant-status")?.value || "draft",
      contentVariantId,
      contentVariantLinkReviewed: Boolean(contentVariantSelection),
      shortDescription: row.querySelector(".product-variant-short-description")?.value.trim() || "",
      longDescription: row.querySelector(".product-variant-long-description")?.value.trim() || "",
      inclusions: "",
      manualInclusions: [...row.querySelectorAll(".product-manual-inclusion-row")]
        .map((inclusionRow, inclusionIndex) => ({
          inclusionId: inclusionRow.dataset.inclusionId ||
            `INCLUSION-${existingId || index + 1}-${inclusionIndex + 1}`,
          name: inclusionRow.querySelector(".product-manual-inclusion-name")?.value.trim() || "",
          quantity: Math.max(Number(
            inclusionRow.querySelector(".product-manual-inclusion-quantity")?.value || 1,
          ), 1),
          sourceBlueprintId: inclusionRow.dataset.sourceBlueprintId || "",
          sourceComponentId: inclusionRow.dataset.sourceComponentId || "",
        })).filter((entry) => entry.name),
      deliveryMode: row.querySelector(".product-variant-delivery-mode")?.value || "",
      physicalFulfilment: row.querySelector(".product-variant-physical-fulfilment")?.value || "none",
      calendarBookingReference: row.querySelector(".product-variant-calendar-reference")?.value.trim() || "",
      seatCapacity: optionalNumberFromElement(row.querySelector(".product-variant-seat-capacity")),
      nearCapacityWarning: optionalNumberFromElement(
        row.querySelector(".product-variant-near-capacity-warning"),
      ),
      eventStartAt: row.querySelector(".product-variant-event-start")?.value || existing.eventStartAt || "",
      eventEndAt: row.querySelector(".product-variant-event-end")?.value || existing.eventEndAt || "",
      eventLocation: row.querySelector(".product-variant-event-location")?.value.trim() ||
        existing.eventLocation || "",
      instructor: row.querySelector(".product-variant-instructor")?.value || "",
      bundleComponents: [...row.querySelectorAll(".product-bundle-component-row")]
        .map((componentRow, componentIndex) => ({
          bundleComponentId: componentRow.dataset.bundleComponentId ||
            `BUNDLE-${existingId || index + 1}-${componentIndex + 1}`,
          componentProductId:
            componentRow.querySelector(".product-bundle-component-product")?.value || "",
          componentProductVariantId:
            componentRow.querySelector(".product-bundle-component-variant")?.value || "",
          inventoryAction: componentRow.querySelector(".product-bundle-component-deduct")?.checked
            ? "deduct" : "none",
          quantity: Math.max(Number(
            componentRow.querySelector(".product-bundle-component-quantity")?.value || 1,
          ), 1),
        })).filter((component) => component.componentProductId),
      primaryAssetId: row.querySelector(".product-variant-primary-asset")?.value || "",
      promotionAssetIds: [...(row.querySelector(".product-variant-promotion-assets")?.selectedOptions || [])]
        .map((option) => option.value).filter(Boolean),
      prerequisiteProductVariants: [...row.querySelectorAll(".product-prerequisite-row")]
        .map(prerequisiteFromRow).filter((entry) => entry && !isSelfProductPrerequisite(
          entry,
          existingId,
        )),
      purchaseSetupReviewed: row.dataset.purchaseSetupReviewed === "true",
    };
  });
  input.value = serializeProductVariants(variants);
  syncProductArchivedFromVariants(variants);
}

function addIndependentProductVariant() {
  syncSelectedProductVariantRows();
  const variants = currentProductVariants();
  const customId = generatedProductVariantId(`CUSTOM-${variants.length + 1}`);
  variants.push({
    variantId: customId,
    name: `Product variant ${variants.length + 1}`,
    status: "draft",
    contentVariantId: "",
    priceOverride: null,
    stock: 0,
  });
  setInputValue("contentProductVariants", serializeProductVariants(variants));
  renderSelectedProductVariantRows(variants);
  const newRow = document.querySelector(`.content-product-variant-row[data-product-variant-id="${CSS.escape(customId)}"]`);
  newRow?.scrollIntoView({ behavior: "smooth", block: "center" });
  updateProductPhysicalFields();
  state.isDirty = true;
}

function templateOptionLabel(template) {
  if (template?.templateName && template.templateName !== template.name) {
    return `${template.templateName} — ${template.name}`;
  }
  return template?.name || template?.id || "Template";
}

function selectedTemplate() {
  const recordType = document.getElementById("contentRecordType")?.value || "item";
  const templateId = document.getElementById("contentTemplate")?.value || "";
  return (state.options.templateDefinitions?.[recordType] || [])
    .find((template) => template.id === templateId);
}

function isAssetTemplateField(field) {
  return ["asset", "assets", "item asset", "item assets"]
    .includes(normalizedType(field?.linkedTable));
}

function selectedAssetTemplateFields() {
  return templateFields(selectedTemplate()).filter(isAssetTemplateField);
}

function assetMatchesTemplateField(asset, field) {
  const fieldName = normalizedType(field?.name);
  const fieldType = normalizedType(field?.fieldType);
  const assetType = normalizedType(asset?.assetType || asset?.type);
  if (fieldType === "image asset") return assetType === "image";
  if (fieldType === "video asset") return assetType === "video";
  if (fieldType === "pdf asset") return assetType === "pdf";
  if (fieldType === "canva design asset") return assetType === "canva design";
  if (fieldName.includes("image")) return assetType === "image";
  if (fieldName.includes("video")) return assetType === "video";
  if (fieldName.includes("document") || fieldName.includes("pdf")) {
    return ["document", "pdf"].includes(assetType);
  }
  return true;
}

function templateFieldValuesForRecord(record) {
  const values = { ...(record?.templateFieldValues || {}) };
  const fields = selectedAssetTemplateFields();
  const assets = Array.isArray(record?.assets) ? record.assets : [];
  if (!fields.length || !assets.length) return values;

  const assigned = new Set();
  fields.forEach((field) => {
    const key = templateFieldKey(field.key || field.id || field.name);
    const current = uniqueValues(Array.isArray(values[key]) ? values[key] : [values[key]]);
    values[key] = current;
    current.forEach((assetId) => assigned.add(assetId));
  });

  assets.forEach((asset) => {
    if (!asset.assetId || assigned.has(asset.assetId)) return;
    const field = fields.find((candidate) => {
      if (!assetMatchesTemplateField(asset, candidate)) return false;
      const key = templateFieldKey(candidate.key || candidate.id || candidate.name);
      const repeatable = candidate.repeatable === true ||
        candidate.allowUnlimited === true ||
        Number(candidate.maxEntries || 0) > 1;
      const maximum = candidate.allowUnlimited === true
        ? 0
        : Number(candidate.maxEntries || (repeatable ? 0 : 1));
      return maximum === 0 || values[key].length < maximum;
    });
    if (!field) return;
    const key = templateFieldKey(field.key || field.id || field.name);
    values[key].push(asset.assetId);
    assigned.add(asset.assetId);
  });
  return values;
}

function currentRecordType() {
  return document.getElementById("contentRecordType")?.value || "item";
}

function isProductManufactureBlueprint() {
  return currentRecordType() === "blueprint" &&
    normalizedType(document.getElementById("contentType")?.value) === "product manufacture";
}

function isShopProductSelected() {
  if ([...document.querySelectorAll(".variant-add-to-shop")].some((input) => input.checked)) return true;
  if ([...document.querySelectorAll(".variant-use-as-manufacturing")].some((input) => input.checked)) return true;
  if (currentRecordType() === "item") {
    const hasShopVariant = [...document.querySelectorAll(".content-entity-variant-template")].some((select) => {
      const template = templateDefinitions("item", document.getElementById("contentType")?.value)
        .find((candidate) => candidate.id === select.value);
      return template?.defaults?.isShopProduct === true;
    });
    if (hasShopVariant) return true;
  }
  return document.getElementById("contentIsShopProduct")?.checked === true;
}

function editingCollectionKey() {
  return state.editingRecord ? recordCollectionName(state.editingRecord.recordType) : "";
}

function findRecord(recordType, recordId) {
  const collection = recordCollectionName(singularRecordType(recordType));
  return (state.records[collection] || []).find((record) => record.id === recordId);
}

function updateBuilderStepLabels() {
  const labels = BUILDER_STEP_LABELS[currentRecordType()] || BUILDER_STEP_LABELS.item;
  document.querySelectorAll(".builder-step-btn").forEach((button) => {
    const index = Number(button.dataset.builderStep || 1) - 1;
    button.textContent = labels[index] || `Step ${index + 1}`;
  });
}

function panelAllowedForRecordType(panel) {
  const recordType = currentRecordType();
  if (!fieldGroupAllowed(panel)) return false;
  if (panel.id === "itemSpecificFields") return recordType === "item";
  if (panel.id === "advancedContentFields") return recordType !== "item";
  if (panel.id === "contentRelationshipReview") return true;
  if (panel.id === "contentReviewPublishPanel") return true;
  if (panel.id === "contentDuplicateWarning") return state.duplicateWarningActive === true;
  return true;
}

function persistContentBuilderCreationStack() {
  try {
    if (contentBuilderCreationStack.length) {
      sessionStorage.setItem(
        CONTENT_BUILDER_STACK_KEY,
        JSON.stringify(contentBuilderCreationStack),
      );
    } else {
      sessionStorage.removeItem(CONTENT_BUILDER_STACK_KEY);
    }
  } catch (error) {
    console.warn("Could not persist the nested Content Builder stack:", error);
  }
}

function restorePersistedContentBuilderCreationStack() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(CONTENT_BUILDER_STACK_KEY) || "[]");
    contentBuilderCreationStack = Array.isArray(stored) ? stored : [];
  } catch {
    contentBuilderCreationStack = [];
    sessionStorage.removeItem(CONTENT_BUILDER_STACK_KEY);
  }
}

function resetContentBuilderCreationStack() {
  contentBuilderCreationStack = [];
  persistContentBuilderCreationStack();
  updateContentBuilderCreationBreadcrumb();
}

function updateContentBuilderCreationBreadcrumb() {
  const breadcrumb = document.getElementById("contentEntityCreationBreadcrumb");
  const returnButton = document.getElementById("returnToParentEntityBtn");
  const closeButton = document.getElementById("closeContentEntityEditorDrawerBtn");
  const labels = contentBuilderCreationStack.map((entry) => entry.parentName || "Parent");
  const current = document.getElementById("contentName")?.value ||
    `New ${currentRecordType()}`;
  if (breadcrumb) {
    breadcrumb.textContent = [...labels, current].join(" → ");
    breadcrumb.classList.toggle("hidden", !contentBuilderCreationStack.length);
  }
  // Nested creation has one clear exit: the normal Close control becomes a
  // one-level Back action. This prevents it from bypassing the saved parent
  // draft and leaving the child route over an empty Connections workspace.
  returnButton?.classList.add("hidden");
  if (closeButton) {
    const parentName = contentBuilderCreationStack.at(-1)?.parentName || "previous content";
    closeButton.textContent = contentBuilderCreationStack.length
      ? `Back to ${parentName}`
      : "Close";
  }
}

async function closeOrReturnFromContentCreator() {
  if (contentBuilderCreationStack.length) {
    await restoreNestedParent({ cancelled: true });
    return;
  }
  setContentEntityEditorDrawerOpen(false);
  if (state.editingRecord?.id) showBuilderStep(4);
}

function setContentEntityEditorDrawerOpen(open) {
  const drawer = document.getElementById("contentEntityEditorDrawer");
  if (!drawer) return;
  if (open && drawer.parentElement !== document.body) document.body.appendChild(drawer);
  drawer.classList.toggle("hidden", !open);
  drawer.setAttribute("aria-hidden", String(!open));
  drawer.inert = !open;
  const title = document.getElementById("contentEntityEditorDrawerTitle");
  if (title) title.textContent = state.editingRecord?.id
    ? `Edit ${state.editingRecord.name || "entity"}`
    : "Create new entity";
  updateContentBuilderCreationBreadcrumb();
}

function updateConnectionsWorkspaceAvailability() {
  const host = document.getElementById("contentConnectionsMain");
  if (!host) return;
  let empty = document.getElementById("contentConnectionsEmptyState");
  if (!empty) {
    empty = document.createElement("div");
    empty.id = "contentConnectionsEmptyState";
    empty.className = "rounded border border-dashed border-gray-700 p-8 text-center text-sm text-gray-400";
    empty.textContent = "Create and save the entity to begin adding connections.";
    host.prepend(empty);
  }
  empty.classList.toggle("hidden", Boolean(state.editingRecord?.id));
  host.querySelectorAll(".builder-step-panel[data-builder-panel=\"4\"]").forEach((panel) => {
    panel.classList.toggle("hidden", !state.editingRecord?.id || !panelAllowedForRecordType(panel));
  });
  const button = document.getElementById("openContentEntityEditorDrawerBtn");
  if (button) button.textContent = state.editingRecord?.id ? "Edit content" : "Create content";
}

function initializeContentBuilderWorkspace() {
  const host = document.getElementById("contentConnectionsMain");
  if (!host || host.dataset.initialized === "true") return;
  host.dataset.initialized = "true";
  document.querySelectorAll(".builder-step-panel[data-builder-panel=\"4\"]").forEach((panel) => {
    host.appendChild(panel);
  });
  updateConnectionsWorkspaceAvailability();
}

function showBuilderStep(step = state.currentStep) {
  const nextStep = Math.max(1, Math.min(Number(step || 1), 4));
  state.currentStep = nextStep;
  if (nextStep >= 2 && document.querySelector(".content-entity-variant-row")) {
    renderVariantStepRows(entityVariantsFromBuilder());
  }

  document.querySelectorAll(".builder-step-btn").forEach((button) => {
    const active = Number(button.dataset.builderStep || 1) === nextStep;
    button.classList.toggle("bg-[#407471]", active);
    button.classList.toggle("bg-gray-700", !active);
  });

  document.querySelectorAll(".builder-step-panel").forEach((panel) => {
    const panelStep = Number(panel.dataset.builderPanel || 1);
    if (panelStep === 4) {
      panel.classList.toggle("hidden", !state.editingRecord?.id || !panelAllowedForRecordType(panel));
      return;
    }
    panel.classList.toggle("hidden", panelStep !== nextStep || !panelAllowedForRecordType(panel));
  });
  if (nextStep >= 3) renderBuilderSummaries();

  const backBtn = document.getElementById("builderBackStepBtn");
  const nextBtn = document.getElementById("builderNextStepBtn");
  if (backBtn) backBtn.disabled = nextStep === 1;
  if (nextBtn) {
    const unsavedReview = nextStep === 3 && !state.editingRecord?.id;
    nextBtn.classList.toggle("hidden", nextStep === 4 || unsavedReview);
  }
  updateConnectionsWorkspaceAvailability();
}

function setupBuilderStepControls() {
  document.querySelectorAll(".builder-step-btn").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      await navigateBuilderStep(Number(button.dataset.builderStep || 1));
    });
  });

  document.getElementById("builderBackStepBtn")?.addEventListener("click", async () => {
    await navigateBuilderStep(state.currentStep - 1);
  });

  document.getElementById("builderNextStepBtn")?.addEventListener("click", async () => {
    await navigateBuilderStep(state.currentStep + 1);
  });

  const addConnectionsButton = document.getElementById("contentBuilderAddConnectionsBtn");
  if (addConnectionsButton && addConnectionsButton.dataset.bound !== "true") {
    addConnectionsButton.dataset.bound = "true";
    addConnectionsButton.addEventListener("click", () => {
      const confirmation = document.getElementById("contentBuilderConfirmation");
      confirmation?.classList.add("hidden");
      confirmation?.classList.remove("flex");
      document.getElementById("contentBuilderForm")?.classList.remove("hidden");
      showBuilderStep(4);
      document.getElementById("contentBuilderStepBar")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  document.getElementById("contentBuilderForm")?.addEventListener("input", (event) => {
    state.isDirty = true;
    if (event.target.closest([
      "#contentReviewEntityStatus",
      ".content-entity-variant-status",
      ".content-product-status-checkbox",
      ".product-variant-status-checkbox",
    ].join(", "))) {
      return;
    }
    renderBuilderSummaries();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.isDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function navigateBuilderStep(targetStep) {
  const nextStep = Math.max(1, Math.min(Number(targetStep || 1), 4));
  if (nextStep === 4 && !state.editingRecord?.id) {
    showToast("Review and save this content before adding connections.", "error");
    showBuilderStep(3);
    return;
  }
  setContentEntityEditorDrawerOpen(nextStep < 4);
  showBuilderStep(nextStep);
}

async function openEntityVariantEditor(variantId, fieldKey = "") {
  await navigateBuilderStep(2);
  if (!variantId) return;
  const row = document.querySelector(
    `.content-entity-variant-row[data-entity-variant-id="${CSS.escape(variantId)}"]`,
  );
  if (!row) return;
  document.querySelectorAll(".content-entity-variant-row").forEach((candidate) => {
    candidate.open = candidate === row;
  });
  const field = fieldKey
    ? row.querySelector(`.content-template-linked-field[data-field-key="${CSS.escape(fieldKey)}"]`)
    : null;
  const target = field || row;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  (field?.querySelector(".open-content-linked-selector") ||
    row.querySelector("input, select, textarea, button"))?.focus({ preventScroll: true });
}

async function openEntityStatusEditor(variantId = "") {
  await navigateBuilderStep(3);
  if (!variantId) {
    const entityStatus = document.getElementById("contentReviewEntityStatus");
    entityStatus?.scrollIntoView({ behavior: "smooth", block: "center" });
    entityStatus?.focus({ preventScroll: true });
    return;
  }
  const reviewRow = document.querySelector(
    `.content-variant-review-row[data-entity-variant-id="${CSS.escape(variantId)}"]`,
  );
  if (!reviewRow) return;
  reviewRow.open = true;
  const status = reviewRow.querySelector(".content-entity-variant-status");
  reviewRow.scrollIntoView({ behavior: "smooth", block: "center" });
  status?.focus({ preventScroll: true });
}

function templateInput(id) {
  return document.getElementById(id)?.value || "";
}

function templateFieldKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function normalizedTemplateFieldType(value) {
  const fieldType = normalizedType(value).replace(/[_-]+/g, " ");
  if (["image asset", "video asset", "pdf asset", "canva design asset", "asset"].includes(fieldType)) {
    return "linked";
  }
  if (fieldType.includes("linked") || fieldType.includes("reference")) return "linked";
  if (["textarea", "long text", "rich text", "instructions"].includes(fieldType)) return "textarea";
  if (["number", "numeric", "integer", "decimal"].includes(fieldType)) return "number";
  if (["checkbox", "boolean", "yes no", "yes/no"].includes(fieldType)) return "checkbox";
  if (["date"].includes(fieldType)) return "date";
  if (["select", "dropdown", "choice", "option"].includes(fieldType)) return "select";
  return "text";
}

function canonicalTemplateFieldType(value) {
  const fieldType = normalizedType(value).replace(/[_-]+/g, " ");
  const canonicalTypes = {
    "short text": "Short Text",
    text: "Short Text",
    "long text": "Long Text",
    textarea: "Long Text",
    number: "Number",
    numeric: "Number",
    boolean: "Boolean",
    checkbox: "Boolean",
    date: "Date",
    "linked item list": "Linked Item List",
    "linked blueprint list": "Linked Blueprint List",
    "linked plan list": "Linked Plan List",
    "linked product list": "Linked Product List",
    "image asset": "Image Asset",
    "video asset": "Video Asset",
    "pdf asset": "PDF Asset",
    "canva design asset": "Canva Design Asset",
    asset: "Asset",
    select: "Dropdown",
    dropdown: "Dropdown",
  };
  return canonicalTypes[fieldType] || "Short Text";
}

function templateFields(template = selectedTemplate()) {
  return Array.isArray(template?.defaults?.fields)
    ? [...template.defaults.fields].sort((left, right) =>
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
    : [];
}

function templateFieldOptions(field) {
  if (Array.isArray(field?.options)) return uniqueValues(field.options);
  return uniqueValues(String(field?.options || "").split(/[\n,]/));
}

function linkedTemplateFieldRecords(field) {
  const linkedTable = normalizedType(field?.linkedTable);
  if (linkedTable === "items") return state.records.items || [];
  if (linkedTable === "blueprints") return state.records.blueprints || [];
  if (linkedTable === "plans") return state.records.plans || [];
  if (["product", "products"].includes(linkedTable)) return state.records.products || [];
  if (["asset", "assets", "item asset", "item assets"].includes(linkedTable)) {
    const requestedType = {
      "image asset": "image",
      "video asset": "video",
      "pdf asset": "pdf",
      "canva design asset": "canva design",
    }[normalizedType(field?.fieldType)];
    return (state.records.assets || []).filter((asset) => {
      if (!requestedType) return true;
      return normalizedType(asset.assetType || asset.type) === requestedType;
    });
  }
  if (["tag", "tags"].includes(linkedTable)) return state.options.tagOptions || [];
  if (["category", "categories"].includes(linkedTable)) return state.options.categoryOptions || [];
  return [];
}

function linkedTemplateRecordLabel(record) {
  const details = [record?.type, record?.status].filter(Boolean).join(" · ");
  return `${record?.name || record?.id}${details ? ` (${details})` : ""} | ${record?.id}`;
}

function supportsExactLinkedVariant(linkedTable) {
  return ["items", "blueprints", "plans"].includes(normalizedType(linkedTable));
}

function linkedSelectionEntityId(value) {
  return value && typeof value === "object"
    ? String(value.entityId || value.id || "") : String(value || "");
}

function linkedSelectionVariantId(value) {
  return value && typeof value === "object"
    ? String(value.entityVariantId || value.variantId || "") : "";
}

function refreshLinkedVariantSelect(select, selectedVariantId = "") {
  const variantSelect = select?.closest(".content-template-linked-picker")
    ?.querySelector(".content-template-linked-variant");
  if (!variantSelect) return;
  const record = linkedTemplateFieldRecords({ linkedTable: select.dataset.linkedTable })
    .find((candidate) => candidate.id === select.value);
  const variants = Array.isArray(record?.entityVariants) ? record.entityVariants : [];
  variantSelect.innerHTML = `<option value="">Any variant / whole entity</option>${variants.map((variant) => `
    <option value="${escapeHTML(variant.entityVariantId || variant.id)}">${escapeHTML(variant.name || variant.entityVariantId || variant.id)}</option>
  `).join("")}`;
  variantSelect.value = selectedVariantId;
  variantSelect.classList.toggle("hidden", !select.value || !variants.length);
}

function linkedTemplateSelectMarkup(field, key, required = false) {
  const records = linkedTemplateFieldRecords(field);
  const selectedType = field.linkedTypeFilter || "";
  const selectedStatus = field.linkedStatusFilter || "";
  const selectedTags = uniqueValues(Array.isArray(field.linkedTagFilters)
    ? field.linkedTagFilters : String(field.linkedTagFilters || "").split(","));
  return `
    <span class="content-template-linked-picker grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
      <select
        class="content-template-variable content-template-linked-select hidden"
        data-field-key="${escapeHTML(key)}"
        data-field-name="${escapeHTML(field.name || "Linked content")}"
        data-field-type="linked"
        data-linked-table="${escapeHTML(field.linkedTable || "")}"
        data-linked-type-filter="${escapeHTML(selectedType)}"
        data-linked-status-filter="${escapeHTML(selectedStatus)}"
        data-linked-tag-filters="${escapeHTML(selectedTags.join(","))}"
        data-selector-multiple="${Number(field.maxEntries || 0) === 1 ? "false" : "true"}"
        data-allow-record-reuse="${supportsExactLinkedVariant(field.linkedTable) ? "true" : "false"}"
        data-relationship-label="${escapeHTML(field.name || "Linked content")} for"
        data-repeatable="false"
        data-required="${required ? "true" : "false"}"
      >
        <option value="">Choose a record</option>
        ${records.map((record) => `
          <option value="${escapeHTML(record.id)}">
            ${escapeHTML(linkedTemplateRecordLabel(record))}
          </option>
        `).join("")}
      </select>
      <button type="button" class="open-content-linked-selector min-w-0 flex-1 rounded border border-[#407471] bg-gray-800 px-3 py-2 text-left text-white hover:bg-gray-700">Choose ${escapeHTML(field.name || "content")}</button>
      ${supportsExactLinkedVariant(field.linkedTable) ? `
        <select class="content-template-linked-variant hidden rounded border border-[#407471] bg-gray-800 px-3 py-2 text-white" aria-label="Choose an exact variant">
          <option value="">Any variant / whole entity</option>
        </select>
      ` : ""}
    </span>
  `;
}

function refreshLinkedTemplatePickerLabel(select) {
  const picker = select?.closest(".content-template-linked-picker");
  const button = picker
    ?.querySelector(".open-content-linked-selector");
  if (!button) return;
  const record = linkedTemplateFieldRecords({ linkedTable: select.dataset.linkedTable })
    .find((candidate) => candidate.id === select.value);
  button.textContent = record
    ? linkedTemplateRecordLabel(record)
    : `Choose ${select.dataset.fieldName || "content"}`;
  button.classList.toggle("text-gray-400", !record);
  const editButton = picker?.querySelector(".edit-selected-linked-record");
  if (editButton) {
    editButton.disabled = !record;
    editButton.classList.toggle("opacity-50", !record);
    editButton.classList.toggle("cursor-not-allowed", !record);
  }
  refreshLinkedVariantSelect(select, picker
    ?.querySelector(".content-template-linked-variant")?.value || "");
}

function linkedTemplateRowMarkup(field, key, required = false) {
  return `
    <div class="content-template-linked-row flex items-center gap-2">
      ${linkedTemplateSelectMarkup(field, key, required)}
      <button
        type="button"
        class="remove-content-template-entry rounded border border-red-800 px-3 py-2 text-xs
          text-red-200 hover:bg-red-950/50"
      >
        Remove
      </button>
    </div>
  `;
}

function renderRepeatableLinkedTemplateField(field, key, name, required) {
  const minimum = Math.max(Number(field.minEntries || 0), required ? 1 : 0);
  const maximum = field.allowUnlimited === true ? 0 : Number(field.maxEntries || 0);
  const initialRows = Math.max(minimum, 1);
  const limitText = field.allowUnlimited === true
    ? `Minimum ${minimum}; no maximum`
    : maximum > 0
      ? `Minimum ${minimum}; maximum ${maximum}`
      : `Minimum ${minimum}`;
  return `
    <div
      class="content-template-linked-field"
      data-field-key="${escapeHTML(key)}"
      data-field-name="${escapeHTML(name)}"
      data-min-entries="${minimum}"
      data-max-entries="${maximum > 0 ? maximum : ""}"
      data-allow-unlimited="${field.allowUnlimited === true ? "true" : "false"}"
      data-asset-type="${escapeHTML(assetTypeForTemplateField(field))}"
    >
      <div class="content-template-linked-rows space-y-2">
        ${Array.from({ length: initialRows }, () =>
    linkedTemplateRowMarkup(field, key, false)).join("")}
      </div>
      <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span class="content-template-entry-limit text-xs text-gray-400">${escapeHTML(limitText)}</span>
        <button
          type="button"
          class="add-content-template-entry rounded border border-[#407471] px-3 py-1 text-xs
            text-[#9edbd7] hover:bg-[#153b38]"
        >
          Add another
        </button>
        ${assetTypeForTemplateField(field) ? `
          <button type="button" class="create-content-template-asset rounded border border-[#407471]
            px-3 py-1 text-xs text-[#9edbd7] hover:bg-[#153b38]">Add new asset</button>
        ` : ""}
      </div>
    </div>
  `;
}

function assetTypeForTemplateField(field) {
  return {
    "image asset": "Image",
    "video asset": "Video",
    "pdf asset": "PDF",
    "canva design asset": "Canva Design",
    asset: "Document",
  }[normalizedType(field?.fieldType)] || "";
}

function renderTemplateCustomFields(template) {
  const fields = templateFields(template);
  if (!fields.length) return "";

  const controls = fields.map((field, index) => {
    const name = field.name || `Field ${index + 1}`;
    const key = templateFieldKey(field.key || field.id || name) || `field_${index + 1}`;
    const fieldType = normalizedTemplateFieldType(field.fieldType);
    const maxEntries = Number(field.maxEntries);
    const repeatable = field.repeatable === true || field.allowUnlimited === true || maxEntries > 1;
    const required = field.required === true;
    const notes = field.notes || "";
    const commonAttributes = `
      class="content-template-variable mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
      data-field-key="${escapeHTML(key)}"
      data-field-type="${escapeHTML(fieldType)}"
      data-repeatable="${repeatable ? "true" : "false"}"
      data-min-entries="${field.minEntries ?? ""}"
      data-max-entries="${field.allowUnlimited ? "" : field.maxEntries ?? ""}"
      ${required ? "required" : ""}
    `;

    let control;
    if (fieldType === "linked") {
      control = renderRepeatableLinkedTemplateField({
        ...field,
        minEntries: field.minEntries ?? (required ? 1 : 0),
        maxEntries: repeatable ? field.maxEntries : 1,
        allowUnlimited: repeatable && field.allowUnlimited === true,
      }, key, name, required);
    } else if (repeatable) {
      control = `
        <textarea
          ${commonAttributes}
          rows="3"
          placeholder="Enter one value per line"
        ></textarea>
      `;
    } else if (fieldType === "textarea") {
      control = `<textarea ${commonAttributes} rows="4"></textarea>`;
    } else if (fieldType === "select") {
      const options = templateFieldOptions(field);
      control = `
        <select ${commonAttributes}>
          <option value="">Choose an option</option>
          ${options.map((option) =>
    `<option value="${escapeHTML(option)}">${escapeHTML(option)}</option>`).join("")}
        </select>
      `;
    } else if (fieldType === "checkbox") {
      control = `
        <input
          type="checkbox"
          class="content-template-variable mt-1 accent-[#407471]"
          data-field-key="${escapeHTML(key)}"
          data-field-type="${escapeHTML(fieldType)}"
          data-repeatable="false"
        >
      `;
    } else {
      control = `<input type="${fieldType}" ${commonAttributes}>`;
    }

    return `
      <label class="block">
        <span>${escapeHTML(name)}${required ? " *" : ""}</span>
        ${control}
        ${notes ? `<span class="mt-1 block text-xs text-gray-400">${escapeHTML(notes)}</span>` : ""}
      </label>
    `;
  }).join("");

  return `
    <section class="mt-4 rounded border border-gray-700 bg-gray-950/40 p-3">
      <p class="mt-1 text-xs text-gray-400">These fields are specific to the selected template.</p>
      <div class="mt-3 grid gap-3">${controls}</div>
    </section>
  `;
}

function templateFieldValuesFromBuilder({ validate = false, root = document } = {}) {
  const values = {};
  const linkedKeys = new Set();
  root.querySelectorAll(".content-template-linked-field").forEach((field) => {
    const key = templateFieldKey(field.dataset.fieldKey);
    if (!key) return;
    linkedKeys.add(key);
    const selected = [...field.querySelectorAll(".content-template-linked-select")]
      .map((input) => {
        if (!input.value) return null;
        const variantId = input.closest(".content-template-linked-picker")
          ?.querySelector(".content-template-linked-variant")?.value || "";
        return supportsExactLinkedVariant(input.dataset.linkedTable)
          ? { entityId: input.value, entityVariantId: variantId }
          : input.value;
      }).filter(Boolean);
    const minimum = Number(field.dataset.minEntries || 0);
    const maximum = Number(field.dataset.maxEntries || 0);
    const fieldName = field.dataset.fieldName || key;
    if (validate && selected.length < minimum) {
      throw new Error(`${fieldName} needs at least ${minimum} entr${minimum === 1 ? "y" : "ies"}.`);
    }
    if (validate && maximum > 0 && selected.length > maximum) {
      throw new Error(`${fieldName} allows up to ${maximum} entr${maximum === 1 ? "y" : "ies"}.`);
    }
    values[key] = selected;
  });

  root.querySelectorAll(".content-template-variable").forEach((input) => {
    const key = templateFieldKey(input.dataset.fieldKey);
    if (!key || linkedKeys.has(key)) return;
    if (input instanceof HTMLSelectElement && input.multiple) {
      const selected = [...input.selectedOptions].map((option) => option.value);
      const minimum = Number(input.dataset.minEntries || 0);
      const maximum = Number(input.dataset.maxEntries || 0);
      const fieldName = input.closest("label")?.querySelector("span")?.textContent?.replace(/\s*\*$/, "") || key;
      if (validate && minimum > 0 && selected.length < minimum) {
        throw new Error(`${fieldName} needs at least ${minimum} entr${minimum === 1 ? "y" : "ies"}.`);
      }
      if (validate && maximum > 0 && selected.length > maximum) {
        throw new Error(`${fieldName} allows up to ${maximum} entr${maximum === 1 ? "y" : "ies"}.`);
      }
      values[key] = selected;
      return;
    }
    if (input.dataset.repeatable === "true") {
      values[key] = uniqueValues(String(input.value || "").split("\n"));
      return;
    }
    if (input.dataset.fieldType === "checkbox") {
      values[key] = input.checked === true;
      return;
    }
    if (input.dataset.fieldType === "number") {
      values[key] = input.value === "" ? null : Number(input.value);
      return;
    }
    values[key] = input.value || "";
  });
  return values;
}

function restoreTemplateFieldValuesInRoot(root, fieldValues = {}) {
  if (!root) return;
  root.querySelectorAll(".content-template-linked-field").forEach((field) => {
    const key = templateFieldKey(field.dataset.fieldKey);
    if (!key || fieldValues[key] === undefined) refreshLinkedTemplateField(field);
    else restoreLinkedTemplateField(field, fieldValues[key]);
  });
  root.querySelectorAll(".content-template-variable").forEach((input) => {
    const key = templateFieldKey(input.dataset.fieldKey);
    if (!key || input.closest(".content-template-linked-field") || fieldValues[key] === undefined) return;
    const value = fieldValues[key];
    if (input instanceof HTMLSelectElement && input.multiple) {
      const selectedValues = new Set(Array.isArray(value) ? value : [value]);
      [...input.options].forEach((option) => { option.selected = selectedValues.has(option.value); });
    } else if (input.dataset.fieldType === "checkbox") input.checked = value === true;
    else if (input.dataset.repeatable === "true" && Array.isArray(value)) input.value = value.join("\n");
    else input.value = value ?? "";
    if (input.classList.contains("content-template-linked-select")) {
      refreshLinkedTemplatePickerLabel(input);
    }
  });
}

function captureTemplateGuidedValues() {
  return {
    durationMinutes: templateInput("contentDurationMinutes"),
    sizeLabel: templateInput("contentSizeLabel"),
    startDate: templateInput("contentStartDate"),
    endDate: templateInput("contentEndDate"),
    warmupBlueprintIds: templateInput("contentWarmupBlueprintIds"),
    mainBlueprintIds: templateInput("contentMainBlueprintIds"),
    cooldownBlueprintIds: templateInput("contentCooldownBlueprintIds"),
    templateFieldValues: templateFieldValuesFromBuilder(),
  };
}

function restoreTemplateGuidedValues(values = {}) {
  setInputValue("contentDurationMinutes", values.durationMinutes);
  setInputValue("contentSizeLabel", values.sizeLabel);
  setInputValue("contentStartDate", values.startDate);
  setInputValue("contentEndDate", values.endDate);
  setInputValue("contentWarmupBlueprintIds", values.warmupBlueprintIds);
  setInputValue("contentMainBlueprintIds", values.mainBlueprintIds);
  setInputValue("contentCooldownBlueprintIds", values.cooldownBlueprintIds);

  const fieldValues = values.templateFieldValues || {};
  document.querySelectorAll(".content-template-linked-field").forEach((field) => {
    const key = templateFieldKey(field.dataset.fieldKey);
    if (!key || fieldValues[key] === undefined) {
      refreshLinkedTemplateField(field);
      return;
    }
    restoreLinkedTemplateField(field, fieldValues[key]);
  });
  document.querySelectorAll(".content-template-variable").forEach((input) => {
    const key = templateFieldKey(input.dataset.fieldKey);
    if (!key || input.closest(".content-template-linked-field") || fieldValues[key] === undefined) return;
    const value = fieldValues[key];
    if (input instanceof HTMLSelectElement && input.multiple) {
      const selectedValues = new Set(Array.isArray(value) ? value : [value]);
      [...input.options].forEach((option) => {
        option.selected = selectedValues.has(option.value);
      });
    } else if (input.dataset.fieldType === "checkbox") {
      input.checked = value === true;
    } else if (input.dataset.repeatable === "true" && Array.isArray(value)) {
      input.value = value.join("\n");
    } else {
      input.value = value ?? "";
    }
  });
}

function refreshLinkedTemplateField(field) {
  const rows = [...field.querySelectorAll(".content-template-linked-row")];
  const minimum = Math.max(Number(field.dataset.minEntries || 0), 0);
  const maximum = Number(field.dataset.maxEntries || 0);
  const selected = new Set(rows.map((row) =>
    row.querySelector(".content-template-linked-select")?.value).filter(Boolean));

  rows.forEach((row) => {
    const select = row.querySelector(".content-template-linked-select");
    const remove = row.querySelector(".remove-content-template-entry");
    [...(select?.options || [])].forEach((option) => {
      option.disabled = !!option.value && selected.has(option.value) && option.value !== select.value;
    });
    if (remove) remove.classList.toggle("hidden", rows.length <= Math.max(minimum, 1));
    refreshLinkedTemplatePickerLabel(select);
  });

  const add = field.querySelector(".add-content-template-entry");
  if (add) add.classList.toggle("hidden", maximum > 0 && rows.length >= maximum);
}

function addLinkedTemplateFieldRow(field, value = "", ignoreMaximum = false) {
  const rows = field.querySelector(".content-template-linked-rows");
  const source = rows?.querySelector(".content-template-linked-row");
  const maximum = Number(field.dataset.maxEntries || 0);
  if (
    !rows ||
    !source ||
    (!ignoreMaximum && maximum > 0 && rows.children.length >= maximum)
  ) return null;
  const row = source.cloneNode(true);
  const select = row.querySelector(".content-template-linked-select");
  const entityId = linkedSelectionEntityId(value);
  if (select) {
    [...select.options].forEach((option) => {
      option.disabled = false;
      option.selected = option.value === entityId;
    });
    if (entityId && select.value !== entityId) select.add(new Option(entityId, entityId, true, true));
    refreshLinkedTemplatePickerLabel(select);
    refreshLinkedVariantSelect(select, linkedSelectionVariantId(value));
  }
  rows.appendChild(row);
  refreshLinkedTemplateField(field);
  return row;
}

function restoreLinkedTemplateField(field, rawValues) {
  const values = (Array.isArray(rawValues) ? rawValues : [rawValues])
    .filter((value) => linkedSelectionEntityId(value));
  const minimum = Math.max(Number(field.dataset.minEntries || 0), 0);
  const desiredRows = Math.max(values.length, minimum, 1);
  const rows = field.querySelector(".content-template-linked-rows");
  if (!rows) return;
  while (rows.children.length < desiredRows) addLinkedTemplateFieldRow(field, "", true);
  while (rows.children.length > desiredRows) rows.lastElementChild?.remove();
  [...rows.querySelectorAll(".content-template-linked-select")].forEach((select, index) => {
    const value = values[index] || "";
    const entityId = linkedSelectionEntityId(value);
    if (entityId && ![...select.options].some((option) => option.value === entityId)) {
      select.add(new Option(entityId, entityId));
    }
    select.value = entityId;
    refreshLinkedTemplatePickerLabel(select);
    refreshLinkedVariantSelect(select, linkedSelectionVariantId(value));
  });
  refreshLinkedTemplateField(field);
}

function closeLinkedRecordSelector() {
  const modal = document.getElementById("contentLinkedRecordSelectorModal");
  const cleanup = linkedRecordSelectorContext?.cleanup;
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
  modal?.setAttribute("aria-hidden", "true");
  linkedRecordSelectorContext?.trigger?.focus();
  linkedRecordSelectorContext = null;
  cleanup?.();
}

function linkedSelectorRecords(context = linkedRecordSelectorContext) {
  if (!context?.select) return [];
  const records = linkedTemplateFieldRecords({ linkedTable: context.select.dataset.linkedTable });
  if (normalizedText(context.select.dataset.linkedTable) !== "products") return records;
  const productId = currentProductId();
  if (!productId) return records;
  const current = {
    id: productId,
    name: document.getElementById("contentName")?.value || productId,
    recordType: "product",
    productType: document.getElementById("contentProductDeliveryType")?.value || "",
    status: currentProductEditorStatus(),
    variants: currentProductVariants(),
  };
  const merged = [...records];
  const index = merged.findIndex((record) => record.id === productId);
  if (index >= 0) merged[index] = { ...merged[index], ...current };
  else merged.push(current);
  return merged;
}

function linkedSelectorRecordVariants(record = {}, context = linkedRecordSelectorContext) {
  const productCollection = normalizedText(context?.select?.dataset.linkedTable) === "products";
  if (productCollection) {
    return Array.isArray(record.variants) && record.variants.length
      ? record.variants
      : Array.isArray(record.entityVariants) ? record.entityVariants : [];
  }
  return Array.isArray(record.entityVariants) && record.entityVariants.length
    ? record.entityVariants
    : Array.isArray(record.variants) ? record.variants : [];
}

function linkedSelectorVariantId(variant = {}) {
  return variant.productVariantId || variant.variantId || variant.entityVariantId || variant.id || "";
}

function linkedSelectorChoiceKey(recordId, variantId = "") {
  return `${recordId}::${variantId}`;
}

function linkedSelectorVariantUnavailable(context, recordId, variantId) {
  const row = context?.select?.closest(".content-product-variant-row");
  const ownerVariantId = row?.querySelector(".product-variant-id")?.value || row?.dataset.productVariantId || "";
  const currentId = currentProductId();
  if (!ownerVariantId || !currentId || recordId !== currentId || variantId !== ownerVariantId) return false;
  return context.select.classList.contains("product-prerequisite-product-selector") ||
    context.select.classList.contains("product-bundle-component-product");
}

function updateLinkedSelectorSelectedCount() {
  const context = linkedRecordSelectorContext;
  const count = context?.selectedChoices?.size || 0;
  const label = document.getElementById("contentLinkedRecordSelectorSelectedCount");
  if (label) label.textContent = context?.multiple
    ? `${count} exact selection${count === 1 ? "" : "s"}` : "";
  const confirm = document.getElementById("confirmContentLinkedRecordSelectorBtn");
  if (confirm) {
    confirm.classList.toggle("hidden", !context?.multiple);
    confirm.disabled = count === 0;
  }
}

async function refreshLinkedRecordSelectorData() {
  const context = linkedRecordSelectorContext;
  if (!context) return;
  try {
    const response = await getContentBuilderData();
    if (linkedRecordSelectorContext !== context) return;
    state.options = { ...state.options, ...(response.data?.options || {}) };
    state.records = { ...state.records, ...(response.data?.records || {}) };
    renderLinkedRecordSelector();
  } catch (error) {
    console.error("Failed to refresh linked content selector:", error);
  }
}

function renderLinkedRecordSelector() {
  const context = linkedRecordSelectorContext;
  if (!context) return;
  const search = normalizedText(document.getElementById("contentLinkedRecordSearch")?.value);
  const terms = search.split(/\s+/).filter(Boolean);
  const secondaryTag = document.getElementById("contentLinkedRecordTagFilter")?.value || "";
  const secondaryType = document.getElementById("contentLinkedRecordTypeFilter")?.value || "";
  const fixedType = normalizedText(context.select.dataset.linkedTypeFilter);
  const fixedStatus = normalizedText(context.select.dataset.linkedStatusFilter);
  const fixedTags = uniqueValues(String(context.select.dataset.linkedTagFilters || "").split(","))
    .map(normalizedText);
  // Reusing one record in the same template field on another entity variant is
  // valid (for example, one Dress code Item for every Workshop variant). Only
  // prevent the same record being selected twice inside this exact field.
  const selectionScope = context.select.closest(".content-template-linked-field") || document;
  const allowRecordReuse = context.select.dataset.allowRecordReuse === "true";
  const selectedElsewhere = allowRecordReuse ? new Set() : new Set([...selectionScope.querySelectorAll(
    `.content-template-linked-select[data-field-key="${CSS.escape(context.select.dataset.fieldKey || "")}"]`,
  )].filter((select) => select !== context.select).map((select) => select.value).filter(Boolean));
  const records = linkedSelectorRecords(context).filter((record) => {
    const recordType = normalizedText(record.type || record.blueprintType || record.assetType);
    const recordStatus = normalizedText(record.status || "active");
    const tags = uniqueValues(record.tags || []).map(normalizedText);
    if (fixedType && recordType !== fixedType) return false;
    if (fixedStatus && recordStatus !== fixedStatus) return false;
    if (fixedTags.some((tag) => !tags.includes(tag))) return false;
    if (secondaryType && recordType !== normalizedText(secondaryType)) return false;
    if (secondaryTag && !tags.includes(normalizedText(secondaryTag))) return false;
    const haystack = normalizedText([
      record.name, record.title, record.id, record.type, record.blueprintType, record.assetType, ...tags,
    ].filter(Boolean).join(" "));
    return terms.every((term) => haystack.includes(term));
  });
  const results = document.getElementById("contentLinkedRecordSelectorResults");
  if (results) {
    results.innerHTML = records.length ? records.map((record) => {
      const selected = context.select.value === record.id;
      const unavailable = selectedElsewhere.has(record.id);
      const tags = uniqueValues(record.tags || []);
      const variants = linkedSelectorRecordVariants(record, context);
      const recordAssets = Array.isArray(record.assets) ? record.assets : [];
      const imageAsset = recordAssets.find((asset) => {
        const type = normalizedText(asset?.assetType || asset?.type);
        return type === "image" || /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(asset?.fileUrl || asset?.url || "");
      });
      const primaryAssetId = variants.find((variant) => variant.primaryAssetId)?.primaryAssetId ||
        record.primaryAssetId || "";
      const primaryAsset = (state.records.assets || []).find((asset) =>
        (asset.id || asset.assetId) === primaryAssetId);
      const imageUrl = imageAsset?.fileUrl || imageAsset?.url || primaryAsset?.fileUrl ||
        primaryAsset?.url || record.imageUrl || record.image || "";
      const table = normalizedText(context.select.dataset.linkedTable);
      const editable = !["asset", "assets", "item asset", "item assets"].includes(table);
      const availableVariants = variants.filter((variant) => !linkedSelectorVariantUnavailable(
        context,
        record.id,
        linkedSelectorVariantId(variant),
      ));
      const selectedVariantIds = availableVariants.filter((variant) =>
        context.selectedChoices?.has(linkedSelectorChoiceKey(record.id, linkedSelectorVariantId(variant))));
      const allVariantsSelected = availableVariants.length > 0 && selectedVariantIds.length === availableVariants.length;
      return `<article class="w-full overflow-hidden rounded border p-3 ${selected || selectedVariantIds.length ? "border-[#9edbd7] bg-[#153b38]" : "border-gray-700 bg-gray-950/60"} ${unavailable ? "opacity-50" : ""}">
        <div class="flex min-w-0 gap-3">
          ${imageUrl ? `<img src="${escapeHTML(imageUrl)}" alt="" class="h-20 w-20 shrink-0 rounded border border-gray-700 object-cover">` : ""}
          <div class="min-w-0 flex-1">
            <span class="flex flex-wrap items-start justify-between gap-2">
              <span class="font-semibold text-white">${escapeHTML(record.name || record.title || record.id)}</span>
              <span class="text-xs text-gray-400">${escapeHTML([
    String(record.recordType || context.select.dataset.linkedTable || "record")
      .replace(/s$/i, "").toUpperCase(),
    record.type || record.productType || record.assetType,
    record.status,
  ].filter(Boolean).join(" · "))}</span>
            </span>
            ${record.shortDescription ? `<p class="mt-1 text-sm text-gray-300">${escapeHTML(record.shortDescription)}</p>` : ""}
            ${context.multiple && variants.length ? `<div class="mt-3 rounded border border-gray-700 bg-gray-900/70 p-2">
              <label class="mb-2 flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#9edbd7]">
                <input type="checkbox" data-linked-selector-all-variants="${escapeHTML(record.id)}" class="accent-[#407471]" ${allVariantsSelected ? "checked" : ""}> All variants
              </label>
              <div class="grid gap-2 sm:grid-cols-2">${variants.map((variant) => {
    const variantId = linkedSelectorVariantId(variant);
    const checked = context.selectedChoices?.has(linkedSelectorChoiceKey(record.id, variantId));
    const variantUnavailable = linkedSelectorVariantUnavailable(context, record.id, variantId);
    return `<label class="flex cursor-pointer items-center gap-2 rounded border border-gray-700 px-2 py-1 text-xs text-gray-200">
                  <input type="checkbox" data-linked-selector-variant-record-id="${escapeHTML(record.id)}" data-linked-selector-variant-id="${escapeHTML(variantId)}" class="accent-[#407471]" ${checked ? "checked" : ""} ${variantUnavailable ? "disabled" : ""}>
                  <span>${escapeHTML(variant.name || variantId)} · ${escapeHTML(variant.status || "draft")}</span>
                </label>`;
  }).join("")}</div>
            </div>` : variants.length ? `<div class="mt-2 flex flex-wrap gap-1">${variants.map((variant) => `<span class="rounded border border-gray-700 bg-gray-900 px-2 py-0.5 text-xs text-gray-300">${escapeHTML(variant.name || variant.entityVariantId || "Variant")} · ${escapeHTML(variant.status || "draft")}</span>`).join("")}</div>` : ""}
            ${tags.length ? `<div class="mt-2 flex flex-wrap gap-1">${tags.map((tag) => `<span class="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">${escapeHTML(tag)}</span>`).join("")}</div>` : ""}
          </div>
        </div>
        <div class="mt-3 flex flex-wrap justify-end gap-2">
          ${editable ? `<button type="button" data-linked-selector-edit-record-id="${escapeHTML(record.id)}" class="rounded border border-gray-600 px-3 py-1 text-xs text-gray-200 hover:border-[#407471] hover:text-white">Edit</button>` : ""}
          ${context.multiple ? (!variants.length ? `<label class="flex cursor-pointer items-center gap-2 rounded border border-[#407471] px-3 py-1 text-xs text-[#9edbd7]"><input type="checkbox" data-linked-selector-variant-record-id="${escapeHTML(record.id)}" data-linked-selector-variant-id="" class="accent-[#407471]" ${context.selectedChoices?.has(linkedSelectorChoiceKey(record.id, "")) ? "checked" : ""}> Select</label>` : "") : `<button type="button" data-linked-selector-record-id="${escapeHTML(record.id)}" class="rounded border border-[#407471] px-3 py-1 text-xs text-[#9edbd7] hover:bg-[#407471]/20" ${unavailable ? "disabled" : ""}>${selected ? "Selected" : "Choose"}</button>`}
        </div>
      </article>`;
    }).join("") : `<div class="rounded border border-dashed border-gray-700 p-8 text-center text-sm text-gray-400">No matching content. Adjust the search or create a new record with these filters.</div>`;
  }
  const count = document.getElementById("contentLinkedRecordSelectorCount");
  if (count) count.textContent = `${records.length} matching record${records.length === 1 ? "" : "s"}`;
  updateLinkedSelectorSelectedCount();
}

function openLinkedRecordSelector(trigger) {
  const picker = trigger.closest(".content-template-linked-picker");
  const selectorTarget = trigger.dataset.linkedSelectorTarget || ".content-template-linked-select";
  const select = picker?.querySelector(selectorTarget);
  if (!select) {
    console.error("Could not open the content selector because its linked select was not found.", trigger);
    showToast("Could not open this selector. Close and reopen the Product Creator, then try again.", "error");
    return false;
  }
  if (select.classList.contains("content-product-unlock-target")) {
    const unlockType = select.closest(".content-product-unlock-row")
      ?.querySelector(".content-product-unlock-type")?.value || "Plan";
    select.dataset.linkedTable = `${unlockType}s`;
    select.dataset.fieldName = `${unlockType} content to unlock`;
  }
  const multiple = select.dataset.selectorMultiple === "true";
  const selectedChoices = new Map();
  if (multiple) {
    const row = select.closest(".product-variant-content-link-row, .content-product-unlock-row, .product-prerequisite-row, .product-bundle-component-row, .content-template-linked-row");
    const owner = row?.closest("#productVariantContentLinkRows, #contentProductUnlockRows, .product-prerequisite-rows, .product-bundle-component-rows, .content-template-linked-rows") || row;
    const selectorClass = [...select.classList].find((className) => [
      "variant-content-blueprint",
      "content-product-unlock-target",
      "product-prerequisite-product-selector",
      "product-prerequisite-item-selector",
      "product-bundle-component-product",
      "content-template-linked-select",
    ].includes(className));
    let peerSelects = selectorClass ? [...owner.querySelectorAll(`.${selectorClass}`)] : [select];
    if (row?.classList.contains("product-variant-content-link-row")) {
      const productVariantId = row.querySelector(".variant-content-product-variant")?.value || "";
      const linkRole = row.querySelector(".variant-content-link-role")?.value || "ManufacturedFrom";
      peerSelects = peerSelects.filter((peer) => {
        const peerRow = peer.closest(".product-variant-content-link-row");
        return peerRow?.querySelector(".variant-content-product-variant")?.value === productVariantId &&
          peerRow?.querySelector(".variant-content-link-role")?.value === linkRole;
      });
    } else if (row?.classList.contains("content-product-unlock-row")) {
      const productVariantId = row.querySelector(".content-product-unlock-variant")?.value || "";
      const entityType = row.querySelector(".content-product-unlock-type")?.value || "Plan";
      peerSelects = peerSelects.filter((peer) => {
        const peerRow = peer.closest(".content-product-unlock-row");
        return peerRow?.querySelector(".content-product-unlock-variant")?.value === productVariantId &&
          peerRow?.querySelector(".content-product-unlock-type")?.value === entityType;
      });
    }
    peerSelects.forEach((peer) => {
      if (!peer.value || peer.dataset.linkedTable !== select.dataset.linkedTable) return;
      const peerRow = peer.closest(".product-variant-content-link-row, .content-product-unlock-row, .product-prerequisite-row, .product-bundle-component-row, .content-template-linked-row");
      const variantSelect = peerRow?.querySelector(".variant-content-blueprint-variant, .content-product-unlock-target-variant, .product-prerequisite-variant, .product-bundle-component-variant, .content-template-linked-variant");
      const key = linkedSelectorChoiceKey(peer.value, variantSelect?.value || "");
      selectedChoices.set(key, { recordId: peer.value, variantId: variantSelect?.value || "" });
    });
  }
  linkedRecordSelectorContext = { trigger, select, multiple, selectedChoices };
  const records = linkedSelectorRecords();
  const fixedType = select.dataset.linkedTypeFilter || "";
  const fixedStatus = select.dataset.linkedStatusFilter || "";
  const fixedTags = uniqueValues(String(select.dataset.linkedTagFilters || "").split(","));
  const table = select.dataset.linkedTable || "content";
  const title = document.getElementById("contentLinkedRecordSelectorTitle");
  if (title) title.textContent = `Choose ${select.dataset.fieldName || table}`;
  const context = document.getElementById("contentLinkedRecordSelectorContext");
  if (context) context.textContent = table;
  const ownerRow = select.closest(".content-product-variant-row");
  const ownerName = ownerRow?.querySelector(".product-variant-name")?.value ||
    ownerRow?.querySelector(".product-variant-id")?.value || "";
  if (context && ownerName) context.textContent = `${select.dataset.relationshipLabel || select.dataset.fieldName || table} · ${ownerName}`;
  const constraint = document.getElementById("contentLinkedRecordSelectorConstraint");
  if (constraint) constraint.textContent = [
    fixedType && `Type: ${fixedType}`,
    fixedStatus && `Status: ${fixedStatus}`,
    fixedTags.length && `Required tags: ${fixedTags.join(", ")}`,
  ].filter(Boolean).join(" · ") || "The template has not imposed an additional type, status or tag restriction.";
  if (constraint && multiple) {
    constraint.textContent += " Tick one or more exact variants, or use All variants, then select Add selected.";
  }
  setInputValue("contentLinkedRecordSearch", "");
  const availableTags = uniqueValues(records.flatMap((record) => record.tags || [])).sort();
  const tagFilter = document.getElementById("contentLinkedRecordTagFilter");
  if (tagFilter) tagFilter.innerHTML = `<option value="">All tags</option>${availableTags.map((tag) => `<option value="${escapeHTML(tag)}">${escapeHTML(tag)}</option>`).join("")}`;
  const availableTypes = uniqueValues(records.map((record) => record.type || record.assetType).filter(Boolean)).sort();
  const typeFilter = document.getElementById("contentLinkedRecordTypeFilter");
  if (typeFilter) {
    const types = fixedType ? [fixedType] : availableTypes;
    typeFilter.innerHTML = `${fixedType ? "" : "<option value=\"\">All types</option>"}${types.map((type) => `<option value="${escapeHTML(type)}">${escapeHTML(type)}</option>`).join("")}`;
    typeFilter.disabled = Boolean(fixedType);
  }
  const modal = document.getElementById("contentLinkedRecordSelectorModal");
  if (modal?.parentElement !== document.body) document.body.appendChild(modal);
  modal?.classList.remove("hidden");
  modal?.classList.add("flex");
  modal?.setAttribute("aria-hidden", "false");
  renderLinkedRecordSelector();
  void refreshLinkedRecordSelectorData();
  document.getElementById("contentLinkedRecordSearch")?.focus();
  return true;
}

function applyLinkedSelectorChoices(context) {
  const choices = [...(context?.selectedChoices?.values() || [])];
  const select = context?.select;
  if (!select || !choices.length) return false;
  const blueprintRow = select.closest(".product-variant-content-link-row");
  const unlockRow = select.closest(".content-product-unlock-row");
  const prerequisiteRow = select.closest(".product-prerequisite-row");
  const bundleRow = select.closest(".product-bundle-component-row");
  if (blueprintRow) {
    const links = productVariantContentLinksFromRows(true);
    const ownerVariantId = blueprintRow.querySelector(".variant-content-product-variant")?.value || "";
    const linkRole = blueprintRow.querySelector(".variant-content-link-role")?.value || "ManufacturedFrom";
    const retained = links.filter((link) =>
      link.productVariantId !== ownerVariantId || link.linkRole !== linkRole);
    retained.push(...choices.map((choice) => ({
      productVariantId: ownerVariantId,
      entityType: "Blueprint",
      entityId: choice.recordId,
      entityVariantId: choice.variantId,
      linkRole,
      status: "active",
    })));
    renderProductVariantContentLinkRows(retained);
  } else if (unlockRow) {
    const grants = productUnlocksFromRows(true);
    const ownerVariantId = unlockRow.querySelector(".content-product-unlock-variant")?.value || "";
    const accessEntityType = unlockRow.querySelector(".content-product-unlock-type")?.value || "Plan";
    const matching = grants.filter((grant) =>
      grant.productVariantId === ownerVariantId && grant.accessEntityType === accessEntityType);
    const retained = grants.filter((grant) =>
      grant.productVariantId !== ownerVariantId || grant.accessEntityType !== accessEntityType);
    retained.push(...choices.map((choice) => ({
      ...(matching.find((grant) => grant.accessEntityId === choice.recordId &&
        grant.accessEntityVariantId === choice.variantId) || matching[0] || {}),
      productVariantId: ownerVariantId,
      accessEntityType,
      accessEntityId: choice.recordId,
      accessEntityVariantId: choice.variantId,
    })));
    renderProductUnlockRows(retained);
  } else if (prerequisiteRow) {
    const productRow = prerequisiteRow.closest(".content-product-variant-row");
    const sourceVariantId = productRow?.querySelector(".product-variant-id")?.value || "";
    const container = prerequisiteRow.closest(".product-prerequisite-rows");
    const rows = [...(container?.querySelectorAll(".product-prerequisite-row") || [])];
    const prerequisites = rows.map((row) => prerequisiteFromRow(row) || {});
    const itemRequirement = prerequisiteRow.querySelector(".product-prerequisite-kind")?.value === "item";
    const retained = prerequisites.filter((entry) =>
      itemRequirement ? entry.requirementType !== "item" : entry.requirementType === "item");
    retained.push(...choices.map((choice) => itemRequirement
      ? { requirementType: "item", itemId: choice.recordId }
      : { requirementType: "product-variant", productId: choice.recordId, productVariantId: choice.variantId }));
    if (container) container.innerHTML = prerequisiteRowsMarkup(retained, sourceVariantId);
  } else if (bundleRow) {
    const productRow = bundleRow.closest(".content-product-variant-row");
    const container = bundleRow.closest(".product-bundle-component-rows");
    syncSelectedProductVariantRows();
    const ownerVariantId = productRow?.querySelector(".product-variant-id")?.value || "";
    const variant = currentProductVariants().find((candidate) => candidate.variantId === ownerVariantId) || {};
    const components = variant.bundleComponents || [];
    const nextComponents = choices.map((choice, choiceIndex) => {
      const existing = components.find((component) =>
        component.componentProductId === choice.recordId &&
        component.componentProductVariantId === choice.variantId);
      return {
        ...(existing || { quantity: 1, inventoryAction: "deduct" }),
        bundleComponentId: existing?.bundleComponentId || `BUNDLE-COMPONENT-${Date.now()}-${choiceIndex}`,
        componentProductId: choice.recordId,
        componentProductVariantId: choice.variantId,
      };
    });
    if (container) container.innerHTML = bundleComponentsMarkup(nextComponents);
  } else {
    const field = select.closest(".content-template-linked-field");
    if (!field) return false;
    const existing = [...field.querySelectorAll(".content-template-linked-row")].map((row) => {
      const entity = row.querySelector(".content-template-linked-select")?.value || "";
      const variant = row.querySelector(".content-template-linked-variant")?.value || "";
      return entity ? { entityId: entity, entityVariantId: variant } : null;
    }).filter(Boolean);
    const currentIndex = [...field.querySelectorAll(".content-template-linked-select")].indexOf(select);
    existing.splice(Math.max(currentIndex, 0), select.value ? 1 : 0,
      ...choices.map((choice) => ({ entityId: choice.recordId, entityVariantId: choice.variantId })));
    restoreLinkedTemplateField(field, existing);
  }
  state.isDirty = true;
  refreshMarketplacePreviews();
  return true;
}

async function linkExistingAssetToCurrentContent(asset) {
  if (!state.editingRecord?.id) {
    throw new Error("Save this content before linking an existing Asset from Connections.");
  }
  const entityType = currentRecordType().replace(/^./, (character) => character.toUpperCase());
  await upsertAdminAsset({
    assetId: asset.id || asset.assetId,
    assetName: asset.assetName || asset.name || asset.title,
    assetType: canonicalAssetType(asset.assetType || asset.type),
    title: asset.title || asset.assetName || asset.name || "Asset",
    description: asset.description || "",
    altText: asset.altText || "",
    notes: asset.notes || "",
    fileUrl: asset.fileUrl || asset.url || "",
    storagePath: asset.storagePath || "",
    originalFilename: asset.originalFilename || "",
    mimeType: asset.mimeType || "",
    externalProvider: asset.externalProvider || "",
    embedUrl: asset.embedUrl || "",
    sourceType: asset.sourceType || (asset.storagePath ? "upload" : "external"),
    status: asset.status || "active",
    approvalStatus: asset.approvalStatus || "draft",
    visibility: asset.visibility || "private",
    ownerUserId: asset.ownerUserId || "",
    renditions: Array.isArray(asset.renditions) ? asset.renditions : [],
    newLinks: [{
      entityType,
      entityId: state.editingRecord.id,
      assetRole: "Entity Asset",
      fieldKey: "entity-assets",
    }],
  });
  const assetId = asset.id || asset.assetId;
  await loadData();
  const refreshed = findRecord(currentRecordType(), state.editingRecord?.id || "");
  if (refreshed) state.editingRecord = refreshed;
  const existingAssets = Array.isArray(state.editingRecord?.assets) ? state.editingRecord.assets : [];
  if (state.editingRecord) {
    state.editingRecord.assets = [
      ...existingAssets.filter((value) =>
        (typeof value === "string" ? value : value.assetId || value.id) !== assetId),
      asset,
    ];
  }
  renderBuilderSummaries();
  showToast(`${asset.title || asset.assetName || asset.name || "Asset"} linked.`, "success");
}

function openEntityAssetSelector(button) {
  const picker = document.createElement("span");
  picker.className = "content-template-linked-picker hidden";
  const select = document.createElement("select");
  select.className = "content-template-linked-select";
  select.dataset.fieldKey = "entity-assets";
  select.dataset.fieldName = "Entity Asset";
  select.dataset.linkedTable = "Assets";
  select.innerHTML = `<option value="">Choose Asset</option>${(state.records.assets || [])
    .map((asset) => `<option value="${escapeHTML(asset.id || asset.assetId)}">${escapeHTML(linkedTemplateRecordLabel(asset))}</option>`)
    .join("")}`;
  const trigger = document.createElement("button");
  trigger.type = "button";
  picker.append(select, trigger);
  button.after(picker);
  openLinkedRecordSelector(trigger);
  if (linkedRecordSelectorContext) {
    linkedRecordSelectorContext.cleanup = () => picker.remove();
    linkedRecordSelectorContext.onSelect = linkExistingAssetToCurrentContent;
  }
}

function cloneBuilderValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function productRelationRecordSnapshot(relation = null) {
  if (!relation) return {};
  return {
    productId: relation.productId || relation.existingProductId || "",
    productSku: relation.sku || "",
    productCategoryId: relation.productCategoryId || "",
    productType: relation.productType || "",
    productPhysicalFulfilment: relation.physicalFulfilment || "none",
    productRequiresShipping: relation.requiresShipping === true,
    productInventoryTracked: relation.inventoryTracked === true,
    productAffiliateAvailable: relation.affiliateAvailable === true,
    productWholesalePrice: relation.wholesalePrice ?? null,
    productWholesaleMinQuantity: relation.wholesaleMinQuantity ?? 1,
    productRequiresCalendar: relation.requiresCalendar === true,
    productRequiresSessionTime: relation.requiresSessionTime === true,
    productTracksSeats: relation.tracksSeats === true,
    productRequiresLocation: relation.requiresLocation === true,
    productRequiresInstructor: relation.requiresInstructor === true,
    productShopStatus: relation.shopStatus || "draft",
    productEffectiveShopPrice: relation.effectiveShopPrice ?? relation.retailPrice ?? null,
    productStock: relation.stock ?? null,
    productVisible: relation.visible === true,
    productFeatured: relation.featured === true,
    productArchived: relation.archived === true,
    productFulfilmentReviewed: relation.fulfilmentReviewed === true,
    productMarketplaceTileImageSource: relation.marketplaceTileImageSource || "entity",
    productMarketplaceTileImageVariantId: relation.marketplaceTileImageVariantId || "",
    productMarketplaceTileDescriptionSource: relation.marketplaceTileDescriptionSource || "entity",
    productMarketplaceTileDescriptionVariantId: relation.marketplaceTileDescriptionVariantId || "",
    productVariantContentLinks: cloneBuilderValue(relation.variantContentLinks || []),
    productAccessGrants: cloneBuilderValue(relation.accessGrants || []),
    manufacturingBlueprintId: relation.manufacturingBlueprintId || "",
    variants: cloneBuilderValue(relation.variants || []),
  };
}

async function captureNestedParentContext(context) {
  const payload = await formPayload(false, { validate: false });
  const entityRow = context.select.closest(".content-entity-variant-row");
  const productBlueprintRow = context.select.closest(".product-variant-content-link-row");
  const productPrerequisiteRow = context.select.closest(".product-prerequisite-row");
  const matchingSelects = [...(entityRow || document).querySelectorAll(
    `.content-template-linked-select[data-field-key="${CSS.escape(context.select.dataset.fieldKey || "")}"]`,
  )];
  const parentEditingRecord = state.editingRecord
    ? cloneBuilderValue(state.editingRecord) : null;
  return {
    parentName: payload.name || parentEditingRecord?.name || `New ${payload.recordType}`,
    parentRecord: {
      ...(parentEditingRecord || {}),
      ...cloneBuilderValue(payload),
      ...productRelationRecordSnapshot(payload.productRelation),
      id: document.getElementById("contentId")?.value || parentEditingRecord?.id || "",
      recordType: payload.recordType,
    },
    parentEditingRecord,
    parentIsDirty: state.isDirty,
    parentStep: state.currentStep,
    parentUrl: `${window.location.pathname}${window.location.search}`,
    parentScrollTop: document.getElementById("contentEntityEditorDrawerBody")?.scrollTop || 0,
    parentProductDrawerOpen: !document.getElementById("contentProductDrawer")
      ?.classList.contains("hidden"),
    target: {
      entityVariantId: entityRow?.dataset.entityVariantId || "",
      fieldKey: context.select.dataset.fieldKey || "",
      selectionIndex: Math.max(matchingSelects.indexOf(context.select), 0),
      connectionKind: productBlueprintRow
        ? "product-blueprint"
        : productPrerequisiteRow ? "product-prerequisite" : "template-field",
      productVariantId:
        productBlueprintRow?.querySelector(".variant-content-product-variant")?.value ||
        productPrerequisiteRow?.closest(".content-product-variant-row")
          ?.querySelector(".product-variant-id")?.value || "",
      linkRole: productBlueprintRow?.querySelector(".variant-content-link-role")?.value || "",
      prerequisiteKind: normalizedText(context.select.dataset.linkedTable) === "products"
        ? "product" : "item",
    },
  };
}

async function restoreNestedParent({ selectedRecord = null, cancelled = false } = {}) {
  const entry = contentBuilderCreationStack.pop();
  if (!entry) return false;
  persistContentBuilderCreationStack();
  populateBuilderFromRecord(entry.parentRecord);
  state.editingRecord = entry.parentEditingRecord
    ? {
      ...entry.parentEditingRecord,
      ...entry.parentRecord,
      id: entry.parentEditingRecord.id,
      recordType: entry.parentEditingRecord.recordType,
    }
    : null;
  updateEditBanner();
  updateConnectionsWorkspaceAvailability();
  state.currentStep = entry.parentStep || 2;
  showBuilderStep(state.currentStep);
  setContentEntityEditorDrawerOpen(true);
  if (entry.parentProductDrawerOpen) openContentProductDrawer();
  history.replaceState({}, "", entry.parentUrl || "/admin/content/builder");

  const variantRoot = entry.target?.entityVariantId
    ? document.querySelector(`.content-entity-variant-row[data-entity-variant-id="${CSS.escape(entry.target.entityVariantId)}"]`)
    : document;
  const selects = [...(variantRoot || document).querySelectorAll(
    `.content-template-linked-select[data-field-key="${CSS.escape(entry.target?.fieldKey || "")}"]`,
  )];
  let select = selects[entry.target?.selectionIndex || 0] || selects[0];
  if (selectedRecord?.id && entry.target?.connectionKind === "product-blueprint") {
    const links = productVariantContentLinksFromRows(true);
    const matchingIndex = links.findIndex((link) =>
      link.productVariantId === entry.target.productVariantId &&
      link.linkRole === entry.target.linkRole && !link.entityId);
    const fallbackIndex = links.findIndex((link) =>
      link.productVariantId === entry.target.productVariantId &&
      link.linkRole === entry.target.linkRole);
    const targetIndex = matchingIndex >= 0 ? matchingIndex : fallbackIndex;
    const connection = {
      productVariantId: entry.target.productVariantId,
      entityType: "Blueprint",
      entityId: selectedRecord.id,
      entityVariantId: "",
      linkRole: entry.target.linkRole || "ManufacturedFrom",
      status: "active",
    };
    if (targetIndex >= 0) links[targetIndex] = connection;
    else links.push(connection);
    renderProductVariantContentLinkRows(links);
    select = [...document.querySelectorAll(
      `.content-template-linked-select[data-field-key="${CSS.escape(entry.target.fieldKey || "")}"]`,
    )][entry.target.selectionIndex || 0] || null;
  }
  if (selectedRecord?.id && entry.target?.connectionKind === "product-prerequisite" && !select) {
    const productRow = [...document.querySelectorAll(".content-product-variant-row")].find((row) =>
      (row.querySelector(".product-variant-id")?.value || row.dataset.productVariantId || "") ===
        entry.target.productVariantId);
    const rows = productRow?.querySelector(".product-prerequisite-rows");
    rows?.querySelector(".product-prerequisite-empty")?.remove();
    rows?.insertAdjacentHTML("beforeend", prerequisiteRowsMarkup([entry.target.prerequisiteKind === "item"
      ? { requirementType: "item", itemId: selectedRecord.id }
      : { requirementType: "product-variant", productId: selectedRecord.id, productVariantId: "" }],
    entry.target.productVariantId));
    select = rows?.lastElementChild?.querySelector(entry.target.prerequisiteKind === "item"
      ? ".product-prerequisite-item-selector"
      : ".product-prerequisite-product-selector") || null;
    refreshLinkedTemplatePickerLabel(select);
  }
  if (select && selectedRecord?.id) {
    if (![...select.options].some((option) => option.value === selectedRecord.id)) {
      select.add(new Option(linkedTemplateRecordLabel(selectedRecord), selectedRecord.id));
    }
    select.value = selectedRecord.id;
    refreshLinkedTemplatePickerLabel(select);
    const field = select.closest(".content-template-linked-field");
    if (field) refreshLinkedTemplateField(field);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  let parentAutoSaved = false;
  state.isDirty = selectedRecord?.id ? true : entry.parentIsDirty === true;
  if (!cancelled && selectedRecord?.id && entry.parentEditingRecord?.id) {
    try {
      const parentPayload = await formPayload(false, { validate: false });
      await updateContentControlRecord({
        recordType: entry.parentEditingRecord.recordType,
        recordId: entry.parentEditingRecord.id,
        updates: parentPayload,
      });
      entry.parentRecord = {
        ...entry.parentRecord,
        ...cloneBuilderValue(parentPayload),
        id: entry.parentEditingRecord.id,
        recordType: entry.parentEditingRecord.recordType,
      };
      state.editingRecord = {
        ...state.editingRecord,
        ...entry.parentRecord,
      };
      state.isDirty = false;
      parentAutoSaved = true;
    } catch (error) {
      console.error("The child record was created, but the parent connection could not be auto-saved:", error);
      showToast(
        `${selectedRecord.name || selectedRecord.id} is attached in this draft. Save the parent to persist the connection.`,
        "error",
      );
    }
  }
  renderBuilderSummaries();
  setTimeout(() => {
    const body = document.getElementById("contentEntityEditorDrawerBody");
    if (body) body.scrollTop = entry.parentScrollTop || 0;
    select?.closest(".content-template-linked-field")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    select?.closest(".content-template-linked-picker")
      ?.querySelector(".open-content-linked-selector")?.focus();
  }, 0);
  showToast(
    cancelled
      ? `Returned to ${entry.parentName}.`
      : `${selectedRecord?.name || selectedRecord?.id || "Content"} was linked to ${entry.parentName}${parentAutoSaved ? " and the parent was saved" : ""}.`,
    "success",
  );
  return true;
}

async function createFromLinkedRecordSelector() {
  const context = linkedRecordSelectorContext;
  if (!context) return;
  const table = normalizedText(context.select.dataset.linkedTable);
  if (["asset", "assets", "item asset", "item assets"].includes(table)) {
    const field = context.select.closest(".content-template-linked-field");
    const trigger = context.trigger;
    trigger.dataset.fieldKey = context.select.dataset.fieldKey || "";
    trigger.dataset.fieldName = context.select.dataset.fieldName || "Asset";
    trigger.dataset.assetType = field?.dataset.assetType || "Document";
    closeLinkedRecordSelector();
    openContentAssetDrawer(trigger);
    return;
  }
  if (["product", "products"].includes(table)) {
    let parentContext;
    try {
      parentContext = await captureNestedParentContext(context);
    } catch (error) {
      console.error("Failed to preserve the parent Product prerequisite:", error);
      showToast(error.message || "Could not preserve the current Product draft.", "error");
      return;
    }
    contentBuilderCreationStack.push(parentContext);
    persistContentBuilderCreationStack();
    closeLinkedRecordSelector();
    if (parentContext.parentProductDrawerOpen) closeContentProductDrawer();
    pendingStandaloneProductId = "";
    setInputValue("contentProductEntitySearch", "");
    setSelectValue("contentProductEntityTypeFilter", "all");
    setSelectValue("contentProductEntitySubtypeFilter", "all");
    setProductEntityPickerOpen(true);
    openContentProductDrawer();
    showToast("Choose the Item, Blueprint, or Plan for the new prerequisite Product.", "success");
    return;
  }
  const recordType = { items: "item", blueprints: "blueprint", plans: "plan" }[table];
  if (!recordType) {
    showToast(`Create new is not available for ${context.select.dataset.linkedTable || "this field"}.`, "error");
    return;
  }
  const fixedTags = uniqueValues([
    ...String(context.select.dataset.linkedTagFilters || "").split(","),
    document.getElementById("contentLinkedRecordTagFilter")?.value || "",
  ]);
  let parentContext;
  try {
    parentContext = await captureNestedParentContext(context);
  } catch (error) {
    console.error("Failed to preserve the parent Content Builder draft:", error);
    showToast(error.message || "Could not preserve the current entity draft.", "error");
    return;
  }
  const params = new URLSearchParams({ entity: recordType });
  const requestedType = context.select.dataset.linkedTypeFilter ||
    document.getElementById("contentLinkedRecordTypeFilter")?.value || "";
  const allowedTypes = state.options[typeOptionsKey(recordType)] || [];
  const alias = recordType === "blueprint" && normalizedText(requestedType) === "workshop"
    ? "workshop operations" : requestedType;
  const type = allowedTypes.find((candidate) =>
    normalizedText(candidate) === normalizedText(alias)) || "";
  const status = context.select.dataset.linkedStatusFilter || "draft";
  const name = document.getElementById("contentLinkedRecordSearch")?.value.trim() || "";
  if (type) params.set("contentType", type);
  if (status) params.set("status", status);
  if (fixedTags.length) params.set("tags", fixedTags.join(","));
  if (name) params.set("name", name);
  contentBuilderCreationStack.push(parentContext);
  persistContentBuilderCreationStack();
  closeLinkedRecordSelector();
  if (parentContext.parentProductDrawerOpen) closeContentProductDrawer();
  populateNewBuilderFromRoute(params);
  history.replaceState({}, "", `/admin/content/builder?${params.toString()}`);
  showBuilderStep(1);
  setContentEntityEditorDrawerOpen(true);
  showToast(`Creating a reusable ${recordType}. Save it to return to ${parentContext.parentName}.`, "success");
}

async function editSelectedLinkedRecord(button) {
  const picker = button.closest(".content-template-linked-picker");
  const select = picker?.querySelector(".content-template-linked-select");
  if (!select?.value) {
    showToast("Choose content before selecting Edit.", "error");
    return;
  }
  const table = normalizedText(select.dataset.linkedTable);
  const recordType = {
    item: "item", items: "item", blueprint: "blueprint", blueprints: "blueprint",
    plan: "plan", plans: "plan", product: "product", products: "product",
  }[table];
  const record = recordType === "product"
    ? (state.records.products || []).find((product) => product.id === select.value)
    : recordType ? findRecord(recordType, select.value) : null;
  if (!recordType || !record) {
    showToast("The selected content could not be loaded for editing.", "error");
    return;
  }
  let parentContext;
  try {
    parentContext = await captureNestedParentContext({ select, trigger: button });
  } catch (error) {
    console.error("Failed to preserve the parent before editing linked content:", error);
    showToast(error.message || "Could not preserve the current Product draft.", "error");
    return;
  }
  contentBuilderCreationStack.push(parentContext);
  persistContentBuilderCreationStack();
  if (parentContext.parentProductDrawerOpen) closeContentProductDrawer();
  if (recordType === "product") {
    const entity = contentRecordForProduct(record);
    if (!entity) {
      contentBuilderCreationStack.pop();
      persistContentBuilderCreationStack();
      showToast("This Product has no connected Item, Blueprint, or Plan to edit from.", "error");
      return;
    }
    populateBuilderFromRecord(entity);
    chooseExistingProduct(record.id);
    openContentProductDrawer();
    state.isDirty = false;
    showToast(
      `Editing ${record.name || record.id}. Save to return to ${parentContext.parentName} with this prerequisite preserved.`,
      "success",
    );
    return;
  }
  history.replaceState(
    {},
    "",
    `/admin/content/builder?type=${encodeURIComponent(recordType)}&id=${encodeURIComponent(record.id)}`,
  );
  populateBuilderFromRecord(record);
  showBuilderStep(1);
  setContentEntityEditorDrawerOpen(true);
  state.isDirty = false;
  showToast(
    `Editing ${record.name || record.id}. Save to return to ${parentContext.parentName} with this connection preserved.`,
    "success",
  );
}

function handleTemplateGuidedFieldsClick(event) {
  const selector = event.target.closest(".open-content-linked-selector");
  if (selector) {
    openLinkedRecordSelector(selector);
    return;
  }
  const createAsset = event.target.closest(".create-content-template-asset");
  if (createAsset) {
    openContentAssetDrawer(createAsset);
    return;
  }
  const field = event.target.closest(".content-template-linked-field");
  if (!field) return;
  if (event.target.closest(".add-content-template-entry")) {
    addLinkedTemplateFieldRow(field)?.querySelector(".open-content-linked-selector")?.focus();
    return;
  }
  const remove = event.target.closest(".remove-content-template-entry");
  if (!remove) return;
  const rows = field.querySelectorAll(".content-template-linked-row");
  const minimum = Math.max(Number(field.dataset.minEntries || 0), 1);
  if (rows.length <= minimum) return;
  remove.closest(".content-template-linked-row")?.remove();
  refreshLinkedTemplateField(field);
}

function assetFileAccept(assetType) {
  return {
    Image: "image/*",
    Video: "video/*",
    PDF: "application/pdf,.pdf",
    Audio: "audio/*",
  }[assetType] || "";
}

function openContentAssetDrawer(button) {
  const repeatableField = button.closest(".content-template-linked-field");
  const promotionSelect = button.closest(".content-product-variant-row")
    ?.querySelector(".product-variant-promotion-assets") || null;
  assetDrawerField = {
    key: templateFieldKey(button.dataset.fieldKey || repeatableField?.dataset.fieldKey),
    name: button.dataset.fieldName || repeatableField?.dataset.fieldName || "Template Asset",
    type: button.dataset.assetType || repeatableField?.dataset.assetType || "Document",
    repeatableField,
    promotionSelect,
    trigger: button,
  };
  const form = document.getElementById("contentAssetDrawerForm");
  form?.reset();
  assetDrawerFile = null;
  resumeAssetSaveAfterFileSelection = false;
  const selectedFile = document.getElementById("contentAssetSelectedFile");
  if (selectedFile) selectedFile.textContent = "No file selected.";
  setInputValue("contentAssetType", assetDrawerField.type);
  setInputValue("contentAssetStatus", "active");
  const prefersExternal = ["Video", "Canva Design"].includes(assetDrawerField.type);
  setInputValue("contentAssetStorageMethod", prefersExternal ? "external" : "upload");
  setInputValue("contentAssetExternalProvider", assetDrawerField.type === "Canva Design" ? "canva" : "youtube");
  updateContentAssetStorageMethod();
  const file = document.getElementById("contentAssetFile");
  if (file) file.accept = assetFileAccept(assetDrawerField.type);
  document.getElementById("contentAssetDrawerContext").textContent =
    `${assetDrawerField.name} | ${assetDrawerField.type}`;
  const helpPanel = document.getElementById("contentAssetHelpPanel");
  const helpButton = document.getElementById("toggleContentAssetHelpBtn");
  helpPanel?.classList.add("hidden");
  helpButton?.setAttribute("aria-expanded", "false");
  if (helpButton) helpButton.textContent = "Help";
  const drawer = document.getElementById("contentAssetDrawer");
  if (drawer?.parentElement !== document.body) document.body.appendChild(drawer);
  if (drawer) drawer.inert = false;
  drawer?.classList.remove("hidden");
  drawer?.setAttribute("aria-hidden", "false");
  document.getElementById("contentAssetName")?.focus();
}

function updateContentAssetStorageMethod() {
  const external = document.getElementById("contentAssetStorageMethod")?.value === "external";
  document.getElementById("contentAssetFileRow")?.classList.toggle("hidden", external);
  document.getElementById("contentAssetExternalRow")?.classList.toggle("hidden", !external);
  const file = document.getElementById("contentAssetFile");
  const url = document.getElementById("contentAssetExternalUrl");
  if (file) file.required = !external;
  if (url) url.required = external;
  const saveButton = document.getElementById("saveContentAssetBtn");
  if (saveButton && !saveButton.disabled) {
    saveButton.textContent = external ? "Save and add asset" : "Upload and add asset";
  }
}

function validatedExternalAssetUrl(value, provider) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Enter a valid external URL."); }
  if (url.protocol !== "https:") throw new Error("External Asset URLs must use HTTPS.");
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const matchesHost = (host) => hostname === host || hostname.endsWith(`.${host}`);
  if (provider === "youtube" && !["youtube.com", "youtu.be"].some(matchesHost)) {
    throw new Error("Enter a valid YouTube URL.");
  }
  if (provider === "canva" && !matchesHost("canva.com")) {
    throw new Error("Enter a valid Canva URL.");
  }
  return url.toString();
}

function youtubeEmbedUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    let videoId = hostname === "youtu.be" ? url.pathname.split("/").filter(Boolean)[0] : url.searchParams.get("v");
    if (!videoId && ["shorts", "embed"].includes(url.pathname.split("/").filter(Boolean)[0])) {
      videoId = url.pathname.split("/").filter(Boolean)[1];
    }
    return videoId ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}` : "";
  } catch {
    return "";
  }
}

function closeContentAssetDrawer() {
  const drawer = document.getElementById("contentAssetDrawer");
  const returnFocusTo = assetDrawerField?.trigger;
  if (returnFocusTo?.isConnected) returnFocusTo.focus();
  else if (drawer?.contains(document.activeElement)) document.activeElement.blur();
  drawer?.classList.add("hidden");
  drawer?.setAttribute("aria-hidden", "true");
  if (drawer) drawer.inert = true;
  assetDrawerField = null;
  assetDrawerFile = null;
  resumeAssetSaveAfterFileSelection = false;
}

function assertAssetFileType(file, assetType) {
  const valid = {
    Image: file.type.startsWith("image/"),
    Video: file.type.startsWith("video/"),
    PDF: file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
    Audio: file.type.startsWith("audio/"),
  }[assetType];
  if (valid === false) throw new Error(`Choose a valid ${assetType} file.`);
  assertAssetUploadSize(file, assetType);
}

function selectNewTemplateAsset(asset) {
  const promotionSelect = assetDrawerField?.promotionSelect;
  if (promotionSelect) {
    if (![...promotionSelect.options].some((option) => option.value === asset.id)) {
      promotionSelect.add(new Option(asset.title || asset.assetName || asset.name || asset.id, asset.id));
    }
    const option = [...promotionSelect.options].find((candidate) => candidate.value === asset.id);
    if (option) option.selected = true;
    const row = promotionSelect.closest(".content-product-variant-row");
    const picker = row?.querySelector(".product-variant-promotion-asset-picker");
    if (picker && ![...picker.options].some((candidate) => candidate.value === asset.id)) {
      picker.add(new Option(asset.title || asset.assetName || asset.name || asset.id, asset.id));
    }
    refreshPromotionAssetSelection(row);
    updateMarketplacePreviewRow(promotionSelect);
    return;
  }
  const key = assetDrawerField?.key;
  if (!key) return;
  let selects = [...document.querySelectorAll(
    `.content-template-linked-select[data-field-key="${CSS.escape(key)}"]`,
  )];
  selects.forEach((select) => {
    if (![...select.options].some((option) => option.value === asset.id)) {
      select.add(new Option(linkedTemplateRecordLabel(asset), asset.id));
    }
  });
  let target = selects.find((select) => !select.value) || selects[0];
  if (assetDrawerField.repeatableField && selects.every((select) => select.value)) {
    target = addLinkedTemplateFieldRow(assetDrawerField.repeatableField)?.querySelector("select") || target;
    selects = [...assetDrawerField.repeatableField.querySelectorAll(".content-template-linked-select")];
    selects.forEach((select) => {
      if (![...select.options].some((option) => option.value === asset.id)) {
        select.add(new Option(linkedTemplateRecordLabel(asset), asset.id));
      }
    });
  }
  if (target) target.value = asset.id;
  if (assetDrawerField.repeatableField) refreshLinkedTemplateField(assetDrawerField.repeatableField);
}

async function saveContentAsset(event) {
  event.preventDefault();
  const button = document.getElementById("saveContentAssetBtn");
  const file = document.getElementById("contentAssetFile")?.files?.[0] || assetDrawerFile;
  const selectedStorageMethod = document.getElementById("contentAssetStorageMethod")?.value || "upload";
  const externalUrl = document.getElementById("contentAssetExternalUrl")?.value.trim() || "";
  // Prefer the populated source if the visible method and entered data ever get out of sync.
  const storageMethod = externalUrl && !file ? "external" : selectedStorageMethod;
  const externalProvider = document.getElementById("contentAssetExternalProvider")?.value || "";
  const assetName = document.getElementById("contentAssetName")?.value.trim() || "";
  const assetType = document.getElementById("contentAssetType")?.value || assetDrawerField?.type || "Document";
  if (!assetName || !assetDrawerField) return;
  try {
    if (storageMethod === "upload" && !file) {
      resumeAssetSaveAfterFileSelection = true;
      document.getElementById("contentAssetFile")?.click();
      showToast("Choose the file to upload. Saving will continue after it is selected.", "info");
      return;
    }
    if (file) assertAssetFileType(file, assetType);
    button.disabled = true;
    button.textContent = storageMethod === "upload" ? "Uploading..." : "Saving...";
    const assetId = `ASSET-${templateFieldKey(assetName).toUpperCase().replaceAll("_", "-")}-${Date.now()}`;
    let fileUrl = "";
    let storagePath = "";
    if (storageMethod === "upload") {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      storagePath = `assets/${assetId}/${Date.now()}-${safeName}`;
      const fileRef = ref(storage, storagePath);
      await uploadBytes(fileRef, file, { contentType: file.type || undefined });
      fileUrl = await getDownloadURL(fileRef);
    } else {
      fileUrl = validatedExternalAssetUrl(
        externalUrl,
        externalProvider,
      );
    }
    const recordType = currentRecordType();
    const editingId = state.editingRecord?.id || "";
    const response = await upsertAdminAsset({
      assetId,
      assetName,
      assetType,
      title: document.getElementById("contentAssetTitle")?.value.trim() || assetName,
      description: document.getElementById("contentAssetDescription")?.value.trim() || "",
      altText: document.getElementById("contentAssetAltText")?.value.trim() || "",
      notes: document.getElementById("contentAssetNotes")?.value.trim() || "",
      fileUrl,
      storagePath,
      originalFilename: file?.name || "",
      mimeType: file?.type || (externalProvider === "youtube" ? "text/html+youtube" : "text/html"),
      externalProvider: storageMethod === "external" ? externalProvider : "",
      embedUrl: storageMethod === "external" && externalProvider === "youtube"
        ? youtubeEmbedUrl(fileUrl)
        : "",
      sourceType: storageMethod,
      status: document.getElementById("contentAssetStatus")?.value || "active",
      visibility: "private",
      newLinks: editingId && ["item", "blueprint", "plan"].includes(recordType) ? [{
        entityType: singularRecordType(recordType).replace(/^./, (character) => character.toUpperCase()),
        entityId: editingId,
        assetRole: assetDrawerField.name,
        fieldKey: assetDrawerField.key,
      }] : [],
    });
    const savedEmbedUrl = storageMethod === "external" && externalProvider === "youtube"
      ? youtubeEmbedUrl(fileUrl)
      : "";
    const savedAsset = {
      id: response.data?.assetId || assetId,
      assetId: response.data?.assetId || assetId,
      name: assetName,
      assetName,
      assetType,
      type: assetType.toLowerCase(),
      title: document.getElementById("contentAssetTitle")?.value.trim() || assetName,
      fileUrl,
      embedUrl: savedEmbedUrl,
      externalProvider: storageMethod === "external" ? externalProvider : "",
      status: document.getElementById("contentAssetStatus")?.value || "active",
    };
    state.records.assets = [...state.records.assets.filter((asset) => asset.id !== savedAsset.id), savedAsset];
    selectNewTemplateAsset(savedAsset);
    if ((!assetDrawerField?.key || assetDrawerField.key === "entity-assets") && state.editingRecord) {
      const currentAssets = Array.isArray(state.editingRecord.assets) ? state.editingRecord.assets : [];
      state.editingRecord.assets = [
        ...currentAssets.filter((asset) => (typeof asset === "string" ? asset : asset.assetId || asset.id) !== savedAsset.id),
        savedAsset,
      ];
    }
    state.isDirty = true;
    renderBuilderSummaries();
    showToast("Asset uploaded, saved, and selected.", "success");
    closeContentAssetDrawer();
  } catch (error) {
    console.error("Failed to create template Asset:", error);
    showToast(error.message || "Failed to create Asset.", "error");
  } finally {
    button.disabled = false;
    updateContentAssetStorageMethod();
  }
}

function renderItemProductTemplateFields(template) {
  const defaults = template?.defaults || {};
  const isShopProduct = defaults.isShopProduct === true;
  const requiresShipping = defaults.requiresShipping === true;
  const inventoryTracked = defaults.inventoryTracked === true;
  const behaviours = [
    isShopProduct ? "Shop product" : "",
    requiresShipping ? "Shipping" : "",
    inventoryTracked ? "Inventory" : "",
    defaults.unlocksAccess === true ? "Access unlock" : "",
    defaults.requiresCalendar === true ? "Calendar" : "",
    defaults.requiresSessionTime === true ? "Event timing" : "",
    defaults.tracksSeats === true ? "Tickets/seats" : "",
    defaults.requiresLocation === true ? "Location" : "",
    defaults.requiresInstructor === true ? "Instructor" : "",
    defaults.issuesCertificate === true ? "Certificate" : "",
  ].filter(Boolean);

  return `
    <div>
      <div id="contentTemplateSelectorSlot" class="mb-4"></div>
      <h3 class="font-semibold text-white">${escapeHTML(template?.name || "Item fields")}</h3>
      <p class="mt-1 text-xs text-gray-300">
        ${template
    ? "Complete the fields shown by this template. Changing the template rebuilds this part of the form."
    : "Choose or create a template to define the fields for this Item."}
      </p>
      <div class="mt-3 grid gap-2 text-xs text-gray-300 sm:grid-cols-2">
        <div><strong>Enabled behaviours:</strong> ${escapeHTML(behaviours.join(", ") || "Standard Item")}</div>
      </div>
      ${renderTemplateCustomFields(template)}
    </div>
  `;
}

function renderPlanTemplateFields(template) {
  const defaults = template?.defaults || {};
  return `
    <div>
      <div id="planTemplateSelectorSlot" class="mb-4"></div>
      <h3 class="font-semibold text-white">${escapeHTML(template?.name || "Plan structure")}</h3>
      <p class="mt-1 text-xs text-gray-300">
        Add reusable Blueprints and Items through this variant's fields and the Connections step.
      </p>
      <div class="mt-3 grid gap-3">
        <div class="grid gap-3 md:grid-cols-2">
          <label class="block">
            Duration minutes
            <input
              id="contentDurationMinutes"
              type="number"
              min="0"
              class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
              value="${Number(defaults.durationMinutes || 0) || ""}"
            >
          </label>
          <label class="block">
            Size / variant label
            <input
              id="contentSizeLabel"
              class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
              value="${escapeHTML(defaults.sizeLabel || "")}"
            >
          </label>
        </div>
        <div class="rounded border border-gray-700 bg-gray-950/40 p-3 text-xs text-gray-300">
          Template fields define the variant-specific structure. Connections remain reusable and are not copied
          into the template.
        </div>
      </div>
      ${renderTemplateCustomFields(template)}
    </div>
  `;
}

function renderBlueprintTemplateFields(template) {
  const fields = template?.defaults?.fields || [];
  return `
    <div>
      <div id="contentTemplateSelectorSlot" class="mb-4"></div>
      <h3 class="font-semibold text-white">${escapeHTML(template?.name || "Blueprint fields")}</h3>
      <p class="mt-1 text-xs text-gray-300">
        ${template
    ? "Use this saved structure for a reusable action that Plans can link to later."
    : "Choose a saved template or create one here. The Blueprint type controls the available field groups."}
      </p>
      ${fields.length ? renderTemplateCustomFields(template) : ""}
      <p class="mt-2 text-xs text-gray-400">Choose reusable Items in the Connections step.</p>
    </div>
  `;
}

function restoreTemplateFieldToStepOne() {
  const field = document.getElementById("contentTemplateField");
  const slot = document.getElementById("contentTemplateStepOneSlot");
  if (!field || !slot) return;
  if (field.parentElement !== slot) slot.appendChild(field);
  slot.classList.remove("hidden");
  field.classList.remove("rounded", "border", "border-gray-700", "bg-gray-950/50", "p-3");
  const label = document.getElementById("contentTemplateLabel");
  const createButton = document.getElementById("createPlanTemplateBtn");
  const editButton = document.getElementById("editContentTemplateBtn");
  const help = document.getElementById("contentTemplateHelp");
  if (label) label.textContent = "Template";
  createButton?.classList.add("hidden");
  editButton?.classList.add("hidden");
  help?.classList.add("hidden");
}

function positionTemplateField(recordType) {
  const field = document.getElementById("contentTemplateField");
  if (!field) return;

  if (!["item", "blueprint", "plan"].includes(recordType)) {
    restoreTemplateFieldToStepOne();
    return;
  }

  const slot = document.getElementById(
    recordType === "plan" ? "planTemplateSelectorSlot" : "contentTemplateSelectorSlot",
  );
  if (!slot) return;
  document.getElementById("contentTemplateStepOneSlot")?.classList.add("hidden");
  field.classList.add("rounded", "border", "border-gray-700", "bg-gray-950/50", "p-3");
  const label = document.getElementById("contentTemplateLabel");
  const createButton = document.getElementById("createPlanTemplateBtn");
  const editButton = document.getElementById("editContentTemplateBtn");
  const help = document.getElementById("contentTemplateHelp");
  const typeValue = document.getElementById("contentType")?.value || "";
  const templates = templateDefinitions(recordType, typeValue);
  if (label) {
    label.textContent = `${typeValue || recordType} template variant`;
  }
  createButton?.classList.toggle("hidden", templates.length > 0);
  editButton?.classList.remove("hidden");
  if (editButton) editButton.disabled = !selectedTemplate();
  help?.classList.remove("hidden");
  if (help) {
    help.textContent = templates.length
      ? `The ${typeValue} template is selected automatically. Choose or edit one of its variants here.`
      : `Create the first reusable template for ${typeValue || `this ${recordType} type`}.`;
  }
  slot.appendChild(field);
}

function renderTemplateGuidedFields() {
  const container = document.getElementById("templateGuidedFields");
  if (!container) return;

  restoreTemplateFieldToStepOne();
  const recordType = document.getElementById("contentRecordType")?.value || "item";
  const template = selectedTemplate();
  if (recordType === "item") {
    container.innerHTML = renderItemProductTemplateFields(template);
    positionTemplateField(recordType);
    return;
  }

  if (recordType === "plan") {
    container.innerHTML = renderPlanTemplateFields(template);
    positionTemplateField(recordType);
    renderPlanTemplateSelect(template?.id || "");
    return;
  }

  if (recordType === "blueprint") {
    container.innerHTML = renderBlueprintTemplateFields(template);
    positionTemplateField(recordType);
    return;
  }

  container.innerHTML = renderPlanTemplateFields(template);
}

function renderPlanTemplateSelect(selectedId = "") {
  const select = document.getElementById("contentTemplate");
  const help = document.getElementById("contentTemplateHelp");
  if (!select || currentRecordType() !== "plan") return;

  const typeValue = document.getElementById("contentType")?.value || "";
  const templates = templateDefinitions("plan", typeValue);
  select.innerHTML = templates.length
    ? templates.map((template) =>
      `<option value="${escapeHTML(template.id)}">${escapeHTML(templateOptionLabel(template))}</option>`,
    ).join("")
    : "<option value=\"\">No templates for this Plan type yet</option>";

  const desiredId = selectedId || templates.find((template) => template.isDefault)?.id || templates[0]?.id || "";
  if (desiredId && templates.some((template) => template.id === desiredId)) select.value = desiredId;
  if (help) {
    help.textContent = templates.length
      ? `${templates.length} template variant${templates.length === 1 ? "" : "s"} available for ${typeValue}.`
      : `Create the first reusable template for ${typeValue || "this Plan type"}.`;
  }
  const editButton = document.getElementById("editContentTemplateBtn");
  if (editButton) editButton.disabled = !selectedTemplate();
}

const ITEM_BEHAVIOUR_CONTROLS = {
  unlocksAccess: "contentUnlocksAccess",
  requiresCalendar: "contentRequiresCalendar",
  requiresSessionTime: "contentRequiresSessionTime",
  tracksSeats: "contentTracksSeats",
  requiresLocation: "contentRequiresLocation",
  requiresInstructor: "contentRequiresInstructor",
  issuesCertificate: "contentIssuesCertificate",
};

function itemBehaviourEnabled(key, defaults = selectedTemplate()?.defaults || {}) {
  const control = document.getElementById(ITEM_BEHAVIOUR_CONTROLS[key]);
  return control instanceof HTMLInputElement ? control.checked : defaults[key] === true;
}

function applyTemplateDrivenItemFields(defaults = selectedTemplate()?.defaults || {}) {
  document.querySelectorAll("#itemSpecificFields [data-template-visible], " +
    "#itemSpecificFields [data-template-visible-any]").forEach((field) => {
    const keys = String(field.dataset.templateVisible || field.dataset.templateVisibleAny || "")
      .split(/\s+/)
      .filter(Boolean);
    const visible = keys.some((key) => itemBehaviourEnabled(key, defaults));
    field.classList.toggle("hidden", !visible);
    field.querySelectorAll("input, select, textarea").forEach((input) => {
      input.required = false;
    });
  });
}

function validateTemplateDrivenItemFields() {
  if (currentRecordType() !== "item") return;
  const missing = [...document.querySelectorAll(
    "#itemSpecificFields [data-template-required='true']:not(.hidden)",
  )].find((field) => {
    const input = field.querySelector("input, select, textarea");
    return !String(input?.value || "").trim();
  });
  if (!missing) return;
  const label = missing.childNodes[0]?.textContent?.trim() || "Required template field";
  throw new Error(`${label} is required by the selected template.`);
}

function applyTemplateDefaults() {
  const currentValues = captureTemplateGuidedValues();
  const defaults = selectedTemplate()?.defaults || {};
  const recordType = document.getElementById("contentRecordType")?.value || "item";

  if (recordType === "item") {
    const shopProduct = document.getElementById("contentIsShopProduct");
    const requiresShipping = document.getElementById("contentRequiresShipping");
    const inventoryTracked = document.getElementById("contentInventoryTracked");
    const soldByRecoveryTools = document.getElementById("contentSoldByRecoveryTools");
    const requiresCalendar = document.getElementById("contentRequiresCalendar");
    const requiresSessionTime = document.getElementById("contentRequiresSessionTime");
    const tracksSeats = document.getElementById("contentTracksSeats");
    const unlocksAccess = document.getElementById("contentUnlocksAccess");
    const issuesCertificate = document.getElementById("contentIssuesCertificate");

    if (shopProduct) shopProduct.checked = defaults.isShopProduct === true;
    if (requiresShipping) requiresShipping.checked = defaults.requiresShipping === true;
    if (inventoryTracked) inventoryTracked.checked = defaults.inventoryTracked === true;
    if (soldByRecoveryTools) soldByRecoveryTools.checked = defaults.soldByRecoveryTools !== false;
    if (requiresCalendar) requiresCalendar.checked = defaults.requiresCalendar === true;
    if (requiresSessionTime) requiresSessionTime.checked = defaults.requiresSessionTime === true;
    if (tracksSeats) tracksSeats.checked = defaults.tracksSeats === true;
    if (unlocksAccess) unlocksAccess.checked = defaults.unlocksAccess === true;
    if (issuesCertificate) issuesCertificate.checked = defaults.issuesCertificate === true;
    applyTemplateDrivenItemFields(defaults);
  }
  if (recordType === "plan") {
    const issuesCertificate = document.getElementById("contentIssuesCertificate");
    if (issuesCertificate) issuesCertificate.checked = defaults.issuesCertificate === true;
  }
  renderTemplateGuidedFields();
  const recordValues = state.editingRecord ? templateFieldValuesForRecord(state.editingRecord) : {};
  restoreTemplateGuidedValues({
    ...currentValues,
    templateFieldValues: {
      ...recordValues,
      ...currentValues.templateFieldValues,
    },
  });
  if (recordType === "item") renderCurrentAssets(state.editingRecord);
  updateSaveWorkflow();
}

function renderRecordPill(record) {
  const typeStatus = [
    record.type || "No type",
    record.status || "",
  ].filter(Boolean).join(" | ");

  return `
    <div class="rounded border border-gray-700 bg-gray-950/50 p-2">
      <div class="font-medium text-white">${escapeHTML(record.name)}</div>
      <div class="mt-1 break-all text-xs text-gray-400">${escapeHTML(record.id)}</div>
      <div class="mt-1 text-xs text-gray-500">${escapeHTML(typeStatus)}</div>
    </div>
  `;
}

function renderSimilarRecord(record) {
  const typeStatus = [record.type || "No type", record.status || ""].filter(Boolean).join(" | ");
  const recordType = singularRecordType(record.recordType || currentRecordType());
  const useExistingAction = contentBuilderCreationStack.length
    ? `<button type="button"
        class="use-similar-content-record shrink-0 rounded border border-[#407471] px-3 py-2 text-xs font-medium text-[#9edbd7] hover:bg-[#407471]/20"
        data-record-type="${escapeHTML(recordType)}"
        data-record-id="${escapeHTML(record.id)}">
        Use existing
      </button>`
    : "";
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 rounded border border-yellow-700/70 bg-yellow-950/20 p-3">
      <div class="min-w-0">
        <div class="font-medium text-white">${escapeHTML(record.name)}</div>
        <div class="mt-1 break-all text-xs text-gray-400">${escapeHTML(record.id)}</div>
        <div class="mt-1 text-xs text-gray-400">${escapeHTML(typeStatus)}</div>
      </div>
      <div class="flex flex-wrap gap-2">
        ${useExistingAction}
        <button type="button"
          class="edit-similar-content-record shrink-0 rounded bg-[#407471] px-3 py-2 text-xs font-medium text-white hover:bg-[#305a56]"
          data-record-type="${escapeHTML(recordType)}"
          data-record-id="${escapeHTML(record.id)}">
          ${contentBuilderCreationStack.length ? "Edit and link" : "Edit instead"}
        </button>
      </div>
    </div>`;
}

function similarRecords(recordType, query) {
  const records = state.records[recordCollectionName(recordType)] || [];
  const cleanQuery = normalizedText(query);
  const editingId = state.editingRecord?.id || "";
  if (!cleanQuery) return [];

  return records
    .filter((record) => {
      if (editingId && record.id === editingId) return false;
      const name = normalizedText(record.name);
      return name === cleanQuery || name.includes(cleanQuery) || cleanQuery.includes(name);
    })
    .slice(0, 8);
}

function renderSimilarList() {
  const list = document.getElementById("contentSimilarList");
  if (!list) return;

  const recordType = document.getElementById("contentRecordType")?.value || "item";
  const query = document.getElementById("contentName")?.value || "";
  const matches = similarRecords(recordType, query);

  if (!query.trim()) {
    list.textContent = "Start typing a name.";
    return;
  }

  if (!matches.length) {
    list.innerHTML = `<p class="text-green-300">No similar ${escapeHTML(recordType)} records found.</p>`;
    return;
  }

  list.innerHTML = matches.map(renderSimilarRecord).join("");
}

function updateFormForRecordType() {
  const recordType = document.getElementById("contentRecordType")?.value || "item";
  const typeSelect = document.getElementById("contentType");
  fillSelect(
    typeSelect,
    state.options[typeOptionsKey(recordType)] || [],
    recordType,
  );
  updateTemplatesForType();
  if (!state.editingRecord) {
    setInputValue("contentStatus", "draft");
    setInputValue("contentVisibility", "private");
  }
  fillTagCategoryFilter();
  fillCategorySelect(document.getElementById("contentProductCategoryId"), true);
  if (!state.editingRecord) renderEntityVariantRows([]);

  document.getElementById("itemSpecificFields")?.classList.add("hidden");
  document.getElementById("advancedContentFields")?.classList.toggle("hidden", recordType === "item");
  document.getElementById("contentDuplicateWarning")?.classList.add("hidden");
  document.getElementById("confirmDuplicateContentBtn")?.classList.add("hidden");
  state.pendingPayload = null;
  state.duplicateWarningActive = false;
  updateBuilderFilterButtons(recordType);
  updateBuilderStepLabels();
  showBuilderStep(state.currentStep);
  renderSimilarList();
  renderRelationshipPickers();
  applyTypeDrivenFieldGroups();
  updateItemInventoryFields();
  updateProductRelationshipControl();
  document.getElementById("contentAudienceGoalFields")?.classList.toggle(
    "hidden",
    isProductManufactureBlueprint(),
  );
}

function updateProductRelationshipControl(role = "") {
  const isBlueprint = currentRecordType() === "blueprint";
  const roleInput = document.getElementById("contentProductLinkRole");
  const manufacturingRow = document.getElementById("contentProductManufacturingRoleRow");
  const manufacturingCheckbox = document.getElementById("contentProductManufacturingRecipe");
  const variantManufacturing = [...document.querySelectorAll(".variant-use-as-manufacturing")]
    .some((input) => input.checked);
  const resolvedRole = role || roleInput?.value || "Represents";
  const manufacturing = isBlueprint &&
    (resolvedRole === "ManufacturedFrom" || variantManufacturing || isProductManufactureBlueprint());
  manufacturingRow?.classList.add("hidden");
  if (manufacturingCheckbox) manufacturingCheckbox.checked = manufacturing;
  if (roleInput) roleInput.value = manufacturing ? "ManufacturedFrom" : "Represents";
  const productButton = document.getElementById("openVariantShopProductBtn");
  if (productButton) {
    productButton.textContent = manufacturing
      ? "Connect or edit manufacturing Product"
      : "Add or edit Shop Product";
  }
}

function updateEditBanner() {
  const banner = document.getElementById("contentBuilderEditBanner");
  const title = document.getElementById("contentBuilderEditTitle");
  const meta = document.getElementById("contentBuilderEditMeta");
  const saveButton = document.getElementById("saveContentBuilderBtn");
  const idInput = document.getElementById("contentId");
  const recordTypeSelect = document.getElementById("contentRecordType");

  if (!banner) return;

  const record = state.editingRecord;
  banner.classList.toggle("hidden", !record);
  if (title) title.textContent = record ? `Editing ${record.name || record.id}` : "Editing content record";
  if (meta) {
    meta.textContent = record
      ? `${record.recordType} | ${record.id}`
      : "";
  }
  if (saveButton) saveButton.textContent = "Save";
  if (idInput) {
    idInput.readOnly = !!record;
    idInput.classList.toggle("opacity-70", !!record);
  }
  if (recordTypeSelect) {
    recordTypeSelect.disabled = !!record;
    recordTypeSelect.classList.toggle("opacity-70", !!record);
  }
  updateSaveWorkflow();
}

function updateSaveWorkflow() {
  const note = document.getElementById("contentSaveWorkflowNote");
  const isProduct = isShopProductSelected();
  const websiteVisible = document.getElementById("contentWebsiteVisible")?.checked === true;
  if (!note) return;

  const messages = [
    "On Review, choose the status of each variant and the separate main entity status, then save them together. " +
      "Changing the main entity status does not silently replace the statuses selected for its variants.",
  ];
  if (isProduct) {
    messages.push(
      "Product creates or updates a Shop product. Once approved and visible, " +
      "it appears in the Recovery Tools marketplace.",
    );
  }
  if (websiteVisible) {
    messages.push(
      "Visible on website changes the Recovery Tools website after approval—for example, " +
      "an approved Anato-me story can appear in the Anato-me list.",
    );
  }
  note.innerHTML = messages.map((message) => `<p>${escapeHTML(message)}</p>`).join("");
}

function productRelationPayload() {
  if (!isShopProductSelected()) return null;
  syncSelectedProductVariantRows();
  populateGeneratedProductSku();
  const variants = parseProductVariants(document.getElementById("contentProductVariants")?.value);
  const productStatus = currentProductEditorStatus();
  variants.forEach((variant) => {
    const inheritsMarketplace = !variant.marketplaceMode || variant.marketplaceMode === "inherit";
    const canActivateWithProduct = ["draft", "review", "active"].includes(variant.status || "draft");
    if (inheritsMarketplace && productStatus === "active" && canActivateWithProduct) {
      variant.status = "active";
    }
  });
  variants.forEach((variant) => {
    const label = variant.name || variant.variantId || "Product variant";
    const incompleteBundleComponent = (variant.bundleComponents || []).find((component) =>
      !component.componentProductId || !component.componentProductVariantId);
    if (incompleteBundleComponent) {
      focusProductVariantSaveIssue(
        variant.variantId,
        "purchase",
        ".product-bundle-component-variant",
      );
      throw new Error(`Choose an exact linked Product variant for every inclusion in ${label}.`);
    }
    const selfBundleComponent = (variant.bundleComponents || []).find((component) =>
      component.componentProductId === currentProductId() &&
      component.componentProductVariantId === variant.variantId);
    if (selfBundleComponent) {
      focusProductVariantSaveIssue(
        variant.variantId,
        "purchase",
        ".product-bundle-component-variant",
      );
      throw new Error(`${label} cannot include itself. Choose another exact Product variant.`);
    }
    if (["scheduled", "coming-soon"].includes(variant.marketplaceMode) && !variant.marketplaceStartsAt) {
      throw new Error(`Choose a marketplace start date for ${label}.`);
    }
    if (variant.marketplaceStartsAt && variant.marketplaceEndsAt &&
        variant.marketplaceEndsAt <= variant.marketplaceStartsAt) {
      throw new Error(`The marketplace end date for ${label} must be after its start date.`);
    }
    if (variant.saleStartsAt && variant.saleEndsAt && variant.saleEndsAt <= variant.saleStartsAt) {
      throw new Error(`The sale end date for ${label} must be after its start date.`);
    }
  });
  const variantInstructors = [...new Set(variants.map((variant) => variant.instructor).filter(Boolean))];
  const instructor = variantInstructors.length === 1 ? variantInstructors[0] : "";
  const fulfilmentEnabled = document.getElementById("contentProductHasPhysicalFulfilment")?.checked === true;
  const variantFulfilment = fulfilmentEnabled
    ? variants.map((variant) => variant.physicalFulfilment).filter((value) => value && value !== "none")
    : [];
  const physicalFulfilment = variantFulfilment.includes("shipping-or-pickup") ||
    variantFulfilment.includes("shipping") && variantFulfilment.includes("pickup")
    ? "shipping-or-pickup"
    : variantFulfilment[0] || "none";
  setInputValue("contentProductPhysicalFulfilment", physicalFulfilment);
  const requiresShipping =
    document.getElementById("contentProductRequiresShipping")?.checked === true ||
    variantFulfilment.some((value) => ["shipping", "shipping-or-pickup"].includes(value));
  const inventoryTracked =
    document.getElementById("contentProductInventoryTracked")?.checked === true;
  const affiliateAvailable =
    document.getElementById("contentProductAvailableToAffiliates")?.checked === true;
  const wholesalePrice = optionalNumberFromInput("contentProductWholesalePrice");
  if (affiliateAvailable && wholesalePrice === null) {
    throw new Error("Enter the default Affiliate wholesale price, then add variant overrides only where needed.");
  }
  const totalVariantStock = variants.reduce((total, variant) => total + Number(variant.stock || 0), 0);
  setInputValue("contentProductStock", inventoryTracked ? totalVariantStock : "");
  const linkRole = document.getElementById("contentProductLinkRole")?.value || "Represents";
  const manufacturingLink = currentRecordType() === "blueprint" && linkRole === "ManufacturedFrom";
  const marketplaceMode = document.getElementById("contentProductMarketplaceMode")?.value || "hidden";
  const marketplaceStartsAt = document.getElementById("contentProductMarketplaceStartsAt")?.value || "";
  const marketplaceEndsAt = document.getElementById("contentProductMarketplaceEndsAt")?.value || "";
  const saleStartsAt = document.getElementById("contentProductSaleStartsAt")?.value || "";
  const saleEndsAt = document.getElementById("contentProductSaleEndsAt")?.value || "";
  const tileImageValue = document.getElementById("contentProductTileImageSource")?.value || "entity";
  const tileDescriptionValue = document.getElementById("contentProductTileDescriptionSource")?.value || "entity";
  if (["scheduled", "coming-soon"].includes(marketplaceMode) && !marketplaceStartsAt) {
    throw new Error("Choose a marketplace start date for a scheduled or Coming soon Product.");
  }
  if (marketplaceStartsAt && marketplaceEndsAt && marketplaceEndsAt <= marketplaceStartsAt) {
    throw new Error("The marketplace end date must be after its start date.");
  }
  if (saleStartsAt && saleEndsAt && saleEndsAt <= saleStartsAt) {
    throw new Error("The sale end date must be after its start date.");
  }
  const variantContentLinks = productVariantContentLinksFromRows();
  const accessGrants = productUnlocksFromRows();
  if (variantContentLinks.some((link) => !link.productVariantId)) {
    throw new Error("Choose an exact Product variant for every manufacturing or operations Blueprint.");
  }
  if (accessGrants.some((grant) => !grant.productVariantId)) {
    throw new Error("Choose an exact Product variant for every unlock after purchase.");
  }
  return {
    existingProductId: document.getElementById("contentExistingProductId")?.value || "",
    productId: document.getElementById("contentProductId")?.value || "",
    linkRole,
    sku: document.getElementById("contentProductSku")?.value || generatedProductSku(),
    productCategoryId: document.getElementById("contentProductCategoryId")?.value || "",
    productType: document.getElementById("contentProductDeliveryType")?.value || "Physical",
    physicalFulfilment,
    shopStatus: document.getElementById("contentProductShopStatus")?.value || "draft",
    effectiveShopPrice: optionalNumberFromInput("contentProductPrice"),
    stock: inventoryTracked ? totalVariantStock : null,
    visible: ["active", "coming-soon"].includes(marketplaceMode),
    marketplaceMode,
    marketplaceAudience: document.getElementById("contentProductMarketplaceAudience")?.value || "public",
    marketplaceStartsAt: isoFromDatetimeLocal(marketplaceStartsAt),
    marketplaceEndsAt: isoFromDatetimeLocal(marketplaceEndsAt),
    marketplaceTileImageSource: tileImageValue.startsWith("variant:") ? "product-variant" : "entity",
    marketplaceTileImageVariantId: tileImageValue.startsWith("variant:")
      ? tileImageValue.slice("variant:".length) : "",
    marketplaceTileDescriptionSource: tileDescriptionValue.startsWith("variant:")
      ? "product-variant" : "entity",
    marketplaceTileDescriptionVariantId: tileDescriptionValue.startsWith("variant:")
      ? tileDescriptionValue.slice("variant:".length) : "",
    retailPrice: optionalNumberFromInput("contentProductPrice"),
    taxClass: document.getElementById("contentProductTaxClass")?.value || "gst-taxable",
    salePrice: optionalNumberFromInput("contentProductSalePrice"),
    wholesalePrice: affiliateAvailable ? wholesalePrice : null,
    wholesaleMinQuantity: affiliateAvailable
      ? optionalNumberFromInput("contentProductWholesaleMinQuantity") || 1 : 1,
    affiliateAvailable,
    fulfilmentReviewed: document.getElementById("contentProductFulfilmentSection")
      ?.dataset.reviewed === "true",
    saleStartsAt: isoFromDatetimeLocal(saleStartsAt),
    saleEndsAt: isoFromDatetimeLocal(saleEndsAt),
    featured: document.getElementById("contentProductFeatured")?.checked === true,
    archived: document.getElementById("contentProductArchived")?.checked === true,
    requiresShipping,
    inventoryTracked,
    requiresCalendar: document.getElementById("contentProductRequiresCalendar")?.checked === true,
    requiresSessionTime: document.getElementById("contentProductRequiresSessionTime")?.checked === true,
    tracksSeats: document.getElementById("contentProductTracksSeats")?.checked === true,
    requiresLocation: document.getElementById("contentProductRequiresLocation")?.checked === true,
    requiresInstructor: document.getElementById("contentProductRequiresInstructor")?.checked === true,
    instructor,
    activePriceId: state.editingRecord?.activePriceId || "",
    variants,
    manufacturingBlueprintId: manufacturingLink
      ? document.getElementById("contentId")?.value || state.editingRecord?.id || ""
      : document.getElementById("contentProductBlueprintId")?.value || "",
    estimatedUnitCost: updateConnectedProductCostPreview(),
    variantContentLinks,
    accessGrants,
  };
}

function renderExistingProductOptions(selectedId = "") {
  const select = document.getElementById("contentExistingProductId");
  if (!select) return;
  const products = state.records.products || [];
  select.innerHTML = [
    "<option value=\"\">Create a new Product</option>",
    ...products.map((product) => `
      <option value="${escapeHTML(product.id)}"${product.id === selectedId ? " selected" : ""}>
        ${escapeHTML(product.name || product.id)} (${escapeHTML(product.productType || "Product")})
      </option>
    `),
  ].join("");
  renderProductChoiceList(document.getElementById("contentProductSearch")?.value || "", selectedId);
}

function productVariantLabel(variant) {
  return [variant.name, variant.colour, variant.size, variant.sizeLabel, variant.sku]
    .filter(Boolean)
    .join(" / ");
}

function renderProductChoiceList(query = "", selectedId = "") {
  const list = document.getElementById("contentProductChoiceList");
  if (!list) return;
  const normalizedQuery = normalizedType(query);
  const products = (state.records.products || []).filter((product) => {
    const searchable = [
      product.id,
      product.name,
      product.productType,
      product.sku,
      ...(product.variants || []).flatMap((variant) => [
        variant.id, variant.variantId, productVariantLabel(variant),
      ]),
    ].join(" ").toLowerCase();
    return !normalizedQuery || searchable.includes(normalizedQuery);
  });
  const currentId = selectedId || document.getElementById("contentExistingProductId")?.value || "";
  list.innerHTML = products.length ? products.map((product) => {
    const variants = (product.variants || []).map(productVariantLabel).filter(Boolean);
    const selected = product.id === currentId;
    const choiceClass = selected
      ? "border-[#8f6ad8] bg-[#2a1d45]"
      : "border-gray-700 bg-gray-950 hover:border-[#407471]";
    return `
      <button
        type="button"
        data-product-choice="${escapeHTML(product.id)}"
        class="w-full rounded border p-3 text-left ${choiceClass}"
      >
        <span class="block font-semibold text-white">${escapeHTML(product.name || product.id)}</span>
        <span class="mt-1 block text-xs text-gray-400">
          ${escapeHTML([product.id, product.productType, product.sku].filter(Boolean).join(" / "))}
        </span>
        <span class="mt-1 block text-xs text-gray-300">
          ${variants.length ? escapeHTML(`Variants: ${variants.join("; ")}`) : "No variants recorded"}
        </span>
      </button>
    `;
  }).join("") : "<p class=\"text-xs text-gray-400\">No existing products match this search.</p>";
}

function chooseExistingProduct(productId) {
  const product = (state.records.products || []).find((candidate) => candidate.id === productId);
  if (!product) return;
  setSelectValue("contentExistingProductId", product.id);
  setInputValue("contentProductId", product.id);
  const productIdInput = document.getElementById("contentProductId");
  if (productIdInput) {
    productIdInput.readOnly = true;
    productIdInput.classList.add("cursor-not-allowed", "opacity-70");
  }
  const productIdHelp = document.getElementById("contentProductIdHelp");
  if (productIdHelp) productIdHelp.textContent = "Product IDs cannot be changed after creation.";
  setInputValue("contentProductSku", product.sku);
  setSelectValue("contentProductCategoryId", product.productCategoryId);
  setSelectValue("contentProductDeliveryType", productDeliveryControlValue(
    product.productType,
    product.requiresShipping,
  ));
  setInputValue(
    "contentProductPhysicalFulfilment",
    product.physicalFulfilment || (product.requiresShipping ? "shipping" : "none"),
  );
  setCheckboxValue(
    "contentProductHasPhysicalFulfilment",
    product.physicalFulfilment && product.physicalFulfilment !== "none" ||
      product.requiresShipping === true ||
      (product.variants || []).some((variant) => variant.physicalFulfilment && variant.physicalFulfilment !== "none"),
  );
  setCheckboxValue("contentProductRequiresShipping", product.requiresShipping === true);
  setCheckboxValue("contentProductInventoryTracked", product.inventoryTracked === true);
  setCheckboxValue(
    "contentProductAvailableToAffiliates",
    product.affiliateAvailable === true ||
      product.affiliateAvailable === undefined &&
        (Number(product.wholesalePrice) > 0 ||
          (product.variants || []).some((variant) => Number(variant.wholesalePrice) > 0)),
  );
  setCheckboxValue("contentProductRequiresCalendar", product.requiresCalendar === true);
  setCheckboxValue("contentProductRequiresSessionTime", product.requiresSessionTime === true);
  setCheckboxValue("contentProductTracksSeats", product.tracksSeats === true);
  setCheckboxValue("contentProductRequiresLocation", product.requiresLocation === true);
  setCheckboxValue("contentProductRequiresInstructor", product.requiresInstructor === true);
  setSelectValue("contentProductShopStatus", product.shopStatus || product.status || "draft");
  if (currentRecordType() === "blueprint") {
    setInputValue("contentProductLinkRole", "ManufacturedFrom");
    updateProductRelationshipControl("ManufacturedFrom");
    renderProductBlueprintOptions(document.getElementById("contentId")?.value || state.editingRecord?.id || "");
  } else {
    updateProductRelationshipControl("Represents");
    renderProductBlueprintOptions(product.manufacturingBlueprintId || "");
  }
  setInputValue("contentProductStock", product.stock ?? 0);
  setCheckboxValue("contentProductVisible", product.visible);
  setSelectValue(
    "contentProductMarketplaceMode",
    product.marketplaceMode || (product.visible ? "active" : "hidden"),
  );
  setSelectValue("contentProductMarketplaceAudience", product.marketplaceAudience || "public");
  setInputValue("contentProductMarketplaceStartsAt", datetimeLocalValue(product.marketplaceStartsAt));
  setInputValue("contentProductMarketplaceEndsAt", datetimeLocalValue(product.marketplaceEndsAt));
  setInputValue("contentProductPrice", product.retailPrice ?? product.price ?? "");
  setSelectValue("contentProductTaxClass", product.taxClass || "gst-taxable");
  setInputValue("contentProductSalePrice", product.salePrice ?? "");
  setInputValue("contentProductWholesalePrice", product.wholesalePrice ?? "");
  setInputValue("contentProductWholesaleMinQuantity", product.wholesaleMinQuantity ?? 1);
  setInputValue("contentProductSaleStartsAt", datetimeLocalValue(product.saleStartsAt));
  setInputValue("contentProductSaleEndsAt", datetimeLocalValue(product.saleEndsAt));
  setCheckboxValue("contentProductFeatured", product.featured);
  setCheckboxValue("contentProductArchived", product.archived);
  state.retainedProductVariantContentLinks = (product.variantContentLinks || [])
    .filter((link) => !["ManufacturedFrom", "OperatedWith"].includes(link.linkRole));
  setInputValue("contentProductVariants", serializeProductVariants(product.variants || []));
  hydrateMarketplaceTileControls(product);
  const fulfilmentSection = document.getElementById("contentProductFulfilmentSection");
  if (fulfilmentSection) {
    fulfilmentSection.dataset.reviewed = String(product.fulfilmentReviewed === true);
  }
  populateProductVariantsFromEntity();
  renderProductBlueprintOptions(product.manufacturingBlueprintId || "");
  renderProductVariantContentLinkRows(product.variantContentLinks || []);
  renderProductUnlockRows(product.accessGrants || []);
  updateProductRelationStatus({ productId: product.id });
  renderProductChoiceList(document.getElementById("contentProductSearch")?.value || "", product.id);
  state.isDirty = true;
  renderBuilderSummaries();
  updateProductPhysicalFields();
}

function chooseNewProduct() {
  // Reaching this action means the admin has explicitly chosen to create a Product.
  // Keep the underlying relationship enabled even when the source entity/template
  // did not previously mark itself as a shop Product.
  setCheckboxValue("contentIsShopProduct", true);
  const linkedProductId = document.getElementById("contentProductId")?.value || state.editingRecord?.productId || "";
  if (linkedProductId) setInputValue("contentUnlinkProductId", linkedProductId);
  setSelectValue("contentExistingProductId", "");
  setInputValue("contentProductId", "");
  const productIdInput = document.getElementById("contentProductId");
  if (productIdInput) {
    productIdInput.readOnly = false;
    productIdInput.classList.remove("cursor-not-allowed", "opacity-70");
  }
  const productIdHelp = document.getElementById("contentProductIdHelp");
  if (productIdHelp) productIdHelp.textContent = "Set once when creating a Product.";
  setInputValue("contentProductSku", "");
  setSelectValue("contentProductCategoryId", "");
  setSelectValue("contentProductDeliveryType", "Physical");
  setInputValue("contentProductPhysicalFulfilment", "none");
  setCheckboxValue("contentProductHasPhysicalFulfilment", false);
  updateProductRelationshipControl("Represents");
  ["contentProductRequiresShipping", "contentProductInventoryTracked", "contentProductAvailableToAffiliates",
    "contentProductRequiresCalendar",
    "contentProductRequiresSessionTime", "contentProductTracksSeats", "contentProductRequiresLocation",
    "contentProductRequiresInstructor"].forEach((id) => setCheckboxValue(id, false));
  setSelectValue("contentProductShopStatus", "draft");
  setSelectValue("contentProductMarketplaceMode", "hidden");
  setSelectValue("contentProductMarketplaceAudience", "public");
  setSelectValue("contentProductTaxClass", "gst-taxable");
  ["contentProductMarketplaceStartsAt", "contentProductMarketplaceEndsAt", "contentProductPrice",
    "contentProductSalePrice", "contentProductWholesalePrice", "contentProductWholesaleMinQuantity",
    "contentProductSaleStartsAt", "contentProductSaleEndsAt"]
    .forEach((id) => setInputValue(id, ""));
  setInputValue("contentProductWholesaleMinQuantity", 1);
  setInputValue(
    "contentProductStock",
    currentRecordType() === "item" ? state.editingRecord?.itemStock ?? "" : "",
  );
  setCheckboxValue("contentProductVisible", false);
  setCheckboxValue("contentProductFeatured", false);
  setCheckboxValue("contentProductArchived", false);
  setInputValue("contentProductVariants", "");
  hydrateMarketplaceTileControls({});
  const fulfilmentSection = document.getElementById("contentProductFulfilmentSection");
  if (fulfilmentSection) fulfilmentSection.dataset.reviewed = "false";
  state.retainedProductVariantContentLinks = [];
  populateProductVariantsFromEntity();
  renderProductVariantContentLinkRows([]);
  renderProductBlueprintOptions("");
  renderProductUnlockRows([]);
  updateProductRelationStatus(null);
  renderProductChoiceList(document.getElementById("contentProductSearch")?.value || "");
  state.isDirty = true;
  updateProductPhysicalFields();
}

function productEntityCandidates() {
  return [
    ["item", state.records.items || []],
    ["blueprint", state.records.blueprints || []],
    ["plan", state.records.plans || []],
  ].flatMap(([recordType, records]) => records.map((record) => ({ ...record, recordType })))
    .filter((record) => !record.productId && !record.itemProductId && record.archived !== true);
}

function fillProductEntitySubtypeFilter() {
  const select = document.getElementById("contentProductEntitySubtypeFilter");
  if (!select) return;
  const current = select.value || "all";
  const area = document.getElementById("contentProductEntityTypeFilter")?.value || "all";
  const types = uniqueValues(productEntityCandidates()
    .filter((record) => area === "all" || record.recordType === area)
    .map((record) => record.type)
    .filter(Boolean))
    .sort((left, right) => left.localeCompare(right));
  select.innerHTML = `<option value="all">All types</option>${types.map((type) =>
    `<option value="${escapeHTML(normalizedType(type))}">${escapeHTML(type)}</option>`).join("")}`;
  select.value = [...select.options].some((option) => option.value === current) ? current : "all";
}

function renderProductEntityChoices() {
  const list = document.getElementById("contentProductEntityChoiceList");
  if (!list) return;
  const query = normalizedText(document.getElementById("contentProductEntitySearch")?.value || "");
  const area = document.getElementById("contentProductEntityTypeFilter")?.value || "all";
  const subtype = document.getElementById("contentProductEntitySubtypeFilter")?.value || "all";
  const records = productEntityCandidates().filter((record) => {
    if (area !== "all" && record.recordType !== area) return false;
    if (subtype !== "all" && normalizedType(record.type) !== subtype) return false;
    const searchable = [record.name, record.id, record.type, record.shortDescription,
      ...(record.tags || [])].join(" ");
    return !query || normalizedText(searchable).includes(query);
  });
  list.innerHTML = records.length ? records.map((record) => `
    <button type="button" data-product-entity-type="${escapeHTML(record.recordType)}"
      data-product-entity-id="${escapeHTML(record.id)}"
      class="block w-full rounded border border-gray-700 bg-gray-950 p-3 text-left hover:border-[#407471] hover:bg-[#153b38]/30">
      <span class="block font-semibold text-white">${escapeHTML(record.name || record.id)}</span>
      <span class="mt-1 block text-xs text-gray-400">${escapeHTML(
    [record.recordType, record.type, record.id].filter(Boolean).join(" / "),
  )}</span>
      ${record.shortDescription ? `<span class="mt-1 block text-xs text-gray-300">${escapeHTML(record.shortDescription)}</span>` : ""}
    </button>`).join("") : `<p class="rounded border border-gray-800 bg-gray-950/60 p-3 text-sm text-gray-400">No unlinked entities match these filters.</p>`;
}

function setProductEntityPickerOpen(open) {
  document.getElementById("contentProductEntityPicker")?.classList.toggle("hidden", !open);
  const saveButton = document.getElementById("applyContentProductBtn");
  if (saveButton) saveButton.disabled = open;
  if (open) {
    fillProductEntitySubtypeFilter();
    renderProductEntityChoices();
  }
}

function chooseProductEntity(recordType, recordId) {
  const record = findRecord(recordType, recordId);
  if (!record) {
    showToast("That entity could not be loaded. Refresh and try again.", "error");
    return;
  }
  const productId = pendingStandaloneProductId;
  populateBuilderFromRecord(record);
  setCheckboxValue("contentIsShopProduct", true);
  const variants = entityVariantsFromBuilder();
  if (!productId && variants[0]) {
    variants[0].shopEnabled = true;
    renderEntityVariantRows(variants);
  }
  if (productId) chooseExistingProduct(productId);
  else chooseNewProduct();
  pendingStandaloneProductId = "";
  setProductEntityPickerOpen(false);
  updateProductRelationStatus(productId ? { productId } : null);
  showToast(`${record.name || record.id} connected. Complete the Product and save when ready.`, "success");
}

function openContentProductDrawer() {
  const drawer = document.getElementById("contentProductDrawer");
  if (!drawer) return;
  setProductSaveFeedback("", "");
  if (!drawer.contains(document.activeElement) && document.activeElement !== document.body) {
    productDrawerReturnFocus = document.activeElement;
  }
  if (drawer.parentElement !== document.body) document.body.appendChild(drawer);
  drawer.inert = false;
  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");
  updateProductRelationshipControl();
  renderProductChoiceList(document.getElementById("contentProductSearch")?.value || "");
  populateGeneratedProductSku();
  renderProductBlueprintOptions(
    document.getElementById("contentProductBlueprintId")?.value || state.editingRecord?.manufacturingBlueprintId || "",
  );
  populateProductVariantsFromEntity();
  updateConnectedProductCostPreview();
  updateProductPhysicalFields();
  if (!document.getElementById("contentProductEntityPicker")?.classList.contains("hidden")) {
    document.getElementById("contentProductEntitySearch")?.focus();
  } else if (!document.getElementById("contentProductConnectionPicker")?.classList.contains("hidden")) {
    document.getElementById("contentProductSearch")?.focus();
  }
}

export async function openProductDrawerFromAdmin({ productId, entityType, entityId }) {
  await setupContentBuilder();
  const record = findRecord(entityType, entityId);
  if (!record) throw new Error("The Product's connected content record could not be loaded.");
  populateBuilderFromRecord(record);
  setProductEntityPickerOpen(false);
  if (productId) chooseExistingProduct(productId);
  else chooseNewProduct();
  state.isDirty = false;
  openContentProductDrawer();
}

export async function openNewProductDrawerFromAdmin({ productId = "" } = {}) {
  await setupContentBuilder();
  pendingStandaloneProductId = productId;
  setInputValue("contentProductEntitySearch", "");
  setSelectValue("contentProductEntityTypeFilter", "all");
  setSelectValue("contentProductEntitySubtypeFilter", "all");
  setProductEntityPickerOpen(true);
  openContentProductDrawer();
}

function orderProductDrawerSections() {
  const variants = document.getElementById("contentProductVariantsSection");
  const fulfilment = document.getElementById("contentProductPhysicalFulfilment")?.closest("details");
  const manufacturing = document.getElementById("contentProductBlueprintId")?.closest("details");
  const unlocks = document.getElementById("contentProductUnlockRows")?.closest("section");
  const variantConnections = document.getElementById("contentVariantOwnedConnections");
  if (!variants || !fulfilment) return;
  if (fulfilment.nextElementSibling !== variants) variants.before(fulfilment);
  if (variantConnections && manufacturing && manufacturing.parentElement !== variantConnections) {
    variantConnections.appendChild(manufacturing);
  }
  if (variantConnections && unlocks && unlocks.parentElement !== variantConnections) {
    variantConnections.appendChild(unlocks);
  }
  const connectionFooter = document.getElementById("contentVariantOwnedConnectionsFooter");
  if (variantConnections && connectionFooter) variantConnections.appendChild(connectionFooter);
  const drawerBody = document.querySelector("#contentProductDrawer > div");
  [...(drawerBody?.children || [])].filter((child) => child.tagName === "DETAILS")
    .forEach((details) => details.setAttribute("name", "product-editor-section"));
}

function closeContentProductDrawer() {
  const drawer = document.getElementById("contentProductDrawer");
  if (!drawer) return;
  if (drawer.contains(document.activeElement)) document.activeElement.blur();
  drawer.inert = true;
  drawer.classList.add("hidden");
  drawer.setAttribute("aria-hidden", "true");
  setProductEntityPickerOpen(false);
  pendingStandaloneProductId = "";
  const returnFocusTo = productDrawerReturnFocus;
  productDrawerReturnFocus = null;
  if (returnFocusTo?.isConnected) {
    requestAnimationFrame(() => returnFocusTo.focus({ preventScroll: true }));
  }
}

function generatedProductSku() {
  const source = document.getElementById("contentProductId")?.value ||
    document.getElementById("contentId")?.value ||
    document.getElementById("contentName")?.value || "PRODUCT";
  const token = String(source)
    .trim()
    .replace(/^(PROD|PRODUCT|ITEM|BLUEPRINT|PLAN)[-_]/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
  return `RT-${token || "PRODUCT"}`;
}

function populateGeneratedProductSku() {
  const sku = document.getElementById("contentProductSku");
  if (sku && !sku.value.trim()) sku.value = generatedProductSku();
}

function productDeliveryControlValue(productType) {
  return productType || "Physical";
}

function updateProductPhysicalFields() {
  const physicalFulfilmentEnabled =
    document.getElementById("contentProductHasPhysicalFulfilment")?.checked === true;
  if (!physicalFulfilmentEnabled) {
    document.querySelectorAll(".product-variant-physical-fulfilment").forEach((select) => {
      select.value = "none";
    });
    setInputValue("contentProductPhysicalFulfilment", "none");
  }
  const tracked = document.getElementById("contentProductInventoryTracked")?.checked === true;
  const affiliateAvailable =
    document.getElementById("contentProductAvailableToAffiliates")?.checked === true;
  document.querySelectorAll(
    ".content-product-affiliate-pricing-field, .product-variant-affiliate-pricing-field",
  ).forEach((field) => field.classList.toggle("hidden", !affiliateAvailable));
  document.getElementById("contentProductRequiresShipping")?.closest("label")?.classList.remove("hidden");
  document.getElementById("contentProductInventoryTrackedField")?.classList.remove("hidden");
  document.getElementById("contentProductInventoryHelp")?.classList.remove("hidden");
  document.querySelectorAll(".product-variant-stock-field").forEach((field) => {
    field.classList.toggle("hidden", !tracked);
  });
  document.querySelectorAll(".product-variant-physical-fulfilment-field").forEach((field) => {
    field.classList.toggle("hidden", !physicalFulfilmentEnabled);
  });
  const calendar = document.getElementById("contentProductRequiresCalendar")?.checked === true;
  const seats = document.getElementById("contentProductTracksSeats")?.checked === true;
  const timing = document.getElementById("contentProductRequiresSessionTime")?.checked === true;
  const location = document.getElementById("contentProductRequiresLocation")?.checked === true;
  const instructor = document.getElementById("contentProductRequiresInstructor")?.checked === true;
  document.querySelectorAll(".product-variant-calendar-field").forEach((field) => {
    field.classList.toggle("hidden", !calendar);
  });
  document.querySelectorAll(".product-variant-seats-field").forEach((field) => {
    field.classList.toggle("hidden", !seats);
  });
  document.querySelectorAll(".product-variant-session-field").forEach((field) => {
    field.classList.toggle("hidden", !timing);
  });
  document.querySelectorAll(".product-variant-location-field").forEach((field) => {
    field.classList.toggle("hidden", !location);
  });
  document.querySelectorAll(".product-variant-instructor-field").forEach((field) => {
    field.classList.toggle("hidden", !instructor);
  });
  if (!tracked) setInputValue("contentProductStock", "");
  const summary = document.getElementById("contentProductFulfilmentSummary");
  if (summary) {
    const labels = [
      physicalFulfilmentEnabled ? "Physical fulfilment" : "",
      document.getElementById("contentProductRequiresShipping")?.checked ? "Requires shipping" : "",
      tracked ? "Tracked inventory" : "",
      affiliateAvailable ? "Available to affiliates" : "",
      calendar ? "Calendar" : "",
      timing ? "Session time" : "",
      seats ? "Tickets/seats" : "",
      location ? "Location" : "",
      instructor ? "Instructor" : "",
    ].filter(Boolean);
    summary.textContent = labels.length ? labels.join(" • ") : "No fulfilment requirements selected";
  }
}

function updateItemInventoryFields() {
  const tracked = currentRecordType() === "item" &&
    document.getElementById("contentInventoryTracked")?.checked === true;
  document.getElementById("contentItemInventoryFields")?.classList.toggle("hidden", !tracked);
}

function productUnlockOptions(entityType) {
  const key = `${normalizedType(entityType)}s`;
  return state.records[key] || [];
}

function contentRecordForProduct(product = {}) {
  const productId = product.id || product.productId || "";
  const directType = singularRecordType(
    product.entityType || product.contentEntityType || product.sourceEntityType || "",
  );
  const directId = product.entityId || product.contentEntityId || product.sourceEntityId || "";
  const direct = directType && directId ? findRecord(directType, directId) : null;
  if (direct) return direct;
  return ["item", "blueprint", "plan"].flatMap((recordType) =>
    (state.records[recordCollectionName(recordType)] || []).map((record) => ({
      ...record,
      recordType,
    }))).find((record) =>
    [record.productId, record.itemProductId].filter(Boolean).includes(productId));
}

function productUnlockTargetVariants(entityType, entityId) {
  const target = productUnlockOptions(entityType).find((record) => record.id === entityId);
  return Array.isArray(target?.entityVariants) ? target.entityVariants : [];
}

function currentProductVariants() {
  return parseProductVariants(document.getElementById("contentProductVariants")?.value);
}

function syncProductArchivedFromVariants(variants = currentProductVariants()) {
  const archivedInput = document.getElementById("contentProductArchived");
  if (!archivedInput || !variants.length) return;
  const allArchived = variants.every((variant) => variant.status === "archived");
  const wasChecked = archivedInput.checked;
  if (allArchived) {
    archivedInput.checked = true;
    archivedInput.dataset.autoArchived = "true";
  } else if (archivedInput.dataset.autoArchived === "true") {
    archivedInput.checked = false;
    delete archivedInput.dataset.autoArchived;
  }
  if (wasChecked !== archivedInput.checked) {
    renderMarketplaceTileControls();
    refreshMarketplacePreviews();
  }
}

function bundleProductOptions(selectedProductId = "") {
  const currentProductId = document.getElementById("contentProductId")?.value ||
    document.getElementById("contentExistingProductId")?.value || "";
  const products = [...(state.records.products || [])];
  if (currentProductId) {
    const draftProduct = {
      id: currentProductId,
      name: document.getElementById("contentName")?.value || currentProductId,
      variants: currentProductVariants(),
    };
    const index = products.findIndex((product) => product.id === currentProductId);
    if (index >= 0) products[index] = { ...products[index], ...draftProduct };
    else products.push(draftProduct);
  }
  return products.map((product) => {
    const selected = product.id === selectedProductId ? " selected" : "";
    return `<option value="${escapeHTML(product.id)}"${selected}>${escapeHTML(product.name || product.id)}</option>`;
  }).join("");
}

function marketplaceAssetOptions(selectedValue = [], type = "", placeholder = "") {
  const selected = new Set(Array.isArray(selectedValue) ? selectedValue : [selectedValue].filter(Boolean));
  const options = (state.records.assets || []).filter((asset) => {
    const assetType = normalizedText(asset.assetType || asset.type);
    return !type || assetType.includes(type) || type === "video" && (asset.embedUrl || asset.youtubeUrl);
  }).map((asset) => {
    const id = asset.assetId || asset.id;
    return `<option value="${escapeHTML(id)}"${selected.has(id) ? " selected" : ""}>${escapeHTML(asset.title || asset.name || id)}</option>`;
  }).join("");
  return `${placeholder ? `<option value="">${escapeHTML(placeholder)}</option>` : ""}${options}`;
}

function promotionSelectedAssetsMarkup(assetIds = []) {
  const selected = new Set(assetIds);
  const assets = (state.records.assets || []).filter((asset) =>
    selected.has(asset.assetId || asset.id));
  return assets.length
    ? assets.map((asset) => `<div class="flex items-center justify-between gap-3 rounded bg-gray-950 px-3 py-2 text-sm">
      <span>${escapeHTML(asset.title || asset.assetName || asset.name || asset.id)}</span>
      <button type="button" class="remove-product-variant-promotion-asset text-xs text-red-200 hover:text-red-100"
        data-asset-id="${escapeHTML(asset.assetId || asset.id)}">Remove</button>
    </div>`).join("")
    : "<p class=\"text-xs text-gray-400\">No promotion videos attached.</p>";
}

function refreshPromotionAssetSelection(row) {
  const selectedIds = [...(row?.querySelector(".product-variant-promotion-assets")?.selectedOptions || [])]
    .map((option) => option.value).filter(Boolean);
  const list = row?.querySelector(".product-variant-promotion-selection");
  if (list) list.innerHTML = promotionSelectedAssetsMarkup(selectedIds);
}

function marketplaceTileSourceOptions(selectedValue = "entity") {
  const variants = currentProductVariants();
  return [
    `<option value="entity"${selectedValue === "entity" ? " selected" : ""}>Main entity / Product</option>`,
    ...variants.map((variant) => {
      const value = `variant:${variant.variantId}`;
      const selected = value === selectedValue ? " selected" : "";
      return `<option value="${escapeHTML(value)}"${selected}>Product variant — ${escapeHTML(variant.name || variant.variantId)}</option>`;
    }),
  ].join("");
}

function marketplaceTileSourceVariant(source = "") {
  if (!source.startsWith("variant:")) return null;
  const variantId = source.slice("variant:".length);
  return currentProductVariants().find((variant) => variant.variantId === variantId) || null;
}

function marketplacePreviewAttention(missing, extraClasses = "", tone = "required") {
  const tones = {
    required: "border border-purple-500 bg-purple-950/50 text-purple-100 ring-1 ring-purple-500/60",
    optional: "border border-blue-500 bg-blue-950/50 text-blue-100 ring-1 ring-blue-500/60",
    review: "border border-yellow-500 bg-yellow-950/50 text-yellow-100 ring-1 ring-yellow-500/60",
  };
  return `${extraClasses} ${missing ? tones[tone] || tones.required : ""}`.trim();
}

function marketplacePreviewStateOverlay(label, tone = "purple", editorTarget = "") {
  if (!label) return "";
  const tones = {
    amber: "border-amber-400 text-amber-200",
    blue: "border-blue-400 text-blue-200",
    purple: "border-purple-400 text-purple-200",
    red: "border-red-400 text-red-300",
    gray: "border-gray-400 text-gray-200",
  };
  return `<div class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
    <button type="button" ${editorTarget} aria-label="Edit ${escapeHTML(label)} status"
      class="pointer-events-auto -rotate-12 rounded border-4 bg-gray-950/80 ${tones[tone] || tones.purple} px-5 py-2 text-2xl font-black uppercase tracking-widest shadow-xl">
      ${escapeHTML(label)}
    </button>
  </div>`;
}

function marketplacePreviewProductType(deliveryType = "") {
  const source = normalizedText([
    document.getElementById("contentType")?.value,
    currentRecordType(),
    deliveryType,
  ].filter(Boolean).join(" "));
  if (source.includes("workshop") || source.includes("event")) return "Workshop";
  if (source.includes("course")) return "Course";
  if (source.includes("program")) return "Program";
  if (source.includes("plan")) return "Plan";
  if (source.includes("service")) return "Service";
  return "Tool";
}

function isUnsavedProduct() {
  return !String(document.getElementById("contentExistingProductId")?.value || "").trim();
}

function marketplaceTilePreviewMarkup() {
  const imageSource = document.getElementById("contentProductTileImageSource")?.value || "entity";
  const descriptionSource = document.getElementById("contentProductTileDescriptionSource")?.value || "entity";
  const imageVariant = marketplaceTileSourceVariant(imageSource);
  const descriptionVariant = marketplaceTileSourceVariant(descriptionSource);
  const entityVariant = entityVariantsFromBuilder()[0] || {};
  const entityAssetId = primaryImageAssetIdForEntityVariant(entityVariant);
  const assetId = imageVariant?.primaryAssetId || entityAssetId;
  const asset = (state.records.assets || []).find((entry) => (entry.assetId || entry.id) === assetId);
  const imageUrl = externalUrl(asset?.fileUrl || asset?.url || "");
  const productName = document.getElementById("contentName")?.value || "";
  const description = descriptionVariant?.shortDescription ||
    document.getElementById("contentShortDescription")?.value || "";
  const price = optionalNumberFromInput("contentProductPrice");
  const salePrice = optionalNumberFromInput("contentProductSalePrice");
  const wholesalePrice = optionalNumberFromInput("contentProductWholesalePrice");
  const affiliateAvailable = document.getElementById("contentProductAvailableToAffiliates")?.checked === true;
  const productTypeSelect = document.getElementById("contentProductDeliveryType");
  const deliveryType = productTypeSelect?.value || "";
  const productType = marketplacePreviewProductType(deliveryType);
  const categorySelect = document.getElementById("contentProductCategoryId");
  const category = categorySelect?.value || "";
  const categoryLabel = categorySelect?.selectedOptions?.[0]?.textContent || "Set category";
  const featured = document.getElementById("contentProductFeatured")?.checked === true;
  const archived = document.getElementById("contentProductArchived")?.checked === true;
  const marketplaceMode = document.getElementById("contentProductMarketplaceMode")?.value || "hidden";
  const marketplaceListing = {
    active: { label: "Visible now", classes: "border-emerald-500 bg-emerald-950/95 text-emerald-100" },
    scheduled: { label: "Scheduled / hidden", classes: "border-amber-500 bg-amber-950/95 text-amber-100" },
    "coming-soon": { label: "Coming soon", classes: "border-purple-500 bg-purple-950/95 text-purple-100" },
    hidden: { label: "Hidden", classes: "border-purple-500 bg-purple-950/95 text-purple-100" },
  }[marketplaceMode] || { label: "Review required", classes: "border-purple-500 bg-purple-950/95 text-purple-100" };
  const marketplaceAudience = document.getElementById("contentProductMarketplaceAudience")?.value || "public";
  const shopStatus = document.getElementById("contentProductShopStatus")?.value || "draft";
  const inventoryTracked = document.getElementById("contentProductInventoryTracked")?.checked === true;
  const tracksSeats = document.getElementById("contentProductTracksSeats")?.checked === true;
  const allProductVariants = currentProductVariants();
  const sellableStockVariants = allProductVariants.filter((variant) =>
    variant.status === "active" &&
    ["inherit", "active"].includes(variant.marketplaceMode || "inherit"));
  const ticketVariantsWithAvailability = sellableStockVariants.filter((variant) =>
    variant.ticketsRemaining !== null && variant.ticketsRemaining !== undefined);
  const workshopSoldOut = tracksSeats && ticketVariantsWithAvailability.length > 0 &&
    ticketVariantsWithAvailability.every((variant) => Number(variant.ticketsRemaining) <= 0);
  const outOfStock = !tracksSeats && inventoryTracked && sellableStockVariants.length > 0 &&
    sellableStockVariants.every((variant) => Number(variant.stock ?? 0) <= 0);
  let previewState = archived
    ? { label: "Archived", target: "data-product-editor-target=\"contentProductArchived\"", tone: "red" }
    : workshopSoldOut
      ? { label: "Sold Out", target: "data-product-editor-target=\"contentProductTracksSeats\"", tone: "gray" }
      : outOfStock
        ? { label: "Out of Stock", target: "data-product-editor-target=\"contentProductHasPhysicalFulfilment\"", tone: "gray" }
        : shopStatus === "draft"
          ? { label: "Draft", target: "data-product-editor-target=\"contentProductMarketplaceMode\"", tone: "purple" }
          : shopStatus === "review"
            ? { label: "Review", target: "data-product-editor-target=\"contentProductMarketplaceMode\"", tone: "blue" }
            : marketplaceMode === "coming-soon"
              ? { label: "Coming Soon", target: "data-product-editor-target=\"contentProductMarketplaceMode\"", tone: "purple" }
              : ["hidden", "scheduled"].includes(marketplaceMode)
                ? { label: "Hidden", target: "data-product-editor-target=\"contentProductMarketplaceMode\"", tone: "amber" }
                : null;
  let active = !archived && marketplaceMode === "active" && shopStatus === "active";
  const fulfilmentLabels = [...new Set(currentProductVariants()
    .map((variant) => variant.physicalFulfilment)
    .filter((value) => value && value !== "none"))];
  const physicalFulfilment = fulfilmentLabels.length
    ? fulfilmentLabels.join(" / ").replaceAll("-", " ")
    : document.getElementById("contentProductHasPhysicalFulfilment")?.checked === true
      ? "Physical fulfilment enabled" : "No physical fulfilment";
  const fulfilmentMissing = !deliveryType ||
    ["Physical", "Hybrid"].includes(deliveryType) && physicalFulfilment === "No physical fulfilment";
  const fulfilmentReviewed = document.getElementById("contentProductFulfilmentSection")
    ?.dataset.reviewed === "true";
  const fulfilmentSelections = [
    document.getElementById("contentProductInventoryTracked")?.checked ? "Track inventory" : "",
    affiliateAvailable ? "Affiliate sales" : "",
    document.getElementById("contentProductHasPhysicalFulfilment")?.checked ? "Physical fulfilment" : "",
    document.getElementById("contentProductRequiresShipping")?.checked ? "Shipping required" : "",
    document.getElementById("contentProductRequiresCalendar")?.checked ? "Calendar booking" : "",
    document.getElementById("contentProductRequiresSessionTime")?.checked ? "Session timing" : "",
    document.getElementById("contentProductTracksSeats")?.checked ? "Track seats" : "",
    document.getElementById("contentProductRequiresLocation")?.checked ? "Location" : "",
    document.getElementById("contentProductRequiresInstructor")?.checked ? "Instructor" : "",
  ].filter(Boolean);
  const requiredFieldsComplete = !!imageUrl && !!productName && !!description &&
    (price !== null || salePrice !== null) && (!affiliateAvailable || wholesalePrice !== null) &&
    !!category && !!deliveryType && !fulfilmentMissing;
  if (isUnsavedProduct() && !requiredFieldsComplete) {
    previewState = null;
    active = false;
  }
  return `<div class="relative mx-auto max-w-sm rounded-lg bg-gray-800 p-4 shadow hover:ring-2 hover:ring-[#407471] ${active ? "ring-2 ring-green-500/80" : ""}">
    ${previewState
    ? marketplacePreviewStateOverlay(previewState.label, previewState.tone, previewState.target)
    : ""}
    <div class="relative">
      <button type="button" data-product-editor-target="contentProductTileImageSource"
        class="${marketplacePreviewAttention(!imageUrl, "flex h-48 w-full items-center justify-center overflow-hidden rounded bg-gray-950 text-xs text-gray-400 ring-[#407471] hover:ring-2")}">
        ${imageUrl
    ? `<img src="${escapeHTML(imageUrl)}" alt="${escapeHTML(productName || "Product")}" class="h-full w-full object-cover">`
    : "Set Marketplace image"}
      </button>
      <button type="button" data-product-editor-target="contentProductMarketplaceMode"
        class="absolute bottom-2 left-2 rounded border px-3 py-1.5 text-left text-xs font-semibold shadow-lg hover:ring-2 hover:ring-white/50 ${marketplaceListing.classes}">
        Marketplace listing: ${escapeHTML(marketplaceListing.label)}
      </button>
    </div>
    <button type="button" data-product-editor-target="contentProductDeliveryType"
      class="absolute right-2 top-2 rounded bg-[#407471] px-2 py-1 text-xs font-semibold text-white">${escapeHTML(productType)}</button>
    ${featured ? `<button type="button" data-product-editor-target="contentProductFeatured" class="absolute left-2 top-2 rounded bg-yellow-500 px-2 py-1 text-xs text-black">★ Featured</button>` : ""}
    <button type="button" data-product-editor-target="contentName"
      class="${marketplacePreviewAttention(!productName, "mt-2 block w-full rounded text-left text-lg font-semibold text-white hover:text-[#9edbd7]")}">${escapeHTML(productName || "Set Product name")}</button>
    <button type="button" data-product-editor-target="contentProductTileDescriptionSource"
      class="${marketplacePreviewAttention(!description, "mt-1 block w-full rounded text-left text-sm text-gray-300 hover:text-white")}">${escapeHTML(description || "Set short description")}</button>
    <div class="mt-1 flex items-center justify-between gap-3">
      <button type="button" data-product-editor-target="contentProductPrice"
        class="${marketplacePreviewAttention(price === null && salePrice === null, "rounded font-semibold text-green-300 hover:text-green-200")}">${salePrice !== null && price !== null ? `<span class="mr-2 text-gray-500 line-through">$${Number(price).toFixed(2)}</span><span class="font-bold text-green-400">$${Number(salePrice).toFixed(2)}</span>` : price !== null ? `$${Number(price).toFixed(2)}` : "Set price"}</button>
      ${affiliateAvailable ? `<button type="button" data-product-editor-target="contentProductWholesalePrice"
        class="${marketplacePreviewAttention(wholesalePrice === null, "rounded text-right text-sm font-semibold text-[#9edbd7] hover:text-white")}">Affiliate ${wholesalePrice !== null ? `$${Number(wholesalePrice).toFixed(2)}` : "not set"}</button>
      ` : ""}
    </div>
    <div class="mt-4 border-t border-gray-700 pt-3">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Product setup</p>
      <div class="flex flex-wrap gap-2 text-xs">
        <button type="button" data-product-editor-target="contentProductMarketplaceMode" class="w-full rounded border px-2 py-1.5 text-left font-semibold ${marketplaceListing.classes}">Marketplace listing: ${escapeHTML(marketplaceListing.label)}</button>
        <button type="button" data-product-status-controls class="rounded-full border px-2 py-1 ${lifecycleStatusClasses(currentProductEditorStatus())} hover:ring-2">Status: ${escapeHTML(currentProductEditorStatus())}</button>
        <button type="button" data-product-editor-target="contentProductMarketplaceAudience" class="rounded bg-gray-950 px-2 py-1 text-gray-200 hover:text-white">Audience: ${marketplaceAudience === "affiliates" ? "Approved affiliates only" : "Everyone"}</button>
        <button type="button" data-product-editor-target="contentProductFeatured" class="rounded bg-gray-950 px-2 py-1 text-gray-200 hover:text-white">${featured ? "★ Featured" : "☆ Not featured"}</button>
        <button type="button" data-product-editor-target="contentProductCategoryId" class="${marketplacePreviewAttention(!category, "rounded bg-gray-950 px-2 py-1 text-gray-200 hover:text-white")}">Filter: ${escapeHTML(categoryLabel)}</button>
        <button type="button" data-product-editor-target="contentProductDeliveryType" class="${marketplacePreviewAttention(!deliveryType, "rounded bg-gray-950 px-2 py-1 text-gray-200 hover:text-white")}">Delivery: ${escapeHTML(deliveryType || "Set delivery")}</button>
        <button type="button" data-product-editor-target="contentProductHasPhysicalFulfilment" class="${marketplacePreviewAttention(fulfilmentMissing, "rounded bg-gray-950 px-2 py-1 text-left text-gray-200 hover:text-white", fulfilmentReviewed ? "optional" : "required")}">Product fulfilment: ${escapeHTML(fulfilmentSelections.join(", ") || "Select")}</button>
      </div>
    </div>
  </div>`;
}

function currentProductEditorStatus() {
  if (document.getElementById("contentProductArchived")?.checked) return "archived";
  const shopStatus = document.getElementById("contentProductShopStatus")?.value || "draft";
  if (["draft", "review"].includes(shopStatus)) return shopStatus;
  return document.getElementById("contentProductMarketplaceMode")?.value === "active"
    ? "active" : "paused";
}

function syncProductStatusCheckboxes() {
  const currentStatus = currentProductEditorStatus();
  document.querySelectorAll(".content-product-status-checkbox").forEach((checkbox) => {
    checkbox.checked = checkbox.dataset.contentProductStatus === currentStatus;
  });
}

function setProductEditorStatus(nextStatus) {
  const archived = document.getElementById("contentProductArchived");
  const shopStatus = document.getElementById("contentProductShopStatus");
  const marketplaceMode = document.getElementById("contentProductMarketplaceMode");
  if (!archived || !shopStatus || !marketplaceMode) return;
  archived.checked = nextStatus === "archived";
  shopStatus.value = ["draft", "review", "archived"].includes(nextStatus) ? nextStatus : "active";
  marketplaceMode.value = nextStatus === "active" ? "active" : "hidden";
  syncProductStatusCheckboxes();
  renderMarketplaceTileControls();
  refreshMarketplacePreviews();
  state.isDirty = true;
}

const COPYABLE_PRODUCT_VARIANT_FIELDS = [
  "priceOverride", "wholesalePrice", "wholesaleMinQuantity", "salePrice", "saleStartsAt",
  "saleEndsAt", "deliveryMode", "physicalFulfilment", "marketplaceMode",
  "marketplaceStartsAt", "marketplaceEndsAt", "shortDescription", "longDescription",
  "inclusions", "primaryAssetId", "promotionAssetIds",
];

function copyProductVariantSettings(sourceVariant, targetVariant) {
  const copied = { ...targetVariant };
  COPYABLE_PRODUCT_VARIANT_FIELDS.forEach((field) => {
    const value = sourceVariant?.[field];
    copied[field] = Array.isArray(value) ? [...value] : value ?? null;
  });
  return copied;
}

function copyVariantOwnedConnections(sourceVariantId, targetVariantId) {
  const links = productVariantContentLinksFromRows(true);
  const grants = productUnlocksFromRows(true);
  const copiedLinks = links.filter((link) => link.productVariantId !== targetVariantId);
  links.filter((link) => link.productVariantId === sourceVariantId).forEach((link) => {
    copiedLinks.push({ ...link, productVariantId: targetVariantId });
  });
  const copiedGrants = grants.filter((grant) => grant.productVariantId !== targetVariantId);
  grants.filter((grant) => grant.productVariantId === sourceVariantId).forEach((grant) => {
    copiedGrants.push({ ...grant, productVariantId: targetVariantId });
  });
  renderProductVariantContentLinkRows(copiedLinks);
  renderProductUnlockRows(copiedGrants);
}

function renderMarketplaceTileControls() {
  const imageSelect = document.getElementById("contentProductTileImageSource");
  const descriptionSelect = document.getElementById("contentProductTileDescriptionSource");
  if (!imageSelect || !descriptionSelect) return;
  const imageValue = imageSelect.value || imageSelect.dataset.savedValue || "entity";
  const descriptionValue = descriptionSelect.value || descriptionSelect.dataset.savedValue || "entity";
  imageSelect.innerHTML = marketplaceTileSourceOptions(imageValue);
  descriptionSelect.innerHTML = marketplaceTileSourceOptions(descriptionValue);
  imageSelect.value = [...imageSelect.options].some((option) => option.value === imageValue)
    ? imageValue : "entity";
  descriptionSelect.value = [...descriptionSelect.options].some((option) => option.value === descriptionValue)
    ? descriptionValue : "entity";
  const preview = document.getElementById("contentProductTilePreview");
  if (preview) preview.innerHTML = marketplaceTilePreviewMarkup();
  syncProductStatusCheckboxes();
}

function hydrateMarketplaceTileControls(record = {}) {
  const imageSelect = document.getElementById("contentProductTileImageSource");
  const descriptionSelect = document.getElementById("contentProductTileDescriptionSource");
  const imageSource = record.productMarketplaceTileImageSource || record.marketplaceTileImageSource;
  const imageVariantId = record.productMarketplaceTileImageVariantId || record.marketplaceTileImageVariantId;
  const descriptionSource = record.productMarketplaceTileDescriptionSource ||
    record.marketplaceTileDescriptionSource;
  const descriptionVariantId = record.productMarketplaceTileDescriptionVariantId ||
    record.marketplaceTileDescriptionVariantId;
  const imageValue = imageSource === "product-variant" && imageVariantId
    ? `variant:${imageVariantId}` : "entity";
  const descriptionValue = descriptionSource === "product-variant" && descriptionVariantId
    ? `variant:${descriptionVariantId}` : "entity";
  if (imageSelect) imageSelect.dataset.savedValue = imageValue;
  if (descriptionSelect) descriptionSelect.dataset.savedValue = descriptionValue;
}

function focusProductEditorTarget(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const contextPanel = document.querySelector(
    `[data-product-context-panel="${CSS.escape(targetId)}"]`,
  );
  if (targetId === "contentName") {
    setInputValue("contentProductPreviewName", target.value);
    setInputValue(
      "contentProductPreviewShortDescription",
      document.getElementById("contentShortDescription")?.value || "",
    );
    setInputValue(
      "contentProductPreviewLongDescription",
      document.getElementById("contentLongDescription")?.value || "",
    );
  }
  document.querySelectorAll("[data-product-context-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.productContextPanel !== targetId);
  });
  const section = target.closest("details");
  if (section) {
    if (section.hasAttribute("data-product-preview-section")) section.classList.remove("hidden");
    document.querySelectorAll("#contentProductDrawer details").forEach((details) => {
      if (details !== section && !details.contains(section)) details.open = false;
    });
    section.open = true;
  }
  const focusTarget = contextPanel?.querySelector("input, textarea, select, button") || target;
  (contextPanel || target).scrollIntoView({ behavior: "smooth", block: "center" });
  focusTarget.focus({ preventScroll: true });
}

function returnToProductTilePreview() {
  const preview = document.getElementById("contentProductTilePreview");
  preview?.scrollIntoView({ behavior: "smooth", block: "center" });
  preview?.querySelector("button")?.focus({ preventScroll: true });
}

function returnToVariantPreview(row) {
  const preview = row?.querySelector(".product-variant-card-preview");
  preview?.scrollIntoView({ behavior: "smooth", block: "center" });
  preview?.querySelector("button")?.focus({ preventScroll: true });
}

function closeVariantEditorAndReturn(row) {
  const variantId = row?.querySelector(".product-variant-id")?.value.trim() ||
    row?.dataset.productVariantId || "";
  syncSelectedProductVariantRows();
  const variants = currentProductVariants();
  renderSelectedProductVariantRows(variants);
  updateProductPhysicalFields();
  const refreshedRow = variantId
    ? document.querySelector(
      `.content-product-variant-row[data-product-variant-id="${CSS.escape(variantId)}"]`,
    )
    : document.querySelector(".content-product-variant-row");
  returnToVariantPreview(refreshedRow);
}

function adminLinkedProductVariant(entry = {}, bundle = false) {
  if (!bundle && (entry.requirementType === "item" || entry.itemId)) {
    const item = (state.records.items || []).find((candidate) => candidate.id === entry.itemId) || {};
    return {
      isItem: true,
      productName: item.name || item.itemName || entry.itemId,
      variantName: "",
      shortDescription: item.shortDescription || item.description || "",
      href: "",
    };
  }
  const productId = bundle ? entry.componentProductId : entry.productId;
  const productVariantId = bundle ? entry.componentProductVariantId : entry.productVariantId;
  const product = (state.records.products || []).find((candidate) => candidate.id === productId) || {};
  const variant = (product.variants || []).find((candidate) =>
    (candidate.variantId || candidate.id) === productVariantId) || {};
  const assetId = variant.primaryAssetId || product.primaryAssetId || "";
  const asset = (state.records.assets || []).find((candidate) =>
    (candidate.assetId || candidate.id) === assetId) || {};
  return {
    productId,
    productVariantId,
    quantity: Number(entry.quantity || 1),
    productName: product.name || product.productName || productId,
    variantName: variant.name || variant.variantName || productVariantId,
    shortDescription: variant.shortDescription || product.shortDescription || product.description || "",
    image: externalUrl(asset.fileUrl || asset.url || ""),
    retailPrice: variant.priceOverride ?? product.retailPrice ?? product.price ?? null,
    salePrice: variant.salePrice ?? product.salePrice ?? null,
    wholesalePrice: variant.wholesalePrice ?? product.wholesalePrice ?? null,
    href: `/shop/${encodeURIComponent(product.slug || productId)}?variant=${encodeURIComponent(productVariantId)}`,
  };
}

function adminLinkedVariantList(title, entries = [], bundle = false) {
  if (!entries.length) return "";
  return `<section class="mt-3 text-left text-sm text-gray-300">
    <h4 class="mb-2 font-semibold text-white">${escapeHTML(title)}</h4>
    <ul class="list-disc space-y-2 pl-5">
      ${entries.map((entry) => {
    const detail = adminLinkedProductVariant(entry, bundle);
    const quantity = bundle && detail.quantity > 1 ? `${detail.quantity} × ` : "";
    const label = `${quantity}${detail.productName}${detail.variantName ? ` — ${detail.variantName}` : ""}`;
    const linkedControl = detail.isItem
      ? `<span class="font-semibold text-[#9edbd7]">${escapeHTML(label)}</span>`
      : (bundle
        ? `<button type="button" class="open-admin-linked-variant-bubble font-semibold text-[#9edbd7] hover:underline"
          data-product-id="${escapeHTML(detail.productId)}"
          data-product-variant-id="${escapeHTML(detail.productVariantId)}">${escapeHTML(label)}</button>`
        : `<a href="${escapeHTML(detail.href)}" target="_blank" rel="noopener"
          class="font-semibold text-[#9edbd7] hover:underline">${escapeHTML(label)}</a>`);
    return `<li>${linkedControl}` +
      `${detail.shortDescription ? ` — ${escapeHTML(detail.shortDescription)}` : ""}</li>`;
  }).join("")}
    </ul>
  </section>`;
}

function adminUnifiedInclusions(productVariant, legacyInclusions = "") {
  const linked = productVariant.bundleComponents || [];
  const manual = Array.isArray(productVariant.manualInclusions) && productVariant.manualInclusions.length
    ? productVariant.manualInclusions
    : String(legacyInclusions || "").split(/\r?\n/).map((name) => ({
      name: name.replace(/^[-*•]\s*/, "").trim(), quantity: 1,
    })).filter((entry) => entry.name);
  if (!linked.length && !manual.length) return "";
  return `<section class="mt-3 text-left text-sm text-gray-300">
    <button type="button" data-variant-editor="purchase"
      class="mb-2 rounded font-semibold text-white hover:text-[#c15cff]">Inclusions</button>
    <ul class="list-disc space-y-2 pl-5">
      ${manual.map((entry) => `<li><button type="button" data-variant-editor="purchase"
        class="text-left hover:text-white">${escapeHTML(`${Number(entry.quantity || 1)} × ${entry.name}`)}</button></li>`).join("")}
      ${linked.map((entry) => {
    const detail = adminLinkedProductVariant(entry, true);
    const label = `${Number(detail.quantity || 1)} × ${detail.productName}` +
      `${detail.variantName ? ` — ${detail.variantName}` : ""}`;
    return `<li><button type="button" class="open-admin-linked-variant-bubble font-semibold text-[#9edbd7] hover:underline"
      data-product-id="${escapeHTML(detail.productId)}" data-product-variant-id="${escapeHTML(detail.productVariantId)}">${escapeHTML(label)}</button>` +
      `${detail.shortDescription ? ` — ${escapeHTML(detail.shortDescription)}` : ""}</li>`;
  }).join("")}
    </ul>
  </section>`;
}

function closeAdminLinkedVariantBubbleSoon() {
  clearTimeout(adminLinkedVariantBubbleCloseTimer);
  adminLinkedVariantBubbleCloseTimer = setTimeout(() => {
    const bubble = document.querySelector(".admin-linked-variant-bubble");
    if (bubble?.dataset.pinned !== "true") bubble?.remove();
  }, 180);
}

function showAdminLinkedVariantBubble(trigger, pinned = false) {
  clearTimeout(adminLinkedVariantBubbleCloseTimer);
  document.querySelectorAll(".admin-linked-variant-bubble").forEach((bubble) => bubble.remove());
  const detail = adminLinkedProductVariant({
    componentProductId: trigger.dataset.productId,
    componentProductVariantId: trigger.dataset.productVariantId,
  }, true);
  const bubble = document.createElement("div");
  bubble.className = `admin-linked-variant-bubble fixed left-1/2 top-1/2 z-[140] w-[min(22rem,calc(100vw-2rem))]
    -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#407471] bg-gray-800 p-4 shadow-2xl`;
  bubble.dataset.pinned = pinned ? "true" : "false";
  bubble.addEventListener("mouseenter", () => clearTimeout(adminLinkedVariantBubbleCloseTimer));
  bubble.addEventListener("mouseleave", closeAdminLinkedVariantBubbleSoon);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-gray-950 text-xl text-white";
  close.setAttribute("aria-label", "Close bundled Product preview");
  close.textContent = "×";
  close.addEventListener("click", () => bubble.remove());
  const card = document.createElement("div");
  card.className = "block w-full text-left";
  const image = detail.image
    ? `<img src="${escapeHTML(detail.image)}" alt="${escapeHTML(`${detail.productName} — ${detail.variantName}`)}" class="h-40 w-full rounded object-cover">`
    : `<div class="flex h-40 w-full items-center justify-center rounded bg-gray-950 text-xs text-gray-400">No image selected</div>`;
  const hasSale = detail.salePrice !== null && detail.salePrice !== undefined;
  const price = hasSale
    ? `<span class="mr-2 text-gray-500 line-through">$${Number(detail.retailPrice || 0).toFixed(2)}</span><span class="font-bold text-green-400">$${Number(detail.salePrice).toFixed(2)}</span>`
    : `<span class="font-bold text-green-400">$${Number(detail.retailPrice || 0).toFixed(2)}</span>`;
  const affiliate = detail.wholesalePrice !== null && detail.wholesalePrice !== undefined
    ? `<p class="mt-1 text-sm font-semibold text-[#9edbd7]">Affiliate $${Number(detail.wholesalePrice).toFixed(2)}</p>`
    : "";
  card.innerHTML = `${image}<h4 class="mt-3 pr-7 text-lg font-semibold text-white">${escapeHTML(
    `${detail.productName} — ${detail.variantName}`,
  )}</h4><div class="mt-1">${price}${affiliate}</div>` +
    `${detail.shortDescription ? `<p class="mt-2 text-sm text-gray-300">${escapeHTML(detail.shortDescription)}</p>` : ""}` +
    `<a href="${escapeHTML(detail.href)}" target="_blank" rel="noopener"
      class="mt-4 inline-flex rounded bg-[#407471] px-4 py-2 text-sm font-semibold text-white hover:bg-[#315e5b]">More detail</a>`;
  bubble.append(close, card);
  document.body.appendChild(bubble);
  if (pinned) close.focus();
}

function adminPromotionVideoPreview(productVariant) {
  const assets = (productVariant.promotionAssetIds || []).map((assetId) =>
    (state.records.assets || []).find((asset) => (asset.assetId || asset.id) === assetId))
    .filter(Boolean);
  if (!assets.length) {
    return `<button type="button" data-variant-editor="promotion"
      class="mt-3 min-h-20 w-full rounded border border-blue-500 bg-blue-950/50 px-3 py-2 text-sm text-blue-100 ring-1 ring-blue-500/60">
      Set promotion video
    </button>`;
  }
  return `<section class="mt-4 space-y-3 text-left">
    <button type="button" data-variant-editor="promotion" class="font-semibold text-white hover:text-[#9edbd7]">
      Promotion ${assets.length === 1 ? "video" : "videos"}
    </button>
    ${assets.map((asset) => {
    const url = externalUrl(asset.fileUrl || asset.url || "");
    const embedUrl = externalUrl(asset.embedUrl || youtubeEmbedUrl(url));
    const title = asset.title || asset.name || "Product promotion video";
    return embedUrl
      ? `<iframe src="${escapeHTML(embedUrl)}" title="${escapeHTML(title)}"
          class="aspect-video w-full rounded bg-black" loading="lazy" allowfullscreen></iframe>`
      : url
        ? `<video src="${escapeHTML(url)}" class="aspect-video w-full rounded bg-black" controls preload="metadata"></video>`
        : "";
  }).join("")}
  </section>`;
}

function marketplaceVariantCardPreview(
  productVariant,
  entityVariant = {},
  isPrimary = false,
  detailMode = false,
) {
  const defaults = {
    name: document.getElementById("contentName")?.value || "Product",
    shortDescription: document.getElementById("contentShortDescription")?.value || "",
    longDescription: document.getElementById("contentLongDescription")?.value || "",
    price: optionalNumberFromInput("contentProductPrice"),
  };
  const assetId = productVariant.primaryAssetId || primaryImageAssetIdForEntityVariant(entityVariant) || "";
  const asset = (state.records.assets || []).find((entry) => (entry.assetId || entry.id) === assetId);
  const url = externalUrl(asset?.fileUrl || asset?.url || "");
  const variantName = productVariant.name || entityVariant.name || "";
  const description = productVariant.shortDescription || defaults.shortDescription;
  const longDescription = productVariant.longDescription || entityVariant.longDescription ||
    defaults.longDescription || description;
  const inclusions = productVariant.inclusions || entityVariant.inclusions || "";
  const price = productVariant.priceOverride ?? defaults.price;
  const salePrice = productVariant.salePrice ?? optionalNumberFromInput("contentProductSalePrice");
  const marketplaceMode = productVariant.marketplaceMode || "inherit";
  const productMarketplaceMode = document.getElementById("contentProductMarketplaceMode")?.value || "hidden";
  const effectiveMarketplaceMode = marketplaceMode === "inherit" ? productMarketplaceMode : marketplaceMode;
  const archived = document.getElementById("contentProductArchived")?.checked === true ||
    productVariant.status === "archived";
  const inventoryTracked = document.getElementById("contentProductInventoryTracked")?.checked === true;
  const tracksSeats = document.getElementById("contentProductTracksSeats")?.checked === true;
  const hasTicketAvailability = productVariant.ticketsRemaining !== null &&
    productVariant.ticketsRemaining !== undefined;
  const workshopSoldOut = tracksSeats && hasTicketAvailability &&
    Number(productVariant.ticketsRemaining) <= 0;
  const outOfStock = !tracksSeats && inventoryTracked && Number(productVariant.stock ?? 0) <= 0;
  const variantStatus = productVariant.status || "draft";
  let previewState = archived
    ? { label: "Archived", section: "identity", tone: "red" }
    : workshopSoldOut
      ? { label: "Sold Out", section: "purchase", tone: "gray" }
      : outOfStock
        ? { label: "Out of Stock", section: "purchase", tone: "gray" }
        : variantStatus === "paused"
          ? { label: "Paused", section: "lifecycle", tone: "amber" }
          : variantStatus === "draft"
            ? { label: "Draft", section: "lifecycle", tone: "purple" }
            : variantStatus === "review"
              ? { label: "Review", section: "lifecycle", tone: "blue" }
              : effectiveMarketplaceMode === "coming-soon"
                ? { label: "Coming Soon", section: "visibility", tone: "purple" }
                : ["hidden", "scheduled"].includes(effectiveMarketplaceMode)
                  ? { label: "Hidden", section: "visibility", tone: "amber" }
                  : null;
  let active = !archived && variantStatus === "active" && effectiveMarketplaceMode === "active";
  const deliveryType = document.getElementById("contentProductDeliveryType")?.value || "";
  const productType = marketplacePreviewProductType(deliveryType);
  const fulfilmentSummary = [productVariant.deliveryMode || deliveryType, productVariant.physicalFulfilment]
    .filter((value) => value && value !== "none")
    .join(" / ").replaceAll("-", " ");
  const category = document.getElementById("contentProductCategoryId")?.value || "";
  const categorySelect = document.getElementById("contentProductCategoryId");
  const categoryLabel = categorySelect?.selectedOptions?.[0]?.textContent || "";
  const affiliateAvailable = document.getElementById("contentProductAvailableToAffiliates")?.checked === true;
  const hasVariantPhysicalFulfilment = productVariant.physicalFulfilment &&
    productVariant.physicalFulfilment !== "none";
  const fulfilmentMissing = !deliveryType ||
    ["Physical", "Hybrid"].includes(deliveryType) && !hasVariantPhysicalFulfilment;
  const purchaseSetupReviewed = productVariant.purchaseSetupReviewed === true;
  const missingDescription = !(longDescription || description);
  const requiredFieldsComplete = !!url && !!(defaults.name || variantName) && !missingDescription &&
    (price !== null && price !== undefined || salePrice !== null) && !!category &&
    !!deliveryType && !fulfilmentMissing;
  if (isUnsavedProduct() && !requiredFieldsComplete) {
    previewState = null;
    active = false;
  }
  const variantId = productVariant.variantId || "";
  const detailsMissing = !variantName || !variantId;
  const blueprintMissing = ![...document.querySelectorAll(".product-variant-content-link-row")]
    .some((linkRow) =>
      linkRow.querySelector(".variant-content-product-variant")?.value === variantId &&
      linkRow.querySelector(".variant-content-blueprint")?.value);
  const unlockMissing = ![...document.querySelectorAll(".content-product-unlock-row")]
    .some((unlockRow) =>
      unlockRow.querySelector(".content-product-unlock-variant")?.value === variantId &&
      unlockRow.querySelector(".content-product-unlock-target")?.value);
  const visibilityMissing = !["inherit", "active", "scheduled", "coming-soon", "hidden"]
    .includes(productVariant.marketplaceMode || "inherit");
  const priceSaleMissing = price === null && salePrice === null &&
    (productVariant.wholesalePrice === null || productVariant.wholesalePrice === undefined) ||
    affiliateAvailable &&
      (productVariant.wholesalePrice === null || productVariant.wholesalePrice === undefined) &&
      optionalNumberFromInput("contentProductWholesalePrice") === null;
  const promotionMissing = !(productVariant.promotionAssetIds || []).length;
  const prerequisitesMissing = !(productVariant.prerequisiteProductVariants || []).length;
  const blueprintTone = ["Tool", "Workshop"].includes(productType) ? "review" : "optional";
  const unlockTone = ["Course", "Program", "Plan", "Workshop"].includes(productType)
    ? "review" : "optional";
  const inclusionDetails = adminUnifiedInclusions(productVariant, inclusions);
  const prerequisiteDetails = adminLinkedVariantList(
    "Prerequisites",
    productVariant.prerequisiteProductVariants || [],
  );
  return `<div class="product-variant-card-preview relative overflow-hidden rounded bg-gray-900/40 ${active ? "ring-2 ring-green-500/80" : ""}" data-preview-mode="${detailMode ? "detail" : "card"}">
    ${previewState
    ? marketplacePreviewStateOverlay(
      previewState.label,
      previewState.tone,
      `data-variant-editor="${escapeHTML(previewState.section)}"`,
    )
    : ""}
    <div class="flex flex-col gap-6 p-3 md:flex-row md:items-start">
      <button type="button" data-variant-editor="image" title="Edit marketplace image"
        class="${marketplacePreviewAttention(!url, "flex min-h-56 w-full items-center justify-center overflow-hidden rounded bg-gray-950 text-center text-xs text-gray-400 ring-[#407471] hover:ring-2 md:w-1/2")}">
        ${url
    ? `<img src="${escapeHTML(url)}" alt="${escapeHTML(defaults.name || variantName || "Product")}" class="h-full max-h-80 w-full object-cover">`
    : "Set Product detail image"}
      </button>
      <div class="flex min-w-0 flex-1 flex-col px-2">
        <button type="button" data-variant-editor="identity" title="Edit Product variant details"
          class="${marketplacePreviewAttention(!defaults.name, "rounded text-left text-2xl font-bold text-white hover:text-[#c15cff]")}">${escapeHTML(defaults.name || "Set Product name")}</button>
        <button type="button" data-variant-editor="price" title="Edit marketplace price"
          class="${marketplacePreviewAttention((price === null || price === undefined) && salePrice === null, "mt-2 w-fit rounded text-left text-xl font-bold text-green-400 hover:text-green-300")}">${salePrice !== null && price !== null && price !== undefined ? `<span class="mr-2 text-gray-500 line-through">$${Number(price).toFixed(2)}</span><span class="font-bold text-green-400">$${Number(salePrice).toFixed(2)}</span>` : price !== null && price !== undefined ? `$${Number(price).toFixed(2)}` : "Set price"}</button>
        <button type="button" data-variant-editor="description" title="Edit description overrides"
          class="${marketplacePreviewAttention(missingDescription, "mt-3 min-h-16 rounded whitespace-pre-line text-left text-sm text-gray-300 hover:text-white")}">${escapeHTML(longDescription || "Set Product long description")}</button>
        ${inclusionDetails}
        ${prerequisiteDetails}
        ${adminPromotionVideoPreview(productVariant)}
        <label class="mt-4 text-left text-sm text-gray-300">Choose option
          <button type="button" data-variant-editor="identity" class="${marketplacePreviewAttention(detailsMissing, "mt-1 block w-full rounded bg-gray-800 px-3 py-2 text-left text-white")}">${escapeHTML(`${variantName || "Set variant name"}${price !== null && price !== undefined ? ` - $${Number(price).toFixed(2)}` : ""}`)}</button>
        </label>
        <div class="mt-4 flex items-center gap-4">
          <span class="flex h-8 w-8 items-center justify-center rounded bg-gray-700 text-lg">−</span>
          <span class="w-8 text-center font-semibold text-white">1</span>
          <span class="flex h-8 w-8 items-center justify-center rounded bg-gray-700 text-lg">+</span>
        </div>
        <span class="mt-4 w-fit rounded bg-[#407471] px-4 py-2 text-white">Add to Cart</span>
      </div>
    </div>
    <div class="border-t border-gray-700 bg-gray-950/40 p-3">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Variant setup</p>
      <div class="flex flex-wrap gap-2">
      ${isPrimary ? `<button type="button" data-variant-editor="identity" class="rounded bg-gray-950 px-2 py-1 text-xs font-medium text-[#9edbd7] hover:text-white">Primary</button>` : ""}
      <button type="button" data-variant-editor="visibility" class="rounded-full border px-2 py-1 text-xs ${lifecycleStatusClasses(variantStatus)} hover:ring-2">Status: ${escapeHTML(variantStatus)}</button>
      <span class="rounded bg-gray-950 px-2 py-1 text-xs text-gray-300">Type: ${escapeHTML(productType)}</span>
      <button type="button" data-variant-editor="purchase" class="${marketplacePreviewAttention(fulfilmentMissing, "rounded bg-gray-950 px-2 py-1 text-xs text-gray-300 hover:text-white", purchaseSetupReviewed ? "optional" : "required")}">Purchase setup: ${escapeHTML(fulfilmentMissing ? "Review" : fulfilmentSummary)}</button>
      <button type="button" data-product-editor-target="contentProductCategoryId" class="${marketplacePreviewAttention(!category, "rounded bg-gray-950 px-2 py-1 text-xs text-gray-300 hover:text-white")}">${escapeHTML(categoryLabel || "Set category")}</button>
      <button type="button" data-product-editor-target="contentProductDeliveryType" class="${marketplacePreviewAttention(!deliveryType, "rounded bg-gray-950 px-2 py-1 text-xs text-gray-300 hover:text-white")}">Delivery: ${escapeHTML(deliveryType || "Set delivery")}</button>
      <button type="button" data-variant-editor="identity" class="${marketplacePreviewAttention(detailsMissing, "rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:border-[#407471] hover:text-white")}">Variant details</button>
      <button type="button" data-variant-editor="description" class="${marketplacePreviewAttention(missingDescription, "rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:border-[#407471] hover:text-white")}">Descriptions</button>
      <button type="button" data-variant-connection="blueprint" class="${marketplacePreviewAttention(blueprintMissing, "rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:border-[#407471] hover:text-white", blueprintTone)}">Blueprints</button>
      <button type="button" data-variant-connection="unlock" class="${marketplacePreviewAttention(unlockMissing, "rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:border-[#407471] hover:text-white", unlockTone)}">Unlocks</button>
      <button type="button" data-variant-editor="visibility" class="${marketplacePreviewAttention(visibilityMissing, "rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:border-[#407471] hover:text-white")}">Visibility &amp; status</button>
      <button type="button" data-variant-editor="sale" class="${marketplacePreviewAttention(priceSaleMissing, "rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:border-[#407471] hover:text-white")}">Sale</button>
      <button type="button" data-variant-editor="promotion" class="${marketplacePreviewAttention(promotionMissing, "rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:border-[#407471] hover:text-white", "optional")}">Promotion videos</button>
      <button type="button" data-variant-editor="prerequisites" class="${marketplacePreviewAttention(prerequisitesMissing, "rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:border-[#407471] hover:text-white", "optional")}">Prerequisites</button>
      </div>
    </div>
  </div>`;
}

function updateMarketplacePreviewRow(target) {
  const row = target?.closest?.(".content-product-variant-row");
  const preview = row?.querySelector(".product-variant-card-preview");
  if (!row || !preview) return;
  const contentVariantSelection = row.querySelector(".product-variant-content-variant")?.value || "";
  const contentVariantId = contentVariantSelection === "__none__" ? "" :
    contentVariantSelection || row.dataset.contentVariantId || "";
  const entityVariant = entityVariantsFromBuilder()
    .find((variant) => variant.entityVariantId === contentVariantId) || {};
  const existingProductVariant = currentProductVariants().find((variant) =>
    variant.variantId === row.dataset.productVariantId ||
    contentVariantId && variant.contentVariantId === contentVariantId) || {};
  const productVariant = {
    ...existingProductVariant,
    variantId: row.querySelector(".product-variant-id")?.value || row.dataset.productVariantId || "",
    name: row.querySelector(".product-variant-name")?.value || "Product variant",
    sku: row.querySelector(".product-variant-sku")?.value || "",
    shortDescription: row.querySelector(".product-variant-short-description")?.value || "",
    longDescription: row.querySelector(".product-variant-long-description")?.value || "",
    inclusions: "",
    manualInclusions: [...row.querySelectorAll(".product-manual-inclusion-row")].map((inclusionRow) => ({
      name: inclusionRow.querySelector(".product-manual-inclusion-name")?.value.trim() || "",
      quantity: Math.max(Number(
        inclusionRow.querySelector(".product-manual-inclusion-quantity")?.value || 1,
      ), 1),
    })).filter((entry) => entry.name),
    priceOverride: optionalNumberFromElement(row.querySelector(".product-variant-price")),
    salePrice: optionalNumberFromElement(row.querySelector(".product-variant-sale-price")),
    wholesalePrice: optionalNumberFromElement(row.querySelector(".product-variant-wholesale-price")),
    primaryAssetId: row.querySelector(".product-variant-primary-asset")?.value || "",
    stock: optionalNumberFromElement(row.querySelector(".product-variant-stock")) ?? 0,
    deliveryMode: row.querySelector(".product-variant-delivery-mode")?.value || "",
    physicalFulfilment: row.querySelector(".product-variant-physical-fulfilment")?.value || "none",
    marketplaceMode: row.querySelector(".product-variant-marketplace-mode")?.value || "inherit",
    promotionAssetIds: [...(row.querySelector(".product-variant-promotion-assets")?.selectedOptions || [])]
      .map((option) => option.value).filter(Boolean),
    prerequisiteProductVariants: [...row.querySelectorAll(".product-prerequisite-row")]
      .map(prerequisiteFromRow).filter((entry) => entry && !isSelfProductPrerequisite(
        entry,
        row.querySelector(".product-variant-id")?.value || row.dataset.productVariantId || "",
      )),
    bundleComponents: [...row.querySelectorAll(".product-bundle-component-row")]
      .map((componentRow) => ({
        componentProductId: componentRow.querySelector(".product-bundle-component-product")?.value || "",
        componentProductVariantId:
          componentRow.querySelector(".product-bundle-component-variant")?.value || "",
        inventoryAction: componentRow.querySelector(".product-bundle-component-deduct")?.checked
          ? "deduct" : "none",
        quantity: Math.max(Number(
          componentRow.querySelector(".product-bundle-component-quantity")?.value || 1,
        ), 1),
      })).filter((component) => component.componentProductId),
    status: row.dataset.pendingStatus || row.querySelector(".product-variant-status")?.value || "draft",
  };
  preview.outerHTML = marketplaceVariantCardPreview(
    productVariant,
    entityVariant,
    row === row.parentElement?.querySelector(".content-product-variant-row"),
    true,
  );
}

function refreshMarketplacePreviews() {
  document.querySelectorAll(".content-product-variant-row").forEach((row) => {
    updateMarketplacePreviewRow(row.querySelector(".product-variant-name") || row);
  });
}

function isQualificationItem(item = {}) {
  return normalizedType(item.itemType || item.type) === "qualification";
}

function prerequisiteTargetOptions(entry = {}) {
  const selectedValue = entry.requirementType === "item" || entry.itemId
    ? `item:${entry.itemId}` : entry.productId ? `product:${entry.productId}` : "";
  const products = (state.records.products || []).map((product) => {
    const value = `product:${product.id}`;
    return `<option value="${escapeHTML(value)}"${value === selectedValue ? " selected" : ""}>${escapeHTML(product.name || product.id)}</option>`;
  }).join("");
  const items = (state.records.items || []).filter(isQualificationItem).map((item) => {
    const value = `item:${item.id}`;
    return `<option value="${escapeHTML(value)}"${value === selectedValue ? " selected" : ""}>${escapeHTML(item.name || item.id)}</option>`;
  }).join("");
  const pending = selectedValue === "item:__pending__"
    ? `<option value="item:__pending__" selected>Creating external qualification...</option>` : "";
  return `<option value="">Choose prerequisite</option>${pending}<optgroup label="Product variants">${products}</optgroup><optgroup label="External qualifications">${items}</optgroup>`;
}

function prerequisiteFromRow(row) {
  const requirementType = row.querySelector(".product-prerequisite-kind")?.value || "product";
  const targetId = row.querySelector(".product-prerequisite-target")?.value || "";
  if (requirementType === "item" && targetId) {
    return { requirementType: "item", itemId: targetId };
  }
  const productVariantId = row.querySelector(".product-prerequisite-variant")?.value || "";
  return requirementType === "product" && targetId && productVariantId
    ? { requirementType: "product-variant", productId: targetId, productVariantId }
    : null;
}

function currentProductId() {
  return document.getElementById("contentProductId")?.value ||
    document.getElementById("contentExistingProductId")?.value ||
    state.editingRecord?.productId || "";
}

function isSelfProductPrerequisite(entry = {}, sourceVariantId = "") {
  return entry.requirementType !== "item" &&
    Boolean(currentProductId()) && entry.productId === currentProductId() &&
    entry.productVariantId === sourceVariantId;
}

function prerequisiteVariantOptions(productId, selectedVariantId = "", sourceVariantId = "") {
  const product = (state.records.products || []).find((candidate) => candidate.id === productId);
  const excludesCurrentVariant = Boolean(productId) && productId === currentProductId();
  return (product?.variants || []).filter((variant) => {
    const variantId = variant.variantId || variant.id;
    return !excludesCurrentVariant || variantId !== sourceVariantId;
  }).map((variant) => {
    const variantId = variant.variantId || variant.id;
    const selected = variantId === selectedVariantId ? " selected" : "";
    return `<option value="${escapeHTML(variantId)}"${selected}>${escapeHTML(variant.name || variantId)}</option>`;
  }).join("");
}

function prerequisiteRowsMarkup(prerequisites = [], sourceVariantId = "") {
  return prerequisites.map((entry, index) => {
    const itemRequirement = entry.requirementType === "item" || entry.itemId;
    const productOptions = (state.records.products || [])
      .map((product) => `<option value="${escapeHTML(product.id)}"${product.id === entry.productId ? " selected" : ""}>${escapeHTML(product.name || product.id)}</option>`)
      .join("");
    const itemOptions = (state.records.items || []).filter(isQualificationItem)
      .map((item) => `<option value="${escapeHTML(item.id)}"${item.id === entry.itemId ? " selected" : ""}>${escapeHTML(item.name || item.id)}</option>`)
      .join("");
    const variantOptions = itemRequirement ? "" : prerequisiteVariantOptions(
      entry.productId,
      entry.productVariantId,
      sourceVariantId,
    );
    const record = itemRequirement
      ? (state.records.items || []).find((item) => item.id === entry.itemId)
      : (state.records.products || []).find((product) => product.id === entry.productId);
    const selectedVariant = itemRequirement ? null : (record?.variants || []).find((variant) =>
      (variant.variantId || variant.id) === entry.productVariantId);
    const selectionLabel = record
      ? `${record.name || record.id}${selectedVariant ? ` → ${selectedVariant.name || selectedVariant.variantId || selectedVariant.id}` : ""}`
      : (itemRequirement ? "No external qualification selected" : "No Product variant selected");
    return `<div class="product-prerequisite-row flex min-w-0 flex-wrap items-center gap-3 rounded border border-gray-700 bg-gray-950/40 p-3">
      <div class="min-w-48 flex-1"><p class="text-xs font-semibold uppercase tracking-wide text-gray-400">${itemRequirement ? "External qualification" : "Product prerequisite"}</p><p class="mt-1 break-words text-sm text-[#9edbd7]">${escapeHTML(selectionLabel)}</p></div>
      <select class="product-prerequisite-kind w-auto rounded bg-gray-800 px-2 py-2 text-sm text-white" aria-label="Prerequisite type">
        <option value="product"${itemRequirement ? "" : " selected"}>Product variant prerequisite</option>
        <option value="item"${itemRequirement ? " selected" : ""}>External qualification</option>
      </select>
      <select class="product-prerequisite-target hidden">
        <option value="${escapeHTML(itemRequirement ? entry.itemId || "" : entry.productId || "")}" selected></option>
      </select>
      <span class="content-template-linked-picker product-prerequisite-product-picker hidden">
        <select class="product-prerequisite-product-selector content-template-linked-select hidden"
          data-field-key="product-prerequisite-product-${index}" data-field-name="Prerequisite Product"
          data-linked-table="Products" data-linked-type-filter="" data-linked-status-filter=""
          data-linked-tag-filters="" data-allow-record-reuse="true" data-selector-multiple="true"
          data-relationship-label="Prerequisites for">
          <option value="">Choose prerequisite Product</option>${productOptions}
        </select>
        <button type="button" class="open-content-linked-selector"
          data-linked-selector-target=".product-prerequisite-product-selector">Choose prerequisite Product</button>
        <button type="button" class="edit-selected-linked-record" disabled>Edit selected</button>
      </span>
      <span class="content-template-linked-picker product-prerequisite-item-picker hidden">
        <select class="product-prerequisite-item-selector content-template-linked-select hidden"
          data-field-key="product-prerequisite-item-${index}" data-field-name="External qualification"
          data-linked-table="Items" data-linked-type-filter="Qualification" data-linked-status-filter=""
          data-linked-tag-filters="" data-allow-record-reuse="true" data-selector-multiple="true"
          data-relationship-label="External qualifications for">
          <option value="">Choose external qualification</option>${itemOptions}
        </select>
        <button type="button" class="open-content-linked-selector"
          data-linked-selector-target=".product-prerequisite-item-selector">Choose external qualification</button>
        <button type="button" class="edit-selected-linked-record" disabled>Edit selected</button>
      </span>
      <select class="product-prerequisite-variant hidden"${itemRequirement ? " disabled" : ""}>
        <option value="">${itemRequirement ? "Manual verification will be added later" : "Choose required variant"}</option>
        ${variantOptions}
      </select>
      <button type="button" class="remove-product-prerequisite rounded border border-red-700 px-3 py-1 text-sm text-red-200">Remove</button>
    </div>`;
  }).join("") || "<p class=\"product-prerequisite-empty text-xs text-gray-400\">No prerequisites.</p>";
}

function bundleVariantOptions(productId, selectedVariantId = "") {
  const currentProductId = document.getElementById("contentProductId")?.value ||
    document.getElementById("contentExistingProductId")?.value || "";
  const product = productId && productId === currentProductId
    ? { variants: currentProductVariants() }
    : (state.records.products || []).find((candidate) => candidate.id === productId);
  return (product?.variants || []).map((variant) => {
    const variantId = variant.variantId || variant.id;
    const selected = variantId === selectedVariantId ? " selected" : "";
    return `<option value="${escapeHTML(variantId)}"${selected}>${escapeHTML(variant.name || variantId)}</option>`;
  }).join("");
}

function bundleComponentsMarkup(components = []) {
  return components.map((component, index) => {
    const product = (state.records.products || []).find((candidate) =>
      candidate.id === component.componentProductId);
    const variant = (product?.variants || []).find((candidate) =>
      (candidate.variantId || candidate.id) === component.componentProductVariantId);
    const selectionLabel = product
      ? `${product.name || product.id}${variant ? ` → ${variant.name || variant.variantId || variant.id}` : ""}`
      : "Choose linked Product variants";
    return `
    <div class="product-bundle-component-row grid min-w-0 gap-3 rounded border border-gray-700 bg-gray-950/40 p-3 sm:grid-cols-[minmax(12rem,1fr)_6rem_minmax(10rem,auto)_auto] sm:items-end"
      data-bundle-component-id="${escapeHTML(component.bundleComponentId || `BUNDLE-COMPONENT-${index + 1}`)}">
      <div class="min-w-0"><p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Linked Product variant</p><p class="mt-1 break-words text-sm text-[#9edbd7]">${escapeHTML(selectionLabel)}</p></div>
      <span class="content-template-linked-picker hidden">
      <select class="product-bundle-component-product content-template-linked-select hidden"
        data-field-key="product-inclusion-${index}" data-field-name="Linked Product inclusion"
        data-linked-table="Products" data-linked-type-filter="" data-linked-status-filter=""
        data-linked-tag-filters="" data-allow-record-reuse="true" data-selector-multiple="true"
        data-relationship-label="Purchasing this variant includes">
        <option value="">Choose underlying Product</option>
        ${bundleProductOptions(component.componentProductId)}
      </select>
      <button type="button" class="open-content-linked-selector">${escapeHTML(selectionLabel)}</button>
      </span>
      <select class="product-bundle-component-variant hidden">
        <option value="">Choose exact Product variant</option>
        ${bundleVariantOptions(component.componentProductId, component.componentProductVariantId)}
      </select>
      <input class="product-bundle-component-quantity min-w-0 w-full rounded bg-gray-800 px-2 py-2 text-white"
        type="number" min="1" step="1" value="${escapeHTML(component.quantity ?? 1)}" aria-label="Quantity per bundle">
      <label class="flex min-w-0 items-center gap-2 rounded border border-gray-700 px-2 py-1 text-xs text-gray-200">
        <input class="product-bundle-component-deduct accent-[#407471]" type="checkbox"
          ${component.inventoryAction === "none" ? "" : "checked"}> Deduct stock/tickets
      </label>
      <button type="button" class="remove-product-bundle-component rounded border border-red-700 px-3 py-1 text-red-200 sm:justify-self-start xl:justify-self-auto">Remove</button>
    </div>`;
  }).join("") || "<p class=\"product-bundle-empty text-xs text-gray-400\">No linked Product inclusions.</p>";
}

function blueprintInclusionsForProductVariant(productVariantId) {
  const directLinks = productVariantContentLinksFromRows(true).filter((link) =>
    link.productVariantId === productVariantId &&
    ["ManufacturedFrom", "OperatedWith"].includes(link.linkRole) && link.entityId);
  const planLinks = productUnlocksFromRows().filter((grant) =>
    grant.productVariantId === productVariantId && String(grant.accessEntityType || "").toLowerCase() === "plan");
  const workshopLinks = planLinks.flatMap((grant) => {
    const plan = (state.records.plans || []).find((entry) => entry.id === grant.accessEntityId);
    const planVariant = (plan?.entityVariants || []).find((entry) =>
      entry.entityVariantId === grant.accessEntityVariantId) || plan?.entityVariants?.[0] || plan;
    return (planVariant?.linkedBlueprintIds || []).map((blueprintId) => ({
      productVariantId,
      entityId: blueprintId,
      entityVariantId: "",
      linkRole: "OperatedWith",
    })).filter((link) => {
      const blueprint = (state.records.blueprints || []).find((entry) => entry.id === link.entityId);
      return String(blueprint?.type || blueprint?.blueprintType || "").toLowerCase() === "workshop operations";
    });
  });
  const links = [...new Map([...directLinks, ...workshopLinks]
    .map((link) => [`${link.entityId}:${link.entityVariantId || ""}`, link])).values()];
  return links.flatMap((link) => {
    const blueprint = (state.records.blueprints || []).find((entry) => entry.id === link.entityId);
    const blueprintVariant = (blueprint?.entityVariants || []).find((entry) =>
      entry.entityVariantId === link.entityVariantId) || blueprint?.entityVariants?.[0] || blueprint;
    return (blueprintVariant?.linkedItemComponents || []).map((component, index) => {
      const item = (state.records.items || []).find((entry) => entry.id === component.itemId);
      const product = (state.records.products || []).find((entry) => entry.id === component.productId);
      const sourceName = item?.name || item?.title || product?.name || product?.title ||
        component.itemId || component.productId || `Component ${index + 1}`;
      const basis = component.quantityBasis && component.quantityBasis !== "fixed"
        ? ` (${String(component.quantityBasis).replaceAll("-", " ")})` : "";
      return {
        inclusionId: `BLUEPRINT-${link.entityId}-${component.componentId || index + 1}`,
        name: `${sourceName}${basis}`,
        quantity: Math.max(Number(component.quantity || 1), 1),
        sourceBlueprintId: link.entityId,
        sourceComponentId: component.componentId || `COMPONENT-${index + 1}`,
      };
    });
  });
}

function manualInclusionsMarkup(inclusions = [], legacyInclusions = "") {
  const entries = Array.isArray(inclusions) && inclusions.length
    ? inclusions
    : String(legacyInclusions || "").split(/\r?\n/).map((name, index) => ({
      inclusionId: `LEGACY-INCLUSION-${index + 1}`,
      name: name.replace(/^[-*•]\s*/, "").trim(),
      quantity: 1,
    })).filter((entry) => entry.name);
  return entries.map((entry, index) => `
    <div class="product-manual-inclusion-row grid gap-2 rounded border border-gray-700 p-2 md:grid-cols-[1fr_7rem_auto]"
      data-inclusion-id="${escapeHTML(entry.inclusionId || `INCLUSION-${index + 1}`)}"
      data-source-blueprint-id="${escapeHTML(entry.sourceBlueprintId || "")}"
      data-source-component-id="${escapeHTML(entry.sourceComponentId || "")}">
      <input class="product-manual-inclusion-name rounded bg-gray-800 px-2 py-2 text-white"
        value="${escapeHTML(entry.name || "")}" placeholder="Inclusion name">
      <input class="product-manual-inclusion-quantity rounded bg-gray-800 px-2 py-2 text-white"
        type="number" min="1" step="1" value="${escapeHTML(entry.quantity ?? 1)}" aria-label="Inclusion quantity">
      <button type="button" class="remove-product-manual-inclusion rounded border border-red-700 px-3 py-1 text-red-200">Remove</button>
    </div>`).join("") || "<p class=\"product-manual-inclusion-empty text-xs text-gray-400\">No unlinked inclusions.</p>";
}

function productVariantContentLinksFromRows(includeIncomplete = false) {
  let defaultBlueprintId = "";
  const blueprintLinks = [...document.querySelectorAll(".product-variant-content-link-row")]
    .map((row) => {
      const productVariantId = row.querySelector(".variant-content-product-variant")?.value || "";
      const entityId = row.querySelector(".variant-content-blueprint")?.value || "";
      const entityVariantId = row.querySelector(".variant-content-blueprint-variant")?.value || "";
      const linkRole = row.querySelector(".variant-content-link-role")?.value || "ManufacturedFrom";
      if (linkRole === "ManufacturedFrom" && !productVariantId && entityId) defaultBlueprintId = entityId;
      return {
        productVariantId,
        entityType: "Blueprint",
        entityId,
        entityVariantId,
        linkRole,
        status: "active",
      };
    })
    .filter((link) => includeIncomplete || link.entityId);
  setInputValue("contentProductBlueprintId", defaultBlueprintId);
  const retained = Array.isArray(state.retainedProductVariantContentLinks)
    ? state.retainedProductVariantContentLinks
    : [];
  return [...retained, ...blueprintLinks];
}

function blueprintContentVariantOptions(blueprintId, selectedId = "") {
  const blueprint = (state.records.blueprints || []).find((record) => record.id === blueprintId);
  return (blueprint?.entityVariants || []).map((variant) => {
    const variantId = variant.entityVariantId || variant.id || "";
    const name = variant.name || variantId;
    const label = variantId && variantId !== name ? `${name} (${variantId})` : name;
    return `<option value="${escapeHTML(variantId)}"${variantId === selectedId ? " selected" : ""}>${escapeHTML(label)}</option>`;
  }).join("");
}

function defaultBlueprintContentVariantLabel(blueprintId) {
  const blueprint = (state.records.blueprints || []).find((record) => record.id === blueprintId);
  const variant = (blueprint?.entityVariants || []).find((candidate) => candidate.isDefault === true) ||
    blueprint?.entityVariants?.[0];
  return variant?.name ? `Default Blueprint variant — ${variant.name}` : "Default Blueprint variant";
}

function refreshProductBlueprintConnectionSummary(row) {
  if (!row) return;
  const summary = row.querySelector(".product-variant-blueprint-selection");
  if (!summary) return;
  const role = row.querySelector(".variant-content-link-role")?.selectedOptions?.[0]?.textContent?.trim() ||
    "Blueprint";
  const productVariant = row.querySelector(".variant-content-product-variant")?.selectedOptions?.[0]
    ?.textContent?.trim() || "Product variant not selected";
  const blueprintSelect = row.querySelector(".variant-content-blueprint");
  const blueprint = blueprintSelect?.selectedOptions?.[0]?.textContent?.trim() || "Blueprint not selected";
  const blueprintVariantSelect = row.querySelector(".variant-content-blueprint-variant");
  const blueprintVariant = blueprintVariantSelect?.selectedOptions?.[0]?.textContent?.trim() ||
    "Default Blueprint variant";
  summary.textContent = `${productVariant} · ${role}: ${blueprint} → ${blueprintVariant}`;
}

function refreshProductBlueprintRoleConstraint(row, clearIncompatible = false) {
  if (!row) return;
  const roleSelect = row.querySelector(".variant-content-link-role");
  const blueprintSelect = row.querySelector(".variant-content-blueprint");
  const blueprintVariantSelect = row.querySelector(".variant-content-blueprint-variant");
  if (!roleSelect || !blueprintSelect) return;
  const workshopOperations = roleSelect.value === "OperatedWith";
  const requiredType = workshopOperations ? "Workshop Operations" : "Product Manufacture";
  blueprintSelect.dataset.linkedTypeFilter = requiredType;
  blueprintSelect.dataset.fieldName = workshopOperations
    ? "Workshop Operations Blueprint"
    : "Manufacturing Blueprint";
  const selectedBlueprint = (state.records.blueprints || []).find((record) =>
    record.id === blueprintSelect.value);
  const selectedType = normalizedText(selectedBlueprint?.type || selectedBlueprint?.blueprintType);
  if (clearIncompatible && selectedBlueprint && selectedType !== normalizedText(requiredType)) {
    blueprintSelect.value = "";
    if (blueprintVariantSelect) {
      blueprintVariantSelect.innerHTML = "<option value=\"\">Default Blueprint variant</option>";
    }
  }
  refreshLinkedTemplatePickerLabel(blueprintSelect);
}

function renderProductVariantContentLinkRows(links = []) {
  const container = document.getElementById("productVariantContentLinkRows");
  if (!container) return;
  const productVariants = currentProductVariants();
  const blueprints = state.records.blueprints || [];
  const blueprintLinks = links.filter((link) =>
    ["ManufacturedFrom", "OperatedWith"].includes(link.linkRole));
  const defaultBlueprintId = document.getElementById("contentProductBlueprintId")?.value || "";
  const rows = blueprintLinks.length || !defaultBlueprintId
    ? blueprintLinks
    : productVariants.map((variant) => ({
      productVariantId: variant.variantId,
      entityType: "Blueprint",
      entityId: defaultBlueprintId,
      entityVariantId: "",
      linkRole: "ManufacturedFrom",
      status: "active",
    }));
  container.innerHTML = rows.map((link) => {
    const productVariantOptions = productVariants.map((variant) => {
      const selected = variant.variantId === link.productVariantId ? " selected" : "";
      return `<option value="${escapeHTML(variant.variantId)}"${selected}>${escapeHTML(variant.name || variant.variantId)}</option>`;
    }).join("");
    const blueprintOptions = blueprints.map((record) => {
      const selected = record.id === link.entityId ? " selected" : "";
      return `<option value="${escapeHTML(record.id)}"${selected}>${escapeHTML(record.name || record.id)}</option>`;
    }).join("");
    const linkRole = link.linkRole || "ManufacturedFrom";
    const blueprintVariantOptions = blueprintContentVariantOptions(link.entityId, link.entityVariantId);
    return `
      <div class="product-variant-content-link-row flex min-w-0 flex-wrap items-center gap-3 overflow-hidden rounded border border-gray-700 bg-gray-950/40 p-3">
        <select class="variant-content-link-role w-auto rounded border border-gray-600 bg-gray-800 px-2 py-2 text-sm text-white" aria-label="Blueprint connection type">
          <option value="ManufacturedFrom"${linkRole === "ManufacturedFrom" ? " selected" : ""}>Manufacturing recipe</option>
          <option value="OperatedWith"${linkRole === "OperatedWith" ? " selected" : ""}>Workshop operations</option>
        </select>
        <select class="variant-content-product-variant hidden">
          <option value=""${link.productVariantId ? "" : " selected"}>Choose Product variant${link.productVariantId ? "" : " — legacy all-variant link"}</option>${productVariantOptions}
        </select>
        <span class="content-template-linked-picker">
          <select class="variant-content-blueprint content-template-linked-select hidden"
            data-field-key="product-blueprint-${escapeHTML(link.productVariantId || "all")}"
            data-field-name="${linkRole === "ManufacturedFrom" ? "Manufacturing Blueprint" : "Workshop operations Blueprint"}"
            data-linked-table="Blueprints"
            data-linked-type-filter="${linkRole === "ManufacturedFrom" ? "Product Manufacture" : "Workshop Operations"}"
            data-linked-status-filter="" data-linked-tag-filters="" data-selector-multiple="true"
            data-allow-record-reuse="true"
            data-relationship-label="Blueprints for">
            <option value="">Choose Blueprint</option>${blueprintOptions}
          </select>
          <button type="button" class="open-content-linked-selector hidden">Choose Blueprint</button>
          <button type="button" class="edit-selected-linked-record rounded border border-gray-600 px-3 py-2 text-xs text-gray-200" disabled>Edit content</button>
        </span>
        <select class="variant-content-blueprint-variant hidden" aria-label="Exact Blueprint variation">
          <option value="">${escapeHTML(defaultBlueprintContentVariantLabel(link.entityId))}</option>${blueprintVariantOptions}
        </select>
        <p class="product-variant-blueprint-selection min-w-48 flex-1 break-words text-sm text-[#9edbd7]"></p>
        <button type="button" class="remove-product-variant-content-link rounded border border-red-700 px-3 py-1 text-xs text-red-200">Remove</button>
      </div>`;
  }).join("") || "<p class=\"text-xs text-gray-400\">No manufacturing or Workshop Operations Blueprint selected.</p>";
  container.querySelectorAll(".content-template-linked-select").forEach(
    refreshLinkedTemplatePickerLabel,
  );
  container.querySelectorAll(".product-variant-content-link-row").forEach((row) =>
    refreshProductBlueprintRoleConstraint(row),
  );
  container.querySelectorAll(".product-variant-content-link-row").forEach(
    refreshProductBlueprintConnectionSummary,
  );
  filterVariantOwnedConnections(
    document.getElementById("contentVariantOwnedConnections")?.dataset.activeProductVariantId || "",
  );
}

function addProductVariantContentLinkRow(productVariantId = "") {
  renderProductVariantContentLinkRows([
    ...productVariantContentLinksFromRows(true),
    { productVariantId, entityType: "Blueprint", entityId: "", entityVariantId: "", linkRole: "ManufacturedFrom" },
  ]);
}

function productUnlocksFromRows(includeIncomplete = false) {
  return [...document.querySelectorAll(".content-product-unlock-row")].map((row) => ({
    productVariantId: row.querySelector(".content-product-unlock-variant")?.value || "",
    accessEntityType: row.querySelector(".content-product-unlock-type")?.value || "Plan",
    accessEntityId: row.querySelector(".content-product-unlock-target")?.value || "",
    accessEntityVariantId:
      row.querySelector(".content-product-unlock-target-variant")?.value || "",
    grantTiming: "on-payment-confirmed",
    durationType: row.querySelector(".content-product-unlock-duration-type")?.value || "permanent",
    durationValue: optionalNumberFromElement(
      row.querySelector(".content-product-unlock-duration-value"),
    ),
    endsAt: row.querySelector(".content-product-unlock-ends-at")?.value || "",
    revocable: true,
    status: "active",
  })).filter((grant) => includeIncomplete || grant.accessEntityId);
}

function renderProductUnlockRows(grants = []) {
  const container = document.getElementById("contentProductUnlockRows");
  if (!container) return;
  const rows = grants.length ? grants : [];
  container.innerHTML = rows.map((grant, index) => {
    const entityType = ["Item", "Blueprint", "Plan"].includes(grant.accessEntityType)
      ? grant.accessEntityType
      : "Plan";
    const options = productUnlockOptions(entityType);
    const typeOptions = ["Item", "Blueprint", "Plan"].map((type) => {
      const selected = type === entityType ? " selected" : "";
      return `<option value="${type}"${selected}>${type}</option>`;
    }).join("");
    const targetOptions = options.map((record) => {
      const selected = record.id === grant.accessEntityId ? " selected" : "";
      const label = `${record.name || record.id} (${record.id})`;
      return `<option value="${escapeHTML(record.id)}"${selected}>${escapeHTML(label)}</option>`;
    }).join("");
    const variantOptions = currentProductVariants().map((variant) => {
      const selected = variant.variantId === grant.productVariantId ? " selected" : "";
      return `<option value="${escapeHTML(variant.variantId)}"${selected}>${escapeHTML(variant.name || variant.variantId)}</option>`;
    }).join("");
    const targetVariantOptions = productUnlockTargetVariants(entityType, grant.accessEntityId)
      .map((variant, variantIndex) => {
        const variantId = variant.entityVariantId || variant.id || `VARIANT-${variantIndex + 1}`;
        const selected = variantId === grant.accessEntityVariantId ? " selected" : "";
        const label = variant.name || variant.variantName || variantId;
        return `<option value="${escapeHTML(variantId)}"${selected}>${escapeHTML(label)}</option>`;
      }).join("");
    const durationType = ["days", "weeks", "months", "years"].includes(grant.durationType)
      ? grant.durationType : "";
    const targetRecord = options.find((record) => record.id === grant.accessEntityId);
    const targetVariant = productUnlockTargetVariants(entityType, grant.accessEntityId)
      .find((variant) => linkedSelectorVariantId(variant) === grant.accessEntityVariantId);
    const selectionLabel = targetRecord
      ? `${targetRecord.name || targetRecord.id}${targetVariant ? ` → ${targetVariant.name || linkedSelectorVariantId(targetVariant)}` : " → All variants"}`
      : "No unlock selected";
    return `
      <div class="content-product-unlock-row grid min-w-0 gap-3 overflow-hidden rounded border border-gray-700 bg-gray-950/40 p-3 md:grid-cols-[minmax(14rem,1fr)_10rem_8rem_10rem_auto] md:items-end">
        <select class="content-product-unlock-variant hidden">
          <option value=""${grant.productVariantId ? "" : " selected"}>Choose Product variant${grant.productVariantId ? "" : " — legacy all-variant unlock"}</option>
          ${variantOptions}
        </select>
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">${escapeHTML(entityType)} unlock</p>
          <p class="mt-1 break-words text-sm text-[#9edbd7]">${escapeHTML(selectionLabel)}</p>
        </div>
        <label class="min-w-0 text-xs text-gray-400">Unlock content type
          <select class="content-product-unlock-type mt-1 w-full min-w-0 rounded bg-gray-800 px-2 py-2 text-sm text-white"
            data-row-index="${index}">
            ${typeOptions}
          </select>
        </label>
        <span class="content-template-linked-picker hidden">
          <select class="content-product-unlock-target content-template-linked-select hidden"
            data-field-key="product-unlock-${escapeHTML(grant.productVariantId || "all")}-${index}"
            data-field-name="${escapeHTML(`${entityType} to unlock`)}"
            data-field-type="linked" data-linked-table="${escapeHTML(`${entityType}s`)}"
            data-allow-record-reuse="true" data-selector-multiple="true"
            data-relationship-label="Purchasing this variant unlocks"
            data-linked-type-filter="" data-linked-status-filter="" data-linked-tag-filters="">
            <option value="">Choose content to unlock</option>
            ${targetOptions}
          </select>
          <button type="button" class="open-content-linked-selector">Choose content to unlock</button>
          <button type="button" class="edit-selected-linked-record" disabled>Edit selected</button>
        </span>
        <select class="content-product-unlock-target-variant hidden"
          ${targetVariantOptions ? "" : "disabled"}>
          <option value="">${targetVariantOptions ? "All content variants" : "No content variants"}</option>
          ${targetVariantOptions}
        </select>
        <label class="min-w-0 text-xs text-gray-400">Duration
          <select class="content-product-unlock-duration-type mt-1 w-full min-w-0 rounded bg-gray-800 px-2 py-2 text-white">
            <option value=""${durationType ? "" : " selected"}>Leave blank — permanent access</option>
            ${compactSelectOptions(["days", "weeks", "months", "years"], durationType)}
          </select>
        </label>
        <label class="min-w-0 text-xs text-gray-400">Amount
          <input class="content-product-unlock-duration-value mt-1 w-full min-w-0 rounded bg-gray-800 px-2 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
            type="number" min="1" step="1" value="${escapeHTML(durationType ? grant.durationValue ?? "" : "")}"
            placeholder="${durationType ? `Number of ${escapeHTML(durationType)}` : "Select a duration first"}"${durationType ? "" : " disabled"}>
        </label>
        <label class="text-xs text-gray-400">Or expires on
          <input class="content-product-unlock-ends-at mt-1 w-full rounded bg-gray-800 px-2 py-2 text-white"
            type="datetime-local" value="${escapeHTML(grant.endsAt || "")}">
        </label>
        <button type="button"
          class="remove-content-product-unlock rounded border border-red-700 px-3 py-2 text-xs text-red-200">
          Remove
        </button>
      </div>
    `;
  }).join("") || "<p class=\"text-xs text-gray-400\">No additional content unlocks selected.</p>";
  container.querySelectorAll(".content-product-unlock-target").forEach(
    refreshLinkedTemplatePickerLabel,
  );
  filterVariantOwnedConnections(
    document.getElementById("contentVariantOwnedConnections")?.dataset.activeProductVariantId || "",
  );
}

function filterVariantOwnedConnections(productVariantId = "") {
  const owner = document.getElementById("contentVariantOwnedConnections");
  if (owner) owner.dataset.activeProductVariantId = productVariantId;
  document.querySelectorAll(".product-variant-content-link-row").forEach((row) => {
    const rowVariantId = row.querySelector(".variant-content-product-variant")?.value || "";
    row.classList.toggle("hidden", !!productVariantId && !!rowVariantId && rowVariantId !== productVariantId);
  });
  document.querySelectorAll(".content-product-unlock-row").forEach((row) => {
    const rowVariantId = row.querySelector(".content-product-unlock-variant")?.value || "";
    row.classList.toggle("hidden", !!productVariantId && !!rowVariantId && rowVariantId !== productVariantId);
  });
}

function openVariantOwnedConnections(row, connection) {
  syncSelectedProductVariantRows();
  const owner = document.getElementById("contentVariantOwnedConnections");
  const productVariantId = row?.querySelector(".product-variant-id")?.value.trim() ||
    row?.dataset.productVariantId || "";
  if (!owner || !productVariantId) {
    showToast("Save a Product variant ID before adding connections.", "error");
    return null;
  }
  row.dataset.productVariantId = productVariantId;
  owner.classList.remove("hidden");
  filterVariantOwnedConnections(productVariantId);
  const variantName = row.querySelector(".product-variant-name")?.value.trim() || productVariantId;
  const summary = document.getElementById("contentVariantOwnedConnectionsSummary");
  if (summary) summary.textContent = `Editing ${connection === "blueprint" ? "Blueprints" : "Unlocks"} for ${variantName}.`;
  return productVariantId;
}

function addProductUnlockRow(productVariantId = "") {
  renderProductUnlockRows([
    ...productUnlocksFromRows(true),
    {
      productVariantId,
      accessEntityType: "Plan",
      accessEntityId: "",
      accessEntityVariantId: "",
      durationType: "permanent",
      durationValue: null,
      endsAt: "",
    },
  ]);
}

function updateProductRelationStatus(record) {
  const status = document.getElementById("contentProductRelationStatus");
  const unlinkButton = document.getElementById("unlinkContentProductBtn");
  const connectionPicker = document.getElementById("contentProductConnectionPicker");
  if (!status) return;
  const productId = record?.productId || record?.itemProductId || "";
  const entityType = currentRecordType();
  const entityId = document.getElementById("contentId")?.value || state.editingRecord?.id || "new entity";
  const entityName = document.getElementById("contentName")?.value || state.editingRecord?.name || "";
  status.textContent = productId
    ? `Linked: ${productId} ↔ ${entityType} ${entityName || entityId} (${entityId})`
    : `No Product linked to ${entityType} ${entityName || entityId}`;
  status.classList.toggle("bg-green-900/60", !!productId);
  status.classList.toggle("text-green-200", !!productId);
  status.classList.toggle("bg-gray-800", !productId);
  status.classList.toggle("text-gray-300", !productId);
  unlinkButton?.classList.toggle("hidden", !productId);
  connectionPicker?.classList.toggle("hidden", !!productId || currentRecordType() !== "blueprint");
}

function renderCurrentAssets(record) {
  const section = document.getElementById("contentCurrentAssetsSection");
  const list = document.getElementById("contentCurrentAssetsList");
  if (!list) return;
  const shownInTemplateFields = selectedAssetTemplateFields().length > 0;
  section?.classList.toggle("hidden", shownInTemplateFields);
  if (shownInTemplateFields) return;
  const assets = Array.isArray(record?.assets) ? record.assets : [];
  if (!assets.length) {
    list.textContent = "No linked source Assets.";
    return;
  }
  list.innerHTML = assets.map((asset) => `
    <div class="rounded border border-gray-700 bg-gray-950/60 p-2">
      <div class="font-medium text-white">${escapeHTML(asset.title || asset.assetId || "Asset")}</div>
      <div class="mt-1 text-gray-400">
        ${escapeHTML(asset.purpose || "No purpose")} | ${escapeHTML(asset.type || "unknown")}
      </div>
      <div class="mt-1 break-all text-gray-500">${escapeHTML(asset.url || "No file URL")}</div>
    </div>
  `).join("");
}

function moneyLabel(value) {
  if (value === "" || value === null || value === undefined) return "No price set";
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "No price set";
}

function reviewFieldLabel(key) {
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function reviewRecord(id) {
  const value = String(id || "").trim();
  if (!value) return null;
  for (const collection of ["items", "blueprints", "plans", "assets"]) {
    const record = (state.records[collection] || []).find((candidate) => candidate.id === value);
    if (record) return { ...record, collection };
  }
  return null;
}

function reviewValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(reviewValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const linkedId = value.entityId || value.assetId || value.itemId || value.blueprintId ||
      value.planId || value.id;
    if (linkedId) {
      const linked = reviewRecord(linkedId);
      const variant = (linked?.entityVariants || []).find((candidate) =>
        (candidate.entityVariantId || candidate.id) === value.entityVariantId);
      const label = linked ? `${linked.name || linked.title || linked.id} (${linked.id})` : String(linkedId);
      return variant ? `${label} / ${variant.name || variant.entityVariantId || variant.id}` : label;
    }
    return Object.entries(value)
      .map(([key, entry]) => `${reviewFieldLabel(key)}: ${reviewValue(entry)}`)
      .filter((entry) => !entry.endsWith(": "))
      .join("; ");
  }
  const linked = reviewRecord(value);
  return linked ? `${linked.name || linked.title || linked.id} (${linked.id})` : String(value);
}

function reviewLinkedRecords(value, collection) {
  const ids = [];
  const visit = (entry) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (entry && typeof entry === "object") {
      visit(entry.entityId || entry.id || "");
      return;
    }
    const record = reviewRecord(entry);
    if (record?.collection === collection) ids.push(record.id);
  };
  visit(value);
  return uniqueValues(ids).map((id) => reviewRecord(id));
}

function selectedNewTagsFromControls(validate = true) {
  const tags = [...document.querySelectorAll("#contentTagRows .content-tag-row")].flatMap((row) => {
    if (row.dataset.newTagName) {
      return [{ name: row.dataset.newTagName, categoryId: row.dataset.newTagCategoryId || "" }];
    }
    if (row.querySelector(".content-tag-new")?.classList.contains("hidden")) return [];
    const name = row.querySelector(".content-tag-new")?.value.trim() || "";
    const categoryId = row.querySelector(".content-tag-new-category")?.value || "";
    return name ? [{ name, categoryId }] : [];
  });
  const uncategorized = tags.find((tag) => !tag.categoryId);
  if (validate && uncategorized) {
    throw new Error(`Choose a tag category for "${uncategorized.name}".`);
  }
  return tags;
}

function reviewConnectionChips(label, records) {
  if (!records.length) return "";
  return `<div>
    <div class="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">${escapeHTML(label)}</div>
    <div class="flex flex-wrap gap-2">${records.map((record) => `
      <span class="rounded-full border border-[#407471]/70 bg-[#153b38]/40 px-3 py-1 text-xs text-[#bce7e4]">
        ${escapeHTML(record.name || record.title || record.id)}
      </span>`).join("")}</div>
  </div>`;
}

function renderDetailedVariantReview(variants) {
  const container = document.getElementById("contentVariantReviewRows");
  if (!container) return;
  const definitions = templateDefinitions(currentRecordType(), document.getElementById("contentType")?.value);
  container.innerHTML = variants.map((variant, index) => {
    const definition = definitions.find((candidate) => candidate.id === variant.templateVariantId);
    const values = variant.templateFieldValues || {};
    const fields = Object.entries(values)
      .map(([key, value]) => ({ key, value: reviewValue(value) }))
      .filter((field) => field.value);
    const recipeItems = (variant.linkedItemComponents || []).map((component) => {
      const item = reviewRecord(component.itemId);
      const itemVariant = component.itemVariantId ? ` / ${component.itemVariantId}` : "";
      return `<li>${escapeHTML(`${component.quantity} × ${item?.name || component.itemId}${itemVariant}`)}</li>`;
    }).join("");
    const linkedItems = reviewLinkedRecords(values, "items");
    const linkedBlueprints = reviewLinkedRecords(values, "blueprints");
    const linkedPlans = reviewLinkedRecords(values, "plans");
    const linkedAssets = reviewLinkedRecords(values, "assets");
    return `<details class="content-variant-review-row relative overflow-hidden rounded border border-gray-700 bg-gray-900/60" ${index === 0 ? "open" : ""} data-entity-variant-id="${escapeHTML(variant.entityVariantId)}">
      <summary class="cursor-pointer bg-gray-800/80 p-4 sm:pr-48">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 class="font-semibold text-white">${escapeHTML(variant.name || `Variant ${index + 1}`)}</h4>
            <p class="mt-1 text-xs text-gray-400">${escapeHTML(definition ? templateOptionLabel(definition) : "No template selected")}</p>
          </div>
        </div>
      </summary>
      <label class="block border-y border-gray-700 bg-gray-800/50 p-3 text-xs text-gray-300 sm:absolute sm:right-3 sm:top-3 sm:z-10 sm:border-0 sm:bg-transparent sm:p-0">Variant status
        <select class="content-entity-variant-status ml-2 rounded-full border px-3 py-1 text-xs ${lifecycleStatusClasses(variant.status)}">
          ${compactSelectOptions(["draft", "review", "active", "paused", "archived"], variant.status || "draft")}
        </select>
      </label>
      <div class="space-y-5 p-4">
        <input class="content-entity-variant-active-at" type="hidden" value="${escapeHTML(variant.scheduledActiveAt || "")}">
        <input class="content-entity-variant-pause-at" type="hidden" value="${escapeHTML(variant.scheduledPauseAt || "")}">
        ${fields.length ? `<dl class="grid gap-x-6 gap-y-4 md:grid-cols-2">${fields.map((field) => `
          <div class="border-b border-gray-800 pb-3">
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">${escapeHTML(reviewFieldLabel(field.key))}</dt>
            <dd class="mt-1 whitespace-pre-wrap text-sm text-gray-100">${escapeHTML(field.value)}</dd>
          </div>`).join("")}</dl>` : `<p class="text-sm text-gray-400">No template field content entered.</p>`}
        ${recipeItems ? `<div><div class="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Recipe Items</div><ul class="space-y-1 text-sm text-gray-200">${recipeItems}</ul></div>` : ""}
        ${reviewConnectionChips("Connected Items", linkedItems)}
        ${reviewConnectionChips("Connected Blueprints", linkedBlueprints)}
        ${reviewConnectionChips("Connected Plans", linkedPlans)}
        ${reviewConnectionChips("Connected Assets", linkedAssets)}
        <div class="grid gap-3 border-t border-gray-800 pt-4 text-xs text-gray-400 sm:grid-cols-2">
          <div><span class="text-gray-500">Owner:</span> ${escapeHTML(variant.owner || "Not entered")}</div>
          <div><span class="text-gray-500">References:</span> ${escapeHTML((variant.references || []).join(", ") || "None")}</div>
        </div>
      </div>
    </details>`;
  }).join("");
  const entityStatus = document.getElementById("contentReviewEntityStatus");
  if (entityStatus) {
    entityStatus.value = document.getElementById("contentStatus")?.value || "draft";
    applyLifecycleStatusHighlight(entityStatus);
  }
}

function connectionErdTableList(rows = [], emptyLabel = "None connected") {
  if (!rows.length) return `<span class="text-sm text-gray-500">${escapeHTML(emptyLabel)}</span>`;
  return `<ul class="space-y-1">${rows.map((row) => `
    <li class="flex items-start justify-between gap-3 text-sm">
      <span class="min-w-0 break-words text-gray-100">${escapeHTML(row.label || row)}</span>
      <span class="flex max-w-[55%] flex-wrap items-center justify-end gap-2 text-right">
        ${row.meta ? `<span class="break-words text-xs text-gray-400">${escapeHTML(row.meta)}</span>` : ""}
        ${row.action ? `<button type="button" data-connection-action="${escapeHTML(row.action)}"
          ${row.variantId ? `data-connection-variant-id="${escapeHTML(row.variantId)}"` : ""}
          class="rounded border border-gray-600 px-2 py-0.5 text-xs text-[#bce7e4] hover:border-white hover:text-white">${escapeHTML(row.actionLabel || "Edit")}</button>` : ""}
      </span>
    </li>`).join("")}</ul>`;
}

function connectionErdTable({ eyebrow, title, rows = [], tone = "teal" }) {
  const tones = {
    blue: "border-blue-500 bg-[#07142f]",
    teal: "border-[#407471] bg-[#081d20]",
    violet: "border-violet-500 bg-[#17102d]",
    amber: "border-amber-500 bg-[#241a08]",
  };
  return `<section class="relative z-10 min-w-0 max-w-full overflow-hidden rounded-lg border-2 ${tones[tone] || tones.teal} shadow-xl">
    <header class="border-b border-current/40 px-4 py-3">
      <div class="break-words text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">${escapeHTML(eyebrow)}</div>
      <h4 class="mt-1 break-words text-lg font-semibold leading-6 text-white">${escapeHTML(title)}</h4>
    </header>
    <div class="divide-y divide-white/10">${rows.map((row) => `
      <div class="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div class="min-w-0">
          <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">${escapeHTML(row.label)}</div>
          ${connectionErdTableList(row.rows || [], row.emptyLabel)}
        </div>
        ${row.action ? `<button type="button" data-connection-action="${escapeHTML(row.action)}"
          class="rounded border border-gray-500 px-2 py-1 text-xs leading-4 text-[#bce7e4] hover:border-white hover:text-white">${escapeHTML(row.actionLabel || "Open")}</button>` : ""}
      </div>`).join("")}</div>
  </section>`;
}

function connectionErdVariantColumns({
  title,
  recordType,
  entityType = "",
  variants = [],
  record = null,
}) {
  const definitions = state.options.templateDefinitions?.[recordType] || [];
  const mainAssetIds = uniqueValues((Array.isArray(record?.assets) ? record.assets : [])
    .map((asset) => typeof asset === "string" ? asset : asset.assetId || asset.id));
  const assetRecord = (assetId) => (state.records.assets || [])
    .find((candidate) => candidate.id === assetId);
  const assetName = (assetId) => {
    const asset = assetRecord(assetId);
    return asset?.name || asset?.assetName || asset?.title || assetId;
  };
  const assetMarkup = (assetId) => {
    const asset = assetRecord(assetId);
    const url = asset?.fileUrl || asset?.url || asset?.imageUrl || "";
    const image = normalizedText(asset?.assetType || asset?.type) === "image" ||
      /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url);
    return `<li class="flex items-center gap-2 text-sm text-gray-100">
      ${image && url ? `<img src="${escapeHTML(url)}" alt="" class="h-10 w-10 shrink-0 rounded border border-gray-700 object-cover">` : ""}
      <span class="min-w-0 break-words">${escapeHTML(assetName(assetId))}</span>
    </li>`;
  };
  const entityStatus = document.getElementById("contentStatus")?.value || record?.status || "draft";
  const columns = variants.map((variant, index) => {
    const definition = definitions.find((candidate) =>
      candidate.id === variant.templateVariantId || candidate.templateId === variant.templateId);
    const fieldRows = templateFields(definition).map((field, fieldIndex) => {
      const name = field.name || `Field ${fieldIndex + 1}`;
      const key = templateFieldKey(field.key || field.id || name) || `field_${fieldIndex + 1}`;
      const value = variant.templateFieldValues?.[key];
      const linkedCollection = {
        item: "items", items: "items", blueprint: "blueprints", blueprints: "blueprints",
        plan: "plans", plans: "plans", asset: "assets", assets: "assets",
        "item asset": "assets", "item assets": "assets",
      }[normalizedType(field.linkedTable)];
      const collection = linkedCollection || (assetTypeForTemplateField(field) ? "assets" : "");
      const records = collection ? reviewLinkedRecords(value, collection) : [];
      const values = records.length
        ? records.map((linked) => linked.name || linked.title || linked.id)
        : reviewValue(value) ? [reviewValue(value)] : [];
      return {
        key,
        name,
        values,
        linked: Boolean(collection),
        isAssetField: collection === "assets",
        assetIds: collection === "assets" ? records.map((linked) => linked.id) : [],
      };
    });
    const variantAssetIds = uniqueValues(templateAssetLinksForVariant(variant)
      .map((link) => link.assetId));
    const namedAssetIds = new Set(fieldRows.flatMap((field) => field.assetIds));
    const otherAssetIds = variantAssetIds.filter((assetId) => !namedAssetIds.has(assetId));
    const hasNamedAssetField = fieldRows.some((field) => field.isAssetField);
    const showItemStock = recordType === "item";
    const stockEnabled = variant.behaviourDefaults?.inventoryTracked === true;
    const stockSummary = stockEnabled
      ? `Stock ${Number(variant.stockQty ?? 0)} · Reorder ${Number(variant.reorderLevel ?? 0)}` +
        `${variant.inventoryUnit ? ` · ${escapeHTML(variant.inventoryUnit)}` : ""}`
      : "Inventory not tracked";
    return `<article class="min-w-[17rem] flex-1 overflow-hidden rounded border border-[#407471]/70 bg-gray-950/45">
      <header class="border-b border-[#407471]/40 bg-[#153b38]/45 p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h5 class="break-words font-semibold text-white">${escapeHTML(variant.name || `Variant ${index + 1}`)}</h5>
            <p class="mt-1 break-words text-xs text-gray-400">${escapeHTML(definition ? templateOptionLabel(definition) : "No template")}</p>
          </div>
          <button type="button" data-connection-action="entity-status"
            data-connection-entity-variant-id="${escapeHTML(variant.entityVariantId)}"
            class="shrink-0 rounded-full border px-2 py-1 text-[10px] ${lifecycleStatusClasses(variant.status)} hover:ring-2">${escapeHTML(variant.status || "draft")}</button>
        </div>
        <button type="button" data-connection-action="entity"
          data-connection-entity-variant-id="${escapeHTML(variant.entityVariantId)}"
          class="mt-3 rounded border border-gray-600 px-2 py-1 text-xs text-[#bce7e4] hover:border-white hover:text-white">Edit variant</button>
      </header>
      <div class="divide-y divide-white/10">
        ${showItemStock ? `<section class="p-3"><div class="flex items-start justify-between gap-2">
          <div><div class="text-xs font-semibold uppercase tracking-wide text-gray-400">${escapeHTML(title)} stock</div>
            <p class="mt-1 text-sm ${stockEnabled ? "text-gray-100" : "text-gray-500"}">${stockSummary}</p></div>
          <button type="button" data-connection-action="inventory-stocktake"
            data-connection-entity-id="${escapeHTML(record?.id || document.getElementById("contentId")?.value || "")}" data-connection-entity-name="${escapeHTML(title)}"
            data-connection-entity-variant-id="${escapeHTML(variant.entityVariantId)}"
            class="shrink-0 rounded border border-gray-600 px-2 py-1 text-xs text-[#bce7e4] hover:border-white">Edit inventory</button>
        </div></section>` : ""}
        ${otherAssetIds.length || !hasNamedAssetField ? `<section class="p-3">
          <div>
            <div class="min-w-0"><div class="text-xs font-semibold uppercase tracking-wide text-gray-400">${hasNamedAssetField ? "Other Assets" : "Assets"}</div>
              ${otherAssetIds.length ? `<ul class="mt-2 space-y-2">${otherAssetIds.map(assetMarkup).join("")}</ul>` : `<span class="text-sm text-gray-500">No variant Assets</span>`}</div>
          </div>
        </section>` : ""}
        ${fieldRows.map((field) => `<section class="p-3">
          <div>
            <div class="min-w-0"><div class="break-words text-xs font-semibold uppercase tracking-wide text-gray-400">${escapeHTML(field.name)}</div>
              ${field.assetIds.length ? `<ul class="mt-2 space-y-2">${field.assetIds.map(assetMarkup).join("")}</ul>` : connectionErdTableList(field.values.map((value) => ({ label: value })), "Not set")}</div>
          </div>
        </section>`).join("")}
      </div>
    </article>`;
  }).join("");
  return `<section class="relative z-10 min-w-0 max-w-full overflow-hidden rounded-lg border-2 border-[#407471] bg-[#081d20] shadow-xl">
    <header class="border-b border-[#407471]/40 px-4 py-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">${escapeHTML(recordType)} · ${escapeHTML(entityType || "type not set")}</div>
          <h4 class="mt-1 break-words text-lg font-semibold leading-6 text-white">${escapeHTML(title)}</h4></div>
        <div class="flex flex-wrap gap-2">
          <button type="button" data-connection-action="entity" class="rounded border border-gray-500 px-3 py-1 text-xs text-[#bce7e4] hover:border-white">Edit entity</button>
          <button type="button" data-connection-action="entity-status"
            class="rounded-full border px-3 py-1 text-xs ${lifecycleStatusClasses(entityStatus)} hover:ring-2">Status: ${escapeHTML(entityStatus)}</button>
        </div>
      </div>
      ${mainAssetIds.length ? `<div class="mt-3"><div class="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Overall entity Assets</div>
        <ul class="mt-2 flex flex-wrap gap-3">${mainAssetIds.map(assetMarkup).join("")}</ul></div>` : ""}
    </header>
    <div class="overflow-x-auto p-3">
      <div class="flex min-w-full gap-3">${columns || `<p class="p-4 text-sm text-gray-400">No entity variants added.</p>`}</div>
    </div>
  </section>`;
}

function connectionErdProductVariantColumns({
  title,
  status = "draft",
  variants = [],
  price = "",
  blueprintLinks = [],
  operationsLinks = [],
  accessGrants = [],
  bundleComponents = [],
  tracksSeats = false,
}) {
  const blueprintName = (id) => (state.records.blueprints || [])
    .find((blueprint) => blueprint.id === id)?.name || id || "Blueprint";
  const productById = new Map((state.records.products || []).map((product) => [product.id, product]));
  const columns = variants.map((variant, index) => {
    const variantId = variant.variantId || "";
    const links = blueprintLinks.filter((link) => link.productVariantId === variantId);
    const workshopOperations = operationsLinks.filter((link) => link.productVariantId === variantId);
    const grants = accessGrants.filter((grant) => grant.productVariantId === variantId);
    const components = bundleComponents.filter((component) => component.ownerVariantId === variantId);
    const variantPrice = variant.priceOverride ?? price;
    return `<article class="min-w-[17rem] flex-1 overflow-hidden rounded border border-blue-500/70 bg-gray-950/45">
      <header class="border-b border-blue-500/40 bg-blue-950/40 p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0"><h5 class="break-words font-semibold text-white">${escapeHTML(variant.name || `Product variant ${index + 1}`)}</h5>
            <p class="mt-1 text-xs text-gray-400">${escapeHTML(variant.marketplaceMode || "Inherit visibility")} · ${escapeHTML(moneyLabel(variantPrice))}</p></div>
          <span class="shrink-0 rounded-full border px-2 py-1 text-[10px] ${lifecycleStatusClasses(variant.status)}">${escapeHTML(variant.status || "draft")}</span>
        </div>
        <button type="button" data-connection-action="product-variant"
          data-connection-variant-id="${escapeHTML(variantId)}" data-connection-product-section="identity"
          class="mt-3 rounded border border-gray-600 px-2 py-1 text-xs text-blue-200 hover:border-white hover:text-white">Edit Product variant</button>
      </header>
      <div class="divide-y divide-white/10">
        <section class="p-3"><div class="flex items-start justify-between gap-2">
          <div><div class="text-xs font-semibold uppercase tracking-wide text-gray-400">${tracksSeats ? "Ticketing" : "Product stock"}</div>
            <p class="mt-1 text-sm text-gray-100">${tracksSeats
    ? `Capacity ${Number(variant.seatCapacity ?? 0)} · Low-ticket warning ${Number(variant.nearCapacityWarning ?? 0)}`
    : `Stock ${Number(variant.stock ?? 0)}`}</p></div>
          <button type="button" data-connection-action="stock" data-connection-variant-id="${escapeHTML(variantId)}"
            class="rounded border border-gray-600 px-2 py-1 text-xs text-blue-200 hover:border-white">Edit</button>
        </div></section>
        <section class="p-3"><div class="flex items-start justify-between gap-2">
          <div class="min-w-0"><div class="text-xs font-semibold uppercase tracking-wide text-gray-400">Manufacturing Blueprints</div>
            ${connectionErdTableList(links.map((link) => ({ label: blueprintName(link.entityId) })), "No manufacturing Blueprint")}</div>
          <button type="button" data-connection-action="blueprint-manufacturing" data-connection-variant-id="${escapeHTML(variantId)}"
            class="rounded border border-gray-600 px-2 py-1 text-xs text-blue-200 hover:border-white">${links.length ? "Edit" : "Connect"}</button>
        </div></section>
        ${operationsLinks.length ? `<section class="p-3"><div class="flex items-start justify-between gap-2">
          <div class="min-w-0"><div class="text-xs font-semibold uppercase tracking-wide text-gray-400">Workshop Operations</div>
            ${connectionErdTableList(workshopOperations.map((link) => ({ label: blueprintName(link.entityId) })), "No Workshop Operations Blueprint")}</div>
          <button type="button" data-connection-action="blueprint-operations" data-connection-variant-id="${escapeHTML(variantId)}"
            class="rounded border border-gray-600 px-2 py-1 text-xs text-blue-200 hover:border-white">${workshopOperations.length ? "Edit" : "Connect"}</button>
        </div></section>` : ""}
        <section class="p-3"><div class="flex items-start justify-between gap-2">
          <div class="min-w-0"><div class="text-xs font-semibold uppercase tracking-wide text-gray-400">Purchase access</div>
            ${connectionErdTableList(grants.map((grant) => ({ label: `${grant.accessEntityType || "Entity"}: ${grant.accessEntityId || "Not selected"}` })), "No purchase unlocks")}</div>
          <button type="button" data-connection-action="product-unlocks" data-connection-variant-id="${escapeHTML(variantId)}"
            class="rounded border border-gray-600 px-2 py-1 text-xs text-blue-200 hover:border-white">Edit</button>
        </div></section>
        <section class="p-3"><div class="flex items-start justify-between gap-2">
          <div class="min-w-0"><div class="text-xs font-semibold uppercase tracking-wide text-gray-400">Bundle components</div>
            ${connectionErdTableList(components.map((component) => {
    const product = productById.get(component.componentProductId);
    const included = product?.variants?.find((candidate) =>
      candidate.variantId === component.componentProductVariantId);
    return { label: `${component.quantity || 1} × ${product?.name || component.componentProductId}`, meta: included?.name || "" };
  }), "No bundle components")}</div>
          <button type="button" data-connection-action="bundle" data-connection-variant-id="${escapeHTML(variantId)}"
            class="rounded border border-gray-600 px-2 py-1 text-xs text-blue-200 hover:border-white">${components.length ? "Edit" : "Add"}</button>
        </div></section>
      </div>
    </article>`;
  }).join("");
  return `<section class="relative z-10 min-w-0 max-w-full overflow-hidden rounded-lg border-2 border-blue-500 bg-[#07142f] shadow-xl">
    <header class="border-b border-blue-500/40 px-4 py-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Outward connection</div>
          <h4 class="mt-1 break-words text-lg font-semibold leading-6 text-white">${escapeHTML(title)}</h4></div>
        <div class="flex flex-wrap gap-2">
          <button type="button" data-connection-action="product" class="rounded border border-gray-500 px-3 py-1 text-xs text-blue-200 hover:border-white">Edit Product</button>
          <button type="button" data-connection-action="product-status"
            class="rounded-full border px-3 py-1 text-xs ${lifecycleStatusClasses(status)} hover:ring-2">Status: ${escapeHTML(status)}</button>
        </div>
      </div>
    </header>
    <div class="overflow-x-auto p-3"><div class="flex min-w-full gap-3">
      ${columns || `<p class="p-4 text-sm text-gray-400">No Product variants added.</p>`}
    </div></div>
  </section>`;
}

function contentErdBranchVisible(branch) {
  const checkbox = document.getElementById(
    branch === "library" ? "contentShowLibraryErd" : "contentShowProductErd",
  );
  return checkbox?.checked !== false;
}

function setContentErdBranchDefaults(record = null) {
  const variants = Array.isArray(record?.entityVariants) ? record.entityVariants : [];
  const hasProduct = !!(record?.productId || record?.itemProductId || record?.createsProduct ||
    variants.some((variant) => variant.shopEnabled === true));
  const hasLibrary = !!(record?.websiteVisible || record?.requestedWebsiteVisible ||
    variants.some((variant) => variant.libraryVisible === true));
  setCheckboxValue("contentShowProductErd", hasProduct);
  setCheckboxValue("contentShowLibraryErd", hasLibrary);
  const productLabel = document.getElementById("contentShowProductErdLabel");
  const libraryLabel = document.getElementById("contentShowLibraryErdLabel");
  if (productLabel) productLabel.textContent = hasProduct ? "Product — connected" : "Product — not connected";
  if (libraryLabel) libraryLabel.textContent = hasLibrary ? "Library — connected" : "Library — not connected";
}

function setConnectionDrawerOpen(id, open) {
  const drawer = document.getElementById(id);
  if (!drawer) return;
  drawer.classList.toggle("hidden", !open);
  drawer.setAttribute("aria-hidden", String(!open));
  drawer.inert = !open;
}

function openLibraryConnectionDrawer() {
  const container = document.getElementById("contentLibraryConnectionVariantRows");
  if (!container) return;
  const variants = entityVariantsFromBuilder();
  container.innerHTML = variants.map((variant) => `
    <label class="flex items-start gap-3 rounded border border-gray-700 bg-gray-900/70 p-3">
      <input type="checkbox" class="erd-library-variant mt-1 accent-[#407471]"
        data-entity-variant-id="${escapeHTML(variant.entityVariantId)}"${variant.libraryVisible ? " checked" : ""}>
      <span><strong class="block text-white">${escapeHTML(variant.name)}</strong>
        <span class="mt-1 block text-xs text-gray-400">${escapeHTML(variant.status || "draft")}</span></span>
    </label>`).join("") || "<p class=\"text-sm text-gray-400\">Add an entity variant before connecting the Library.</p>";
  setConnectionDrawerOpen("contentLibraryConnectionDrawer", true);
}

function applyLibraryConnectionDrawer() {
  const selected = new Set([...document.querySelectorAll(".erd-library-variant:checked")]
    .map((input) => input.dataset.entityVariantId));
  document.querySelectorAll(".content-variant-connection-row").forEach((row) => {
    const checkbox = row.querySelector(".variant-add-to-library");
    if (checkbox) checkbox.checked = selected.has(row.dataset.entityVariantId);
  });
  setCheckboxValue("contentWebsiteVisible", selected.size > 0);
  state.isDirty = true;
  setConnectionDrawerOpen("contentLibraryConnectionDrawer", false);
  renderBuilderSummaries();
  showToast(selected.size ? "Library connection updated. Save connections when ready." : "Library connection removed. Save connections when ready.", "success");
}

function entityStockIsEnabled() {
  return currentRecordType() === "item" && entityVariantsFromBuilder()
    .some((variant) => variant.behaviourDefaults?.inventoryTracked === true);
}

function openEntityStockDrawer(preferredVariantId = "") {
  if (!entityStockIsEnabled()) {
    showToast("Entity stock appears when the selected Item template enables Track entity inventory.", "info");
    return;
  }
  const container = document.getElementById("contentEntityStockDrawerRows");
  if (!container) return;
  container.replaceChildren();
  const allSections = [...document.querySelectorAll(
    ".content-variant-connection-row .variant-item-stock-fields",
  )];
  const sections = preferredVariantId
    ? allSections.filter((section) => section.dataset.entityVariantId === preferredVariantId)
    : allSections;
  entityStockDrawerSnapshot = sections.flatMap((section) =>
    [...section.querySelectorAll("input, select, textarea")].map((field) => ({
      field,
      value: field.value,
      checked: field.checked,
    })));
  sections.forEach((section) => container.appendChild(section));
  setConnectionDrawerOpen("contentEntityStockDrawer", true);
}

function closeEntityStockDrawer({ restoreValues = false } = {}) {
  if (restoreValues) {
    entityStockDrawerSnapshot.forEach(({ field, value, checked }) => {
      field.value = value;
      if (["checkbox", "radio"].includes(field.type)) field.checked = checked;
    });
  }
  const container = document.getElementById("contentEntityStockDrawerRows");
  [...(container?.querySelectorAll(".variant-item-stock-fields") || [])].forEach((section) => {
    const variantId = section.dataset.entityVariantId || "";
    const escapedVariantId = typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(variantId)
      : variantId.replace(/["\\]/g, "\\$&");
    const connectionRow = document.querySelector(
      `.content-variant-connection-row[data-entity-variant-id="${escapedVariantId}"]`,
    );
    connectionRow?.querySelector(":scope > div")?.appendChild(section);
    updateVariantOrderingButton(connectionRow);
  });
  entityStockDrawerSnapshot = [];
  setConnectionDrawerOpen("contentEntityStockDrawer", false);
}

function applyEntityStockDrawer() {
  closeEntityStockDrawer();
  state.isDirty = true;
  renderBuilderSummaries();
  showToast("Entity stock updated. Save connections when ready.", "success");
}

function productVariantRow(variantId = "") {
  if (!variantId) return document.querySelector(".content-product-variant-row");
  return document.querySelector(
    `.content-product-variant-row[data-product-variant-id="${CSS.escape(variantId)}"]`,
  );
}

function openProductVariantEditor(variantId = "", section = "identity") {
  setCheckboxValue("contentIsShopProduct", true);
  openContentProductDrawer();
  const row = productVariantRow(variantId);
  row?.querySelector(`[data-variant-editor="${CSS.escape(section)}"]`)?.click();
  row?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function openProductStatusEditor() {
  setCheckboxValue("contentIsShopProduct", true);
  openContentProductDrawer();
  const controls = document.querySelector(".content-product-status-checkbox")?.closest("fieldset");
  controls?.scrollIntoView({ behavior: "smooth", block: "center" });
  controls?.querySelector("input:checked")?.focus({ preventScroll: true });
}

function openProductBlueprintConnections(role = "ManufacturedFrom", requestedVariantId = "") {
  const variants = currentProductVariants();
  if (!variants.length) {
    showToast("Create at least one exact Product variant before attaching a Blueprint.", "error");
    return;
  }
  setCheckboxValue("contentIsShopProduct", true);
  openContentProductDrawer();
  const links = productVariantContentLinksFromRows(true);
  const existing = links.find((link) => link.linkRole === role) || null;
  const preferredVariantId = requestedVariantId || existing?.productVariantId || variants[0].variantId;
  const escapedVariantId = typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(preferredVariantId)
    : preferredVariantId.replace(/["\\]/g, "\\$&");
  const row = document.querySelector(
    `.content-product-variant-row[data-product-variant-id="${escapedVariantId}"]`,
  ) || document.querySelector(".content-product-variant-row");
  if (!row) return;
  document.querySelectorAll(".product-variant-editor-panel").forEach((panel) => {
    panel.classList.add("hidden");
    panel.dataset.editorSection = "";
  });
  const productVariantId = openVariantOwnedConnections(row, "blueprint");
  if (!productVariantId) return;
  const addButton = document.getElementById("addProductVariantContentLinkBtn");
  if (addButton) {
    addButton.dataset.productVariantId = productVariantId;
    addButton.disabled = false;
  }
  if (!links.some((link) => link.productVariantId === productVariantId && link.linkRole === role)) {
    renderProductVariantContentLinkRows([
      ...links,
      {
        productVariantId,
        entityType: "Blueprint",
        entityId: "",
        entityVariantId: "",
        linkRole: role,
        status: "active",
      },
    ]);
  }
  filterVariantOwnedConnections(productVariantId);
  const section = document.getElementById("productVariantContentLinkRows")?.closest("details");
  if (section) {
    section.classList.remove("hidden");
    section.open = true;
  }
  document.getElementById("contentProductUnlockRows")?.closest("section")?.classList.add("hidden");
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
  const connectionRow = [...document.querySelectorAll(".product-variant-content-link-row")]
    .find((candidate) =>
      candidate.querySelector(".variant-content-product-variant")?.value === productVariantId &&
      candidate.querySelector(".variant-content-link-role")?.value === role);
  setTimeout(() => connectionRow
    ?.querySelector(".open-content-linked-selector")?.click(), 0);
}

function openProductUnlockConnections(requestedVariantId = "") {
  const variants = currentProductVariants();
  if (!variants.length) {
    showToast("Create at least one exact Product variant before adding purchase access.", "error");
    return;
  }
  setCheckboxValue("contentIsShopProduct", true);
  openContentProductDrawer();
  const grants = productUnlocksFromRows(true);
  const preferredVariantId = requestedVariantId || grants[0]?.productVariantId || variants[0].variantId;
  const escapedVariantId = typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(preferredVariantId)
    : preferredVariantId.replace(/["\\]/g, "\\$&");
  const row = document.querySelector(
    `.content-product-variant-row[data-product-variant-id="${escapedVariantId}"]`,
  ) || document.querySelector(".content-product-variant-row");
  if (!row) return;
  document.querySelectorAll(".product-variant-editor-panel").forEach((panel) => {
    panel.classList.add("hidden");
    panel.dataset.editorSection = "";
  });
  const productVariantId = openVariantOwnedConnections(row, "unlock");
  if (!productVariantId) return;
  const addButton = document.getElementById("addContentProductUnlockBtn");
  if (addButton) {
    addButton.dataset.productVariantId = productVariantId;
    addButton.disabled = false;
  }
  if (!grants.some((grant) => grant.productVariantId === productVariantId)) {
    addProductUnlockRow(productVariantId);
  }
  filterVariantOwnedConnections(productVariantId);
  const section = document.getElementById("contentProductUnlockRows")?.closest("section");
  section?.classList.remove("hidden");
  const blueprintSection = document.getElementById("productVariantContentLinkRows")?.closest("details");
  if (blueprintSection) blueprintSection.open = false;
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderBuilderSummaries(record = state.editingRecord) {
  const relationships = document.getElementById("contentRelationshipSummary");
  const review = document.getElementById("contentReviewSummary");
  if (!relationships && !review) return;

  const productRelation = productRelationPayload() || {};
  const isShopProduct = isShopProductSelected();
  const price = productRelation.effectiveShopPrice ??
    record?.productEffectiveShopPrice ??
    record?.productPrice ??
    "";
  const variants = productRelation.variants || record?.productVariants ||
    record?.productRelation?.variants || [];
  const recordType = currentRecordType();
  const entityVariants = entityVariantsFromBuilder();
  const accessGrants = productRelation.accessGrants || record?.productAccessGrants || [];

  if (relationships) {
    const name = document.getElementById("contentName")?.value || record?.name || "Untitled content";
    const entityType = document.getElementById("contentType")?.value || record?.type || recordType;
    const variantContentLinks = [
      ...(record?.productVariantContentLinks || []),
      ...(record?.productRelation?.variantContentLinks || []),
      ...(productRelation.variantContentLinks || []),
    ].filter((link, index, links) => index === links.findIndex((candidate) =>
      candidate.productVariantId === link.productVariantId &&
      candidate.entityId === link.entityId &&
      candidate.entityVariantId === link.entityVariantId &&
      candidate.linkRole === link.linkRole));
    let manufacturingLinks = variantContentLinks.filter((link) =>
      link.linkRole === "ManufacturedFrom");
    const operationsLinks = variantContentLinks.filter((link) =>
      link.linkRole === "OperatedWith");
    const legacyManufacturingBlueprintId = productRelation.manufacturingBlueprintId ||
      record?.manufacturingBlueprintId || record?.productRelation?.manufacturingBlueprintId || "";
    if (!manufacturingLinks.length && legacyManufacturingBlueprintId) {
      manufacturingLinks = variants.map((variant) => ({
        productVariantId: variant.variantId,
        entityId: legacyManufacturingBlueprintId,
        entityVariantId: "",
        linkRole: "ManufacturedFrom",
      }));
    }
    const bundleComponents = variants.flatMap((variant) =>
      (variant.bundleComponents || []).map((component) => ({
        ...component,
        owner: variant.name,
        ownerVariantId: variant.variantId,
      })));
    const libraryRows = entityVariants.filter((variant) => variant.libraryVisible === true)
      .map((variant) => ({ label: variant.name, meta: variant.status || "draft" }));
    const productTable = connectionErdProductVariantColumns({
      title: isShopProduct ? "Product" : "Product not connected",
      status: productRelation.shopStatus || record?.productShopStatus ||
        record?.productRelation?.shopStatus || record?.shopStatus || "draft",
      variants,
      price,
      blueprintLinks: manufacturingLinks,
      operationsLinks,
      accessGrants,
      bundleComponents,
      tracksSeats: productRelation.tracksSeats === true || record?.productTracksSeats === true ||
        record?.productRelation?.tracksSeats === true,
    });
    const entityTable = connectionErdVariantColumns({
      title: name,
      recordType,
      entityType,
      variants: entityVariants,
      record,
    });
    const libraryTable = connectionErdTable({
      eyebrow: "Outward connection",
      title: "Library",
      tone: "violet",
      rows: [{ label: "Library variants", rows: libraryRows, emptyLabel: "No variants selected", action: "library", actionLabel: libraryRows.length ? "Edit selection" : "Select variants" }],
    });
    const showProductBranch = contentErdBranchVisible("product");
    const showLibraryBranch = contentErdBranchVisible("library");
    const visibleBranchCount = Number(showProductBranch) + Number(showLibraryBranch);
    const desktopGrid = visibleBranchCount === 2
      ? "2xl:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)_minmax(0,0.92fr)]"
      : visibleBranchCount === 1
        ? "2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        : "2xl:grid-cols-[minmax(0,44rem)] 2xl:justify-center";
    const entityDesktopOrder = showProductBranch ? "2xl:order-2" : "2xl:order-1";
    const connector = visibleBranchCount > 0
      ? `<div class="pointer-events-none absolute bottom-8 left-1/2 top-8 w-[3px] -translate-x-1/2 bg-gradient-to-b from-[#407471] via-blue-500 to-violet-500 2xl:hidden" aria-hidden="true"></div>
        <div class="pointer-events-none absolute left-[22%] right-[22%] top-[92px] hidden h-[3px] bg-gradient-to-r from-blue-500 via-[#407471] to-violet-500 2xl:block" aria-hidden="true"></div>`
      : "";

    relationships.innerHTML = `<div class="overflow-hidden rounded-xl border border-gray-800 bg-gray-950/60 p-3 sm:p-4 md:p-6">
      <div class="relative min-w-0">
        ${connector}
        <div class="relative z-10 grid min-w-0 gap-10 ${desktopGrid} 2xl:items-start 2xl:gap-12">
          ${showProductBranch ? `<div class="order-2 min-w-0 2xl:order-1">${productTable}</div>` : ""}
          <div class="order-1 min-w-0 ${entityDesktopOrder}">${entityTable}</div>
          ${showLibraryBranch ? `<div class="order-3 min-w-0 2xl:order-3">${libraryTable}</div>` : ""}
        </div>
      </div>
    </div>`;
  }

  if (review) {
    const name = document.getElementById("contentName")?.value || record?.name || "Untitled content";
    const type = document.getElementById("contentType")?.value || record?.type || "Not selected";
    const status = document.getElementById("contentStatus")?.value || record?.status || "draft";
    const tags = selectedTagsFromControls();
    const shortDescription = document.getElementById("contentShortDescription")?.value || "";
    const longDescription = document.getElementById("contentLongDescription")?.value || "";
    review.innerHTML = `
      <article class="overflow-hidden rounded border border-gray-700 bg-gray-900/60">
        <header class="border-b border-gray-700 bg-gray-800/70 p-5">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div class="text-xs font-medium uppercase tracking-wide text-[#9edbd7]">${escapeHTML(recordType)}</div>
              <h3 class="mt-1 text-2xl font-semibold text-white">${escapeHTML(name)}</h3>
              <div class="mt-2 text-sm text-gray-300">${escapeHTML(type)}</div>
            </div>
            <span class="rounded-full border px-4 py-2 text-sm font-medium ${lifecycleStatusClasses(status)}">${escapeHTML(status)}</span>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">${tags.length
    ? tags.map((tag) => `<span class="rounded-full bg-[#153b38] px-3 py-1 text-xs text-[#bce7e4]">${escapeHTML(tag)}</span>`).join("")
    : `<span class="text-xs text-gray-500">No tags selected</span>`}</div>
        </header>
        <div class="grid gap-6 p-5 lg:grid-cols-2">
          <section>
            <h4 class="text-xs font-medium uppercase tracking-wide text-gray-500">Short description</h4>
            <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-100">${escapeHTML(shortDescription || "Not entered")}</p>
          </section>
          <section>
            <h4 class="text-xs font-medium uppercase tracking-wide text-gray-500">Long description</h4>
            <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-100">${escapeHTML(longDescription || "Not entered")}</p>
          </section>
        </div>
      </article>`;
    renderDetailedVariantReview(entityVariants);
  }
}

function clearEditMode({ updateHistory = true, recordType = "" } = {}) {
  state.editingRecord = null;
  document.getElementById("contentBuilderForm")?.reset();
  if (recordType) setSelectValue("contentRecordType", recordType);
  document.getElementById("contentSoldByRecoveryTools").checked = true;
  renderTagControls([]);
  state.currentStep = 1;
  state.isDirty = false;
  updateEditBanner();
  updateFormForRecordType();
  if (updateHistory) history.pushState({}, "", "/admin/content/builder");
}

function populateNewBuilderFromRoute(params) {
  const recordType = singularRecordType(params.get("entity") || "item");
  clearEditMode({ updateHistory: false, recordType });
  hydrateMarketplaceTileControls({});

  const requestedType = params.get("contentType") || "";
  const requestedStatus = params.get("status") || "";
  setInputValue("contentName", params.get("name") || "");
  if (requestedType) {
    setSelectValue("contentType", requestedType);
    updateTemplatesForType();
  }
  if (requestedStatus) {
    setInputValue("contentStatus", requestedStatus === "awaiting-approval" ? "review" : requestedStatus);
  }
  if (params.get("visibility")) setInputValue("contentVisibility", params.get("visibility"));
  if (params.get("category")) setSelectValue("contentTagCategoryFilter", params.get("category"));
  const routeTags = uniqueValues([
    params.get("tag") || "",
    ...String(params.get("tags") || "").split(","),
  ]);
  if (routeTags.length) renderTagControls(routeTags);
  setCheckboxValue("contentIsShopProduct", params.get("product") === "1");
  setCheckboxValue("contentWebsiteVisible", params.get("websiteVisible") === "1");
  if (recordType === "item") {
    setCheckboxValue("contentProductFeatured", params.get("featured") === "1");
    setCheckboxValue("contentInventoryTracked", params.get("inventoryTracked") === "1");
    applyTemplateDrivenItemFields(selectedTemplate()?.defaults || {});
  }

  const routeVariants = entityVariantsFromBuilder();
  if (routeVariants[0]) {
    routeVariants[0].shopEnabled = params.get("product") === "1";
    routeVariants[0].libraryVisible = params.get("websiteVisible") === "1";
    renderEntityVariantRows(routeVariants);
  }

  state.currentStep = 1;
  state.isDirty = false;
  updateEditBanner();
  renderSimilarList();
  renderBuilderSummaries();
  showBuilderStep(1);
  setContentEntityEditorDrawerOpen(true);
}

function populateBuilderFromRecord(record) {
  const recordType = singularRecordType(record.recordType);
  state.editingRecord = { ...record, recordType };
  setContentErdBranchDefaults(record);

  setSelectValue("contentRecordType", recordType);
  updateFormForRecordType();
  const storedRecordType = record.type || record.itemType || "";
  const typeSelect = document.getElementById("contentType");
  if (recordType === "item" && normalizedText(storedRecordType) === "workshop" && typeSelect &&
      ![...typeSelect.options].some((option) => option.value === storedRecordType)) {
    typeSelect.add(new Option("workshop (legacy Item — move future Workshops to Plans)", storedRecordType));
  }
  setSelectValue("contentType", storedRecordType);
  updateTemplatesForType();
  setSelectValue("contentTemplate", record.templateId || record.template);
  renderTemplateGuidedFields();
  restoreTemplateGuidedValues({
    intendedOutput: record.intendedOutput,
    durationMinutes: record.durationMinutes,
    sizeLabel: record.sizeLabel,
    startDate: record.startDate,
    endDate: record.endDate,
    warmupBlueprintIds: (record.templateContent?.warmupBlueprintIds || []).join(", "),
    mainBlueprintIds: (record.templateContent?.mainBlueprintIds || []).join(", "),
    cooldownBlueprintIds: (record.templateContent?.cooldownBlueprintIds || []).join(", "),
    templateFieldValues: templateFieldValuesForRecord(record),
  });
  setInputValue("contentStatus", record.status || "draft");
  setInputValue("contentVisibility", record.visibility || "private");
  setInputValue("contentScheduledActiveAt", record.scheduledActiveAt || "");
  setInputValue("contentScheduledPauseAt", record.scheduledPauseAt || "");

  setInputValue("contentName", record.name);
  setInputValue("contentId", record.id);
  setInputValue("contentShortDescription", record.shortDescription || record.description || "");
  setInputValue(
    "contentLongDescription",
    record.longDescription || record.notes || record.description || record.shortDescription || "",
  );
  renderTagControls(record.tags || []);
  const storedVariants = Array.isArray(record.entityVariants) ? record.entityVariants : [];
  const legacyShopEnabled = record.productLinkRole !== "ManufacturedFrom" &&
    Boolean(record.productId || record.createsProduct || record.isShopProduct);
  const legacyLibraryVisible = Boolean(record.websiteVisible || record.requestedWebsiteVisible);
  const hydratedVariants = storedVariants.length ? storedVariants.map((variant, index) => ({
    ...(index === 0 ? {
      stockQty: record.itemStockQty ?? record.stockQty ?? record.stock,
      reorderLevel: record.itemReorderLevel ?? record.reorderLevel,
      inventoryUnit: record.itemInventoryUnit || record.inventoryUnit,
      inventoryLocation: record.itemInventoryLocation || record.inventoryLocation,
      unitCost: record.itemUnitCost ?? record.unitCost,
      supplierId: record.itemSupplierId || record.supplierId,
      costReference: record.itemCostReference || record.costReference,
      purchaseUrl: record.itemPurchaseUrl || record.purchaseUrl,
    } : {}),
    ...variant,
    shopEnabled: variant?.shopEnabled ?? legacyShopEnabled,
    libraryVisible: variant?.libraryVisible ?? legacyLibraryVisible,
    linkedItemComponents: variant?.linkedItemComponents?.length
      ? variant.linkedItemComponents
      : index === 0 ? record.linkedItemComponents || [] : [],
    manufacturingRecipe: variant?.manufacturingRecipe ??
      (record.productLinkRole === "ManufacturedFrom" || isProductManufactureBlueprint()),
  })) : [{
    entityVariantId: "VAR-PRIMARY",
    name: "Primary",
    templateVariantId: record.templateId || record.template || "",
    durationMinutes: record.durationMinutes,
    sizeLabel: record.sizeLabel,
    intendedOutput: record.intendedOutput,
    templateFieldValues: templateFieldValuesForRecord(record),
    status: record.status || "draft",
    owner: record.owner,
    ownerType: record.ownerType,
    stockQty: record.itemStockQty ?? record.stockQty ?? record.stock,
    reorderLevel: record.itemReorderLevel ?? record.reorderLevel,
    inventoryUnit: record.itemInventoryUnit || record.inventoryUnit,
    inventoryLocation: record.itemInventoryLocation || record.inventoryLocation,
    unitCost: record.itemUnitCost ?? record.unitCost,
    supplierId: record.itemSupplierId || record.supplierId,
    costReference: record.itemCostReference || record.costReference,
    purchaseUrl: record.itemPurchaseUrl || record.purchaseUrl,
    shopEnabled: legacyShopEnabled,
    libraryVisible: legacyLibraryVisible,
    linkedItemComponents: record.linkedItemComponents || [],
    manufacturingRecipe:
      record.productLinkRole === "ManufacturedFrom" || isProductManufactureBlueprint(),
  }];
  renderEntityVariantRows(hydratedVariants);
  hydrateMarketplaceTileControls(record);
  const productRelation = record.productRelation || {};
  const fulfilmentSection = document.getElementById("contentProductFulfilmentSection");
  if (fulfilmentSection) {
    fulfilmentSection.dataset.reviewed = String(
      record.productFulfilmentReviewed === true || productRelation.fulfilmentReviewed === true,
    );
  }

  if (recordType === "item") {
    setCheckboxValue("contentWebsiteVisible", record.websiteVisible || record.requestedWebsiteVisible);
    setCheckboxValue(
      "contentIsShopProduct",
      record.isShopProduct === true || record.createsProduct === true || Boolean(record.productId),
    );
    setCheckboxValue("contentSoldByRecoveryTools", record.soldByRecoveryTools !== false);
    setCheckboxValue("contentRequiresShipping", record.requiresShipping);
    setCheckboxValue("contentInventoryTracked", record.inventoryTracked);
    setInputValue("contentItemStockQty", record.itemStock ?? "");
    setInputValue("contentItemReorderLevel", record.itemReorderLevel ?? "");
    setInputValue("contentItemInventoryUnit", record.itemInventoryUnit || "");
    setInputValue("contentItemInventoryLocation", record.itemInventoryLocation || "");
    setInputValue("contentItemUnitCost", record.itemUnitCost ?? "");
    setInputValue("contentItemCostReference", record.itemCostReference || "");
    updateItemInventoryFields();
    setCheckboxValue("contentRequiresCalendar", record.requiresCalendar);
    setCheckboxValue("contentRequiresSessionTime", record.requiresSessionTime);
    setCheckboxValue("contentTracksSeats", record.tracksSeats);
    setCheckboxValue("contentUnlocksAccess", record.unlocksAccess);
    setCheckboxValue("contentIssuesCertificate", record.issuesCertificate);
    setInputValue("contentEventStartAt", record.eventStartAt);
    setInputValue("contentEventEndAt", record.eventEndAt);
    setInputValue("contentEventLocation", record.eventLocation);
    setInputValue("contentInstructor", record.instructor);
    setInputValue("contentCertificateName", record.certificateName);
    applyTemplateDrivenItemFields(selectedTemplate()?.defaults || {});
    setInputValue("contentProductId", record.productId || record.itemProductId || "");
    renderExistingProductOptions(record.productId || record.itemProductId || "");
    setInputValue("contentProductLinkRole", record.productLinkRole || "Represents");
    updateProductRelationshipControl(record.productLinkRole || "Represents");
    setInputValue("contentProductSku", record.productSku);
    setSelectValue("contentProductCategoryId", record.productCategoryId);
    setSelectValue("contentProductDeliveryType", productDeliveryControlValue(
      record.productType,
      record.productRequiresShipping,
    ));
    setInputValue(
      "contentProductPhysicalFulfilment",
      record.productPhysicalFulfilment || (record.productRequiresShipping ? "shipping" : "none"),
    );
    setCheckboxValue(
      "contentProductHasPhysicalFulfilment",
      record.productPhysicalFulfilment && record.productPhysicalFulfilment !== "none" ||
        record.productRequiresShipping === true ||
        (record.variants || []).some((variant) => variant.physicalFulfilment && variant.physicalFulfilment !== "none"),
    );
    setCheckboxValue("contentProductRequiresShipping", record.productRequiresShipping === true);
    setCheckboxValue("contentProductInventoryTracked", record.productInventoryTracked === true);
    setCheckboxValue("contentProductAvailableToAffiliates", record.productAffiliateAvailable === true);
    setInputValue("contentProductWholesalePrice", record.productWholesalePrice ?? "");
    setInputValue("contentProductWholesaleMinQuantity", record.productWholesaleMinQuantity ?? 1);
    setCheckboxValue("contentProductRequiresCalendar", record.productRequiresCalendar === true);
    setCheckboxValue("contentProductRequiresSessionTime", record.productRequiresSessionTime === true);
    setCheckboxValue("contentProductTracksSeats", record.productTracksSeats === true);
    setCheckboxValue("contentProductRequiresLocation", record.productRequiresLocation === true);
    setCheckboxValue("contentProductRequiresInstructor", record.productRequiresInstructor === true);
    setSelectValue("contentProductShopStatus", record.productShopStatus || record.shopStatus || "draft");
    setInputValue("contentProductPrice", record.productEffectiveShopPrice || record.productPrice || "");
    setInputValue("contentProductStock", record.productStock ?? 0);
    setCheckboxValue(
      "contentProductVisible",
      record.productVisible || record.requestedProductVisible || record.isShopProduct,
    );
    setCheckboxValue("contentProductFeatured", record.productFeatured);
    setCheckboxValue("contentProductArchived", record.productArchived);
    state.retainedProductVariantContentLinks = (record.productVariantContentLinks || [])
      .filter((link) => !["ManufacturedFrom", "OperatedWith"].includes(link.linkRole));
    setInputValue("contentProductVariants", serializeProductVariants(record.variants || []));
    renderProductBlueprintOptions(record.manufacturingBlueprintId || "");
    renderProductVariantContentLinkRows(record.productVariantContentLinks || []);
    renderProductUnlockRows(record.productAccessGrants || []);
    updateProductRelationStatus(record);
    renderCurrentAssets(record);
  } else {
    setCheckboxValue("contentWebsiteVisible", record.websiteVisible || record.requestedWebsiteVisible);
    setCheckboxValue("contentIsShopProduct", record.createsProduct || !!record.productId);
    setInputValue("contentLinkedItemIds", (record.linkedItemIds || []).join(", "));
    setInputValue("contentLinkedBlueprintIds", (record.linkedBlueprintIds || []).join(", "));
    setInputValue("contentLinkedPlanIds", (record.linkedPlanIds || []).join(", "));
    setInputValue("contentAudience", record.audience);
    setInputValue("contentGoal", record.goal);
    setInputValue("contentProductId", record.productId || "");
    renderExistingProductOptions(record.productId || "");
    setInputValue("contentProductLinkRole", record.productLinkRole || "Represents");
    updateProductRelationshipControl(record.productLinkRole || "Represents");
    setInputValue("contentProductSku", record.productSku);
    setSelectValue("contentProductCategoryId", record.productCategoryId);
    setSelectValue("contentProductDeliveryType", productDeliveryControlValue(
      record.productType,
      record.productRequiresShipping,
    ));
    setInputValue(
      "contentProductPhysicalFulfilment",
      record.productPhysicalFulfilment || (record.productRequiresShipping ? "shipping" : "none"),
    );
    setCheckboxValue(
      "contentProductHasPhysicalFulfilment",
      record.productPhysicalFulfilment && record.productPhysicalFulfilment !== "none" ||
        record.productRequiresShipping === true ||
        (record.variants || []).some((variant) => variant.physicalFulfilment && variant.physicalFulfilment !== "none"),
    );
    setCheckboxValue("contentProductRequiresShipping", record.productRequiresShipping === true);
    setCheckboxValue("contentProductInventoryTracked", record.productInventoryTracked === true);
    setCheckboxValue("contentProductAvailableToAffiliates", record.productAffiliateAvailable === true);
    setInputValue("contentProductWholesalePrice", record.productWholesalePrice ?? "");
    setInputValue("contentProductWholesaleMinQuantity", record.productWholesaleMinQuantity ?? 1);
    setCheckboxValue("contentProductRequiresCalendar", record.productRequiresCalendar === true);
    setCheckboxValue("contentProductRequiresSessionTime", record.productRequiresSessionTime === true);
    setCheckboxValue("contentProductTracksSeats", record.productTracksSeats === true);
    setCheckboxValue("contentProductRequiresLocation", record.productRequiresLocation === true);
    setCheckboxValue("contentProductRequiresInstructor", record.productRequiresInstructor === true);
    setSelectValue("contentProductShopStatus", record.productShopStatus || record.shopStatus || "draft");
    setInputValue("contentProductPrice", record.productEffectiveShopPrice || record.productPrice || "");
    setInputValue("contentProductStock", record.productStock ?? 0);
    setCheckboxValue("contentProductVisible", record.productVisible || record.requestedProductVisible);
    setCheckboxValue("contentProductFeatured", record.productFeatured);
    setCheckboxValue("contentProductArchived", record.productArchived);
    state.retainedProductVariantContentLinks = (record.productVariantContentLinks || [])
      .filter((link) => !["ManufacturedFrom", "OperatedWith"].includes(link.linkRole));
    setInputValue("contentProductVariants", serializeProductVariants(record.variants || []));
    renderProductBlueprintOptions(record.manufacturingBlueprintId || "");
    renderProductVariantContentLinkRows(record.productVariantContentLinks || []);
    renderProductUnlockRows(record.productAccessGrants || []);
    updateProductRelationStatus(record);
  }

  const savedProduct = record.productRelation || {};
  if (record.productRelation) {
    setSelectValue("contentProductMarketplaceMode", savedProduct.marketplaceMode || "hidden");
    setSelectValue("contentProductMarketplaceAudience", savedProduct.marketplaceAudience || "public");
    setInputValue("contentProductMarketplaceStartsAt", datetimeLocalValue(savedProduct.marketplaceStartsAt));
    setInputValue("contentProductMarketplaceEndsAt", datetimeLocalValue(savedProduct.marketplaceEndsAt));
    setSelectValue("contentProductTaxClass", savedProduct.taxClass || "gst-taxable");
    setInputValue("contentProductSalePrice", savedProduct.salePrice ?? "");
    setInputValue("contentProductSaleStartsAt", datetimeLocalValue(savedProduct.saleStartsAt));
    setInputValue("contentProductSaleEndsAt", datetimeLocalValue(savedProduct.saleEndsAt));
  }

  // Rebuild the visible ProductVariant controls from the hydrated canonical
  // variants before any summary calls syncSelectedProductVariantRows().
  // Without this, a full page reload has no variant rows yet and the sync
  // step replaces the correctly loaded hidden value with an empty array.
  populateProductVariantsFromEntity();
  updateProductPhysicalFields();

  renderRelationshipPickers();

  state.currentStep = 4;
  state.isDirty = false;
  updateEditBanner();
  renderBuilderSummaries(record);
  showBuilderStep(4);
  setContentEntityEditorDrawerOpen(false);
  renderSimilarList();
}

function applyBuilderRoute() {
  document.getElementById("contentBuilderForm")?.classList.remove("hidden");
  const confirmation = document.getElementById("contentBuilderConfirmation");
  confirmation?.classList.add("hidden");
  confirmation?.classList.remove("flex");
  const params = new URLSearchParams(window.location.search);
  if (params.get("new") === "1") {
    populateNewBuilderFromRoute(params);
    return;
  }
  const recordId = params.get("id") || "";
  const recordType = params.get("type") || "";
  if (!recordId || !recordType) {
    clearEditMode({ updateHistory: false });
    showBuilderStep(4);
    setContentEntityEditorDrawerOpen(false);
    return;
  }

  const record = findRecord(recordType, recordId);
  if (!record) {
    showToast("Could not find that content record to edit.", "error");
    return;
  }
  populateBuilderFromRecord(record);
  if (params.get("productDrawer") === "1") {
    const productId = params.get("productId") || record.productId || "";
    if (productId) chooseExistingProduct(productId);
    openContentProductDrawer();
    state.isDirty = false;
  }
}

function updateBuilderFilterButtons(recordType) {
  document.querySelectorAll(".builder-filter-btn").forEach((button) => {
    const isActive = button.dataset.builderFilter === recordType;
    button.classList.toggle("bg-[#407471]", isActive);
    button.classList.toggle("bg-gray-700", !isActive);
  });
}

function setupBuilderFilters() {
  document.querySelectorAll(".builder-filter-btn").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      const recordType = button.dataset.builderFilter || "item";
      const select = document.getElementById("contentRecordType");
      if (select) select.value = recordType;
      updateFormForRecordType();
      const requestedType = button.dataset.builderType || "";
      if (requestedType) {
        setSelectValue("contentType", requestedType);
        updateTemplatesForType();
        renderRelationshipPickers();
        updateBuilderFilterButtons(recordType);
      }
    });
  });
}

function closeTemplateCreator() {
  document.getElementById("contentTemplateToolSection")?.classList.add("hidden");
  document.body.classList.remove("overflow-hidden");
}

function generatedTemplateId() {
  const recordType = document.getElementById("templateRecordType")?.value || "item";
  const name = document.getElementById("templateName")?.value || "";
  const slug = String(name)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug ? `${recordType.toUpperCase()}-TEMPLATE-${slug}` : "";
}

function updateGeneratedTemplateId() {
  const recordType = document.getElementById("templateRecordType")?.value || "item";
  const labelPrefix = `${recordType[0].toUpperCase()}${recordType.slice(1)}TemplateID`;
  const label = document.getElementById("templateIdLabel");
  const input = document.getElementById("templateId");
  if (label) label.textContent = `${labelPrefix} (auto-filled)`;
  if (input) {
    if (input.dataset.locked !== "true") input.value = generatedTemplateId();
    input.placeholder = `Generated from ${labelPrefix.replace("ID", "")} name`;
  }
  updateAutoVariantIds();
}

function showTemplateFormPart(part = 1) {
  const showFields = Number(part) === 2;
  document.getElementById("templateFormPartOne")?.classList.toggle("hidden", showFields);
  document.getElementById("templateFormPartTwo")?.classList.toggle("hidden", !showFields);
  document.getElementById("templateFormBackBtn")?.classList.toggle("hidden", !showFields);
  document.getElementById("templateFormNextBtn")?.classList.toggle("hidden", showFields);
  document.getElementById("templateFormSaveBtn")?.classList.toggle("hidden", !showFields);
  document.getElementById("templateFormPartOneSpacer")?.classList.toggle("hidden", showFields);

  const firstIndicator = document.getElementById("templateFormStepOneIndicator");
  const secondIndicator = document.getElementById("templateFormStepTwoIndicator");
  firstIndicator?.classList.toggle("border-[#407471]", !showFields);
  firstIndicator?.classList.toggle("bg-[#407471]/20", !showFields);
  firstIndicator?.classList.toggle("text-white", !showFields);
  firstIndicator?.classList.toggle("border-gray-700", showFields);
  firstIndicator?.classList.toggle("text-gray-400", showFields);
  secondIndicator?.classList.toggle("border-[#407471]", showFields);
  secondIndicator?.classList.toggle("bg-[#407471]/20", showFields);
  secondIndicator?.classList.toggle("text-white", showFields);
  secondIndicator?.classList.toggle("border-gray-700", !showFields);
  secondIndicator?.classList.toggle("text-gray-400", !showFields);
}

function continueToTemplateFields() {
  const name = document.getElementById("templateName");
  const recordType = document.getElementById("templateRecordType")?.value || "";
  const appliesTo = document.getElementById("templateAppliesTo")?.value || "";
  if (!recordType || !appliesTo) {
    showToast("Choose the template area and the type it applies to.", "error");
    return false;
  }
  if (!name?.checkValidity()) {
    name?.reportValidity();
    return false;
  }
  showTemplateFormPart(2);
  document.querySelector("#templateVariantRows .template-variant-name")?.focus();
  return true;
}

function uniqueLinkedTypeOptions(values = []) {
  const seen = new Set();
  return values.map((value) => String(value || "").trim()).filter((value) => {
    const key = normalizedText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.localeCompare(right));
}

function linkedTypeOptionsForTable(linkedTable) {
  const table = normalizedText(linkedTable);
  if (table === "items") {
    return uniqueLinkedTypeOptions([
      ...(state.options.itemTypes || []),
      ...(state.records.items || []).map((record) => record.itemType || record.type),
    ]);
  }
  if (table === "blueprints") {
    return uniqueLinkedTypeOptions([
      ...(state.options.blueprintTypes || []),
      ...(state.records.blueprints || []).map((record) => record.blueprintType || record.type),
    ]);
  }
  if (table === "plans") {
    return uniqueLinkedTypeOptions([
      ...(state.options.planTypes || []),
      ...(state.records.plans || []).map((record) => record.planType || record.type),
    ]);
  }
  if (["product", "products"].includes(table)) {
    return uniqueLinkedTypeOptions(
      (state.records.products || []).map((record) => record.productType || record.type),
    );
  }
  if (["asset", "assets", "item asset", "item assets"].includes(table)) {
    return uniqueLinkedTypeOptions(
      (state.records.assets || []).map((record) => record.assetType || record.type),
    );
  }
  return [];
}

function linkedTypeFilterOptionsMarkup(linkedTable, selectedValue = "") {
  const options = linkedTypeOptionsForTable(linkedTable);
  const selected = String(selectedValue || "").trim();
  if (selected && !options.some((option) => normalizedText(option) === normalizedText(selected))) {
    options.push(selected);
  }
  return `<option value="">Any linked type</option>${options.map((option) => `
    <option value="${escapeHTML(option)}"${normalizedText(option) === normalizedText(selected) ? " selected" : ""}>
      ${escapeHTML(option)}
    </option>
  `).join("")}`;
}

function refreshTemplateFieldLinkedTypeOptions(row) {
  const linkedTable = row?.querySelector(".template-field-linked-table")?.value || "";
  const select = row?.querySelector(".template-field-linked-type-filter");
  if (!select) return;
  const available = linkedTypeOptionsForTable(linkedTable);
  const selected = available.some((option) => normalizedText(option) === normalizedText(select.value))
    ? select.value : "";
  select.innerHTML = linkedTypeFilterOptionsMarkup(linkedTable, selected);
  select.disabled = available.length === 0;
}

function templateFieldRowMarkup(field = {}) {
  const fieldType = canonicalTemplateFieldType(field.fieldType);
  const key = templateFieldKey(field.key || field.id || field.name);
  const linkedTable = field.linkedTable || "";
  const linkedTableOptions = ["", "Items", "Blueprints", "Plans", "Products", "Assets", "Tags", "Categories"];
  if (linkedTable && !linkedTableOptions.includes(linkedTable)) linkedTableOptions.push(linkedTable);
  const sortOrder = Number(field.sortOrder || 0) || 1;
  const minEntries = field.minEntries ?? (field.required ? 1 : 0);
  const storedMaxEntries = Number(field.maxEntries);
  const maxEntries = field.allowUnlimited
    ? ""
    : storedMaxEntries > 0
      ? storedMaxEntries
      : field.repeatable
        ? ""
        : 1;
  return `
    <div class="template-field-row rounded border border-gray-700 bg-gray-900/70 p-3">
      <input
        type="hidden"
        class="template-field-id"
        value="${escapeHTML(field.id || "")}"
        data-auto-id="${field.id ? "false" : "true"}"
      >
      <input type="hidden" class="template-field-key" value="${escapeHTML(key)}">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-semibold uppercase tracking-wide text-gray-400">Template field</span>
        <div class="flex gap-1">
          <button
            type="button"
            class="template-field-up rounded border border-gray-600 px-2 py-1 text-xs"
            title="Move up"
          >Up</button>
          <button
            type="button"
            class="template-field-down rounded border border-gray-600 px-2 py-1 text-xs"
            title="Move down"
          >Down</button>
          <button
            type="button"
            class="template-field-remove rounded border border-red-700 px-2 py-1 text-xs text-red-200"
          >Remove</button>
        </div>
      </div>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <label class="block">
          FieldName
          <input
            class="template-field-name mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            value="${escapeHTML(field.name || "")}"
            required
          >
        </label>
        <label class="block">
          FieldType
          <select class="template-field-type mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
            ${[
    "Short Text",
    "Long Text",
    "Number",
    "Boolean",
    "Date",
    "Linked Item List",
    "Linked Blueprint List",
    "Linked Plan List",
    "Linked Product List",
    "Asset",
    "Image Asset",
    "Video Asset",
    "PDF Asset",
    "Canva Design Asset",
  ].map((option) => `
              <option value="${option}" ${fieldType === option ? "selected" : ""}>${option}</option>
            `).join("")}
          </select>
        </label>
        <label class="block">
          LinkedTable
          <select class="template-field-linked-table mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
            ${linkedTableOptions.map((option) => `
              <option value="${escapeHTML(option)}" ${linkedTable === option ? "selected" : ""}>
                ${escapeHTML(option || "Not linked")}
              </option>
            `).join("")}
          </select>
        </label>
        <label class="block">
          Required linked type
          <select class="template-field-linked-type-filter mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            ${linkedTypeOptionsForTable(linkedTable).length || field.linkedTypeFilter ? "" : "disabled"}>
            ${linkedTypeFilterOptionsMarkup(linkedTable, field.linkedTypeFilter)}
          </select>
        </label>
        <label class="block">
          Required linked status
          <select class="template-field-linked-status-filter mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
            ${["", "active", "draft", "review", "paused", "archived"].map((status) => `
              <option value="${status}" ${normalizedText(field.linkedStatusFilter) === status ? "selected" : ""}>${status || "Any status"}</option>
            `).join("")}
          </select>
        </label>
        <label class="block sm:col-span-2">
          Required tags
          <input class="template-field-linked-tag-filters mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            value="${escapeHTML(uniqueValues(Array.isArray(field.linkedTagFilters) ? field.linkedTagFilters : String(field.linkedTagFilters || "").split(",")).join(", "))}" placeholder="Comma-separated tags applied as fixed filters">
        </label>
        <label class="block">
          Minimum entries
          <input
            class="template-field-min-entries mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            type="number"
            min="0"
            value="${minEntries}"
          >
        </label>
        <label class="block">
          Maximum entries
          <input
            class="template-field-max-entries mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            type="number"
            min="0"
            value="${maxEntries}"
            placeholder="Blank means unlimited"
          >
        </label>
        <label class="block">
          SortOrder
          <input
            class="template-field-sort-order mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            type="number"
            min="1"
            value="${sortOrder}"
            required
          >
        </label>
      </div>
      <label class="mt-3 block">
        Notes
        <textarea
          class="template-field-notes mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
          rows="2"
          placeholder="Guidance for the content creator"
        >${escapeHTML(field.notes || "")}</textarea>
      </label>
      <p class="mt-3 text-xs text-gray-400">Minimum 0 is optional; minimum 1 or more is required. Maximum 1 is a single entry; maximum 2 or more is repeatable. Leave maximum blank for unlimited entries.</p>
    </div>
  `;
}

function updateTemplateFieldEmptyState(rows) {
  rows?.parentElement?.querySelector(".template-field-empty-state")?.classList.toggle(
    "hidden",
    !!rows.querySelector(".template-field-row"),
  );
}

function addTemplateFieldRow(field = {}, rows = null) {
  const targetRows = rows || document.querySelector(
    "#templateVariantRows .template-variant-row:not(.template-variant-collapsed) .template-field-rows",
  );
  if (!targetRows) return;
  const sortOrder = targetRows.querySelectorAll(".template-field-row").length + 1;
  targetRows.insertAdjacentHTML("beforeend", templateFieldRowMarkup({ sortOrder, ...field }));
  updateTemplateFieldEmptyState(targetRows);
  targetRows.lastElementChild?.querySelector(".template-field-name")?.focus();
}

function templateFieldsFromDrawer(rows, variantId) {
  const templateId = document.getElementById("templateId")?.value || generatedTemplateId();
  const fields = [...rows.querySelectorAll(".template-field-row")].map(
    (row) => {
      const name = row.querySelector(".template-field-name")?.value.trim() || "";
      const key = templateFieldKey(row.querySelector(".template-field-key")?.value || name);
      const fieldType = canonicalTemplateFieldType(row.querySelector(".template-field-type")?.value);
      const linkedTable = row.querySelector(".template-field-linked-table")?.value || "";
      const linkedTypeFilter = row.querySelector(".template-field-linked-type-filter")?.value.trim() || "";
      const linkedStatusFilter = row.querySelector(".template-field-linked-status-filter")?.value || "";
      const linkedTagFilters = uniqueValues(String(
        row.querySelector(".template-field-linked-tag-filters")?.value || "",
      ).split(","));
      const minValue = row.querySelector(".template-field-min-entries")?.value || "";
      const maxValue = row.querySelector(".template-field-max-entries")?.value || "";
      const minEntries = minValue === "" ? 0 : Number(minValue);
      const maxEntries = maxValue === "" ? null : Number(maxValue);
      const required = minEntries > 0;
      const allowUnlimited = maxEntries === null;
      const repeatable = allowUnlimited || maxEntries > 1;
      const sortOrder = Number(row.querySelector(".template-field-sort-order")?.value || 0);
      const idSlug = String(name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const id = row.querySelector(".template-field-id")?.value || `${variantId || templateId}-FIELD-${idSlug}`;
      if (!name || !key) throw new Error("Every template field needs a name and field key.");
      if ((fieldType.startsWith("Linked ") || fieldType.endsWith(" Asset") || fieldType === "Asset") && !linkedTable) {
        throw new Error(`Choose a LinkedTable for "${name}".`);
      }
      if (!Number.isInteger(sortOrder) || sortOrder < 1) {
        throw new Error(`SortOrder for "${name}" must be a positive whole number.`);
      }
      if (minEntries !== null && (!Number.isInteger(minEntries) || minEntries < 0)) {
        throw new Error(`MinEntries for "${name}" must be zero or a positive whole number.`);
      }
      if (maxEntries !== null && (!Number.isInteger(maxEntries) || maxEntries < 1)) {
        throw new Error(`Maximum entries for "${name}" must be one or more, or blank for unlimited.`);
      }
      if (maxEntries !== null && maxEntries < minEntries) {
        throw new Error(`MaxEntries cannot be less than MinEntries for "${name}".`);
      }
      return {
        id,
        key,
        name,
        fieldType,
        linkedTable,
        linkedTypeFilter,
        linkedStatusFilter,
        linkedTagFilters,
        required,
        repeatable,
        minEntries,
        maxEntries: allowUnlimited ? null : maxEntries,
        allowUnlimited,
        sortOrder,
        notes: row.querySelector(".template-field-notes")?.value.trim() || "",
      };
    },
  );
  const keys = fields.map((field) => field.key);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Each template field needs a unique field key.");
  }
  const sortOrders = fields.map((field) => field.sortOrder);
  if (new Set(sortOrders).size !== sortOrders.length) {
    throw new Error("Each template field needs a unique SortOrder.");
  }
  return fields;
}

function handleTemplateFieldRowsInput(event) {
  const row = event.target.closest(".template-field-row");
  if (!row) return;
  if (event.target.classList.contains("template-field-name")) {
    const keyInput = row.querySelector(".template-field-key");
    if (keyInput) keyInput.value = templateFieldKey(event.target.value);
    const idInput = row.querySelector(".template-field-id");
    if (idInput?.dataset.autoId === "true") idInput.value = "";
  }
}

function handleTemplateFieldRowsChange(event) {
  const row = event.target.closest(".template-field-row");
  if (!row) return;
  if (event.target.classList.contains("template-field-type")) {
    const linkedDefaults = {
      "Linked Item List": "Items",
      "Linked Blueprint List": "Blueprints",
      "Linked Plan List": "Plans",
      "Linked Product List": "Products",
      Asset: "Assets",
      "Image Asset": "Assets",
      "Video Asset": "Assets",
      "PDF Asset": "Assets",
      "Canva Design Asset": "Assets",
    };
    const linkedTable = row.querySelector(".template-field-linked-table");
    if (linkedTable) {
      linkedTable.value = linkedDefaults[event.target.value] || "";
      refreshTemplateFieldLinkedTypeOptions(row);
    }
  }
  if (event.target.classList.contains("template-field-linked-table")) {
    refreshTemplateFieldLinkedTypeOptions(row);
  }
}

function renumberTemplateFieldRows(rows) {
  rows?.querySelectorAll(".template-field-row").forEach((row, index) => {
    const input = row.querySelector(".template-field-sort-order");
    if (input) input.value = index + 1;
  });
}

function handleTemplateFieldRowsClick(event) {
  const row = event.target.closest(".template-field-row");
  if (!row) return;
  const rows = row.closest(".template-field-rows");
  if (event.target.classList.contains("template-field-remove")) row.remove();
  if (event.target.classList.contains("template-field-up") && row.previousElementSibling) {
    row.parentElement.insertBefore(row, row.previousElementSibling);
  }
  if (event.target.classList.contains("template-field-down") && row.nextElementSibling) {
    row.parentElement.insertBefore(row.nextElementSibling, row);
  }
  if (
    event.target.classList.contains("template-field-remove") ||
    event.target.classList.contains("template-field-up") ||
    event.target.classList.contains("template-field-down")
  ) {
    renumberTemplateFieldRows(rows);
  }
  updateTemplateFieldEmptyState(rows);
}

function generatedVariantId(name, index = 0) {
  const templateId = document.getElementById("templateId")?.value || generatedTemplateId();
  const slug = String(name || `VARIANT-${index + 1}`)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return templateId && slug ? `${templateId}-VARIANT-${slug}` : "";
}

/* eslint-disable max-len */
function templateVariantRowMarkup(variant = {}, index = 0, expanded = true) {
  const id = variant.id || generatedVariantId(variant.name || "Default", index);
  const fields = Array.isArray(variant.defaults?.fields) ? variant.defaults.fields : [];
  const recordType = document.getElementById("templateRecordType")?.value || "item";
  return `
    <section class="template-variant-row rounded border border-gray-700 bg-gray-900/70 ${expanded ? "" : "template-variant-collapsed"}">
      <div class="flex items-center gap-2 p-3">
        <button type="button" class="template-variant-toggle flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
          <span class="min-w-0">
            <span class="template-variant-summary block truncate font-semibold text-white">${escapeHTML(variant.name || "Default")}</span>
            <span class="block truncate text-xs text-gray-400">${escapeHTML(id || "VariantID will be generated")}</span>
          </span>
          <span class="template-variant-chevron text-gray-400">${expanded ? "Collapse" : "Expand"}</span>
        </button>
        <button type="button" class="template-variant-remove rounded border border-red-700 px-2 py-1 text-xs text-red-200">Remove</button>
      </div>
      <div class="template-variant-body border-t border-gray-700 p-3 ${expanded ? "" : "hidden"}">
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block sm:col-span-2">
            VariantID (auto-filled)
            <input class="template-variant-id mt-1 w-full rounded bg-gray-800 px-3 py-2 font-mono text-gray-300 opacity-80" value="${escapeHTML(id)}" data-auto-id="${variant.id ? "false" : "true"}" readonly>
          </label>
          <label class="block">
            VariantName
            <input class="template-variant-name mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(variant.name || "Default")}" required>
          </label>
          <label class="block">
            SortOrder
            <input class="template-variant-sort-order mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="1" value="${Number(variant.sortOrder || index + 1)}" required>
          </label>
          <label class="block sm:col-span-2">
            Description
            <textarea class="template-variant-description mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" rows="2">${escapeHTML(variant.description || "")}</textarea>
          </label>
        </div>
        <div class="template-variant-plan-defaults mt-3 grid gap-3 sm:grid-cols-2 ${recordType === "plan" ? "" : "hidden"}">
          <label class="block">Duration minutes
            <input class="template-variant-duration mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" value="${variant.defaults?.durationMinutes ?? ""}">
          </label>
          <label class="block">Size label
            <input class="template-variant-size-label mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(variant.defaults?.sizeLabel || "")}">
          </label>
        </div>
        <div class="mt-3 flex flex-wrap gap-4">
          <label class="inline-flex items-center gap-2"><input class="template-variant-default accent-[#407471]" type="checkbox" ${variant.isDefault !== false ? "checked" : ""}> Default variant</label>
          <label class="inline-flex items-center gap-2"><input class="template-variant-active accent-[#407471]" type="checkbox" ${variant.active !== false ? "checked" : ""}> Active</label>
        </div>
        <section class="mt-4 rounded border border-gray-700 bg-gray-950/50 p-3">
          <div>
            <h5 class="font-semibold text-white">Fields for this variant</h5>
            <p class="mt-1 text-xs text-gray-400">Each field is shown only when this variant is selected.</p>
          </div>
          <div class="template-field-rows mt-3 space-y-3">${fields.map(templateFieldRowMarkup).join("")}</div>
          <p class="template-field-empty-state mt-3 text-xs text-gray-500 ${fields.length ? "hidden" : ""}">No extra fields. The standard fields for this entity type will still be shown.</p>
          <div class="mt-3 flex justify-start">
            <button type="button" class="add-template-field rounded border border-[#407471] px-3 py-2 text-xs text-white hover:bg-[#407471]/20">+ Add another field</button>
          </div>
        </section>
      </div>
    </section>
  `;
}
/* eslint-enable max-len */

function renderTemplateVariants(variants = []) {
  const rows = document.getElementById("templateVariantRows");
  if (!rows) return;
  const safeVariants = variants.length
    ? variants
    : [{ name: "Default", isDefault: true, active: true, sortOrder: 1, defaults: { fields: [] } }];
  rows.innerHTML = safeVariants.map((variant, index) =>
    templateVariantRowMarkup(variant, index, index === 0),
  ).join("");
}

function addTemplateVariant() {
  const rows = document.getElementById("templateVariantRows");
  if (!rows) return;
  rows.querySelectorAll(".template-variant-row").forEach((row) => {
    row.classList.add("template-variant-collapsed");
    row.querySelector(".template-variant-body")?.classList.add("hidden");
    const chevron = row.querySelector(".template-variant-chevron");
    if (chevron) chevron.textContent = "Expand";
  });
  const index = rows.querySelectorAll(".template-variant-row").length;
  rows.insertAdjacentHTML("beforeend", templateVariantRowMarkup({
    name: `Variant ${index + 1}`,
    isDefault: false,
    active: true,
    sortOrder: index + 1,
    defaults: { fields: [] },
  }, index, true));
  rows.lastElementChild?.querySelector(".template-variant-name")?.focus();
}

function updateAutoVariantIds() {
  document.querySelectorAll("#templateVariantRows .template-variant-row").forEach((row, index) => {
    const idInput = row.querySelector(".template-variant-id");
    if (idInput?.dataset.autoId !== "true") return;
    const name = row.querySelector(".template-variant-name")?.value || "";
    idInput.value = generatedVariantId(name, index);
    const summary = row.querySelector(".template-variant-summary")?.nextElementSibling;
    if (summary) summary.textContent = idInput.value || "VariantID will be generated";
  });
}

function templateVariantsFromDrawer() {
  const variants = [...document.querySelectorAll("#templateVariantRows .template-variant-row")].map((row, index) => {
    const name = row.querySelector(".template-variant-name")?.value.trim() || "";
    const id = row.querySelector(".template-variant-id")?.value || generatedVariantId(name, index);
    const sortOrder = Number(row.querySelector(".template-variant-sort-order")?.value || 0);
    const durationValue = row.querySelector(".template-variant-duration")?.value || "";
    if (!name) throw new Error("Every template variant needs a name.");
    if (!Number.isInteger(sortOrder) || sortOrder < 1) {
      throw new Error(`SortOrder for variant "${name}" must be a positive whole number.`);
    }
    return {
      id,
      name,
      description: row.querySelector(".template-variant-description")?.value.trim() || "",
      isDefault: row.querySelector(".template-variant-default")?.checked === true,
      active: row.querySelector(".template-variant-active")?.checked !== false,
      sortOrder,
      defaults: {
        durationMinutes: durationValue === "" ? null : Number(durationValue),
        sizeLabel: row.querySelector(".template-variant-size-label")?.value.trim() || "",
        fields: templateFieldsFromDrawer(row.querySelector(".template-field-rows"), id),
      },
    };
  });
  if (!variants.length) throw new Error("Every template needs at least one variant.");
  if (new Set(variants.map((variant) => variant.id)).size !== variants.length) {
    throw new Error("Each template variant needs a unique VariantID.");
  }
  if (new Set(variants.map((variant) => variant.sortOrder)).size !== variants.length) {
    throw new Error("Each template variant needs a unique SortOrder.");
  }
  if (variants.filter((variant) => variant.isDefault && variant.active).length > 1) {
    throw new Error("Choose only one default variant.");
  }
  return variants;
}

function handleTemplateVariantRowsInput(event) {
  const row = event.target.closest(".template-variant-row");
  if (!row) return;
  if (event.target.classList.contains("template-variant-name")) {
    const summary = row.querySelector(".template-variant-summary");
    if (summary) summary.textContent = event.target.value || "Unnamed variant";
    updateAutoVariantIds();
  }
  handleTemplateFieldRowsInput(event);
}

function handleTemplateVariantRowsChange(event) {
  if (event.target.classList.contains("template-variant-default") && event.target.checked) {
    document.querySelectorAll("#templateVariantRows .template-variant-default").forEach((input) => {
      if (input !== event.target) input.checked = false;
    });
  }
  handleTemplateFieldRowsChange(event);
}

function handleTemplateVariantRowsClick(event) {
  const variantRow = event.target.closest(".template-variant-row");
  if (!variantRow) return;
  if (event.target.closest(".template-variant-toggle")) {
    document.querySelectorAll("#templateVariantRows .template-variant-row").forEach((row) => {
      const expanded = row === variantRow && row.classList.contains("template-variant-collapsed");
      row.classList.toggle("template-variant-collapsed", !expanded);
      row.querySelector(".template-variant-body")?.classList.toggle("hidden", !expanded);
      const chevron = row.querySelector(".template-variant-chevron");
      if (chevron) chevron.textContent = expanded ? "Collapse" : "Expand";
    });
    return;
  }
  if (event.target.classList.contains("template-variant-remove")) {
    const rows = document.getElementById("templateVariantRows");
    if (rows?.querySelectorAll(".template-variant-row").length === 1) {
      showToast("Every template needs at least one variant.", "error");
      return;
    }
    variantRow.remove();
    updateAutoVariantIds();
    return;
  }
  if (event.target.classList.contains("add-template-field")) {
    addTemplateFieldRow({}, variantRow.querySelector(".template-field-rows"));
    return;
  }
  handleTemplateFieldRowsClick(event);
}

function updateTemplatesForType() {
  const recordType = document.getElementById("contentRecordType")?.value || "item";
  const typeValue = document.getElementById("contentType")?.value || "";
  const templates = templateDefinitions(recordType, typeValue);
  const defaultTemplate = defaultTemplateDefinition(recordType, typeValue);
  const select = document.getElementById("contentTemplate");

  if (select) {
    select.innerHTML = templates.length
      ? templates.map((template) =>
        `<option value="${escapeHTML(template.id)}">${escapeHTML(templateOptionLabel(template))}</option>`,
      ).join("")
      : `<option value="">No templates for ${escapeHTML(typeValue || recordType)} yet</option>`;
    select.value = defaultTemplate?.id || "";
  }
  const editButton = document.getElementById("editContentTemplateBtn");
  if (editButton) editButton.disabled = !defaultTemplate;
  applyTemplateDefaults();
  return defaultTemplate;
}

function applyTemplateToPrimaryEntityVariant(template, { resetFields = true } = {}) {
  if (!template) return;
  const variants = entityVariantsFromBuilder();
  if (!variants.length) return;
  const primary = variants[0];
  const changed = primary.templateVariantId !== template.id;
  primary.templateId = template.templateId || "";
  primary.templateVariantId = template.id;
  if (changed && resetFields) primary.templateFieldValues = {};
  renderEntityVariantRows(variants);
}

function addSavedTemplatesToState(templates) {
  if (!Array.isArray(templates) || !templates.length) return;
  const recordType = templates[0].recordType;
  const definitions = state.options.templateDefinitions || {};
  const existing = definitions[recordType] || [];
  const ids = new Set(templates.map((template) => template.id));
  const parentId = templateParentId(templates[0]);
  state.options = {
    ...state.options,
    templateDefinitions: {
      ...definitions,
      [recordType]: [
        ...existing.filter((item) =>
          !ids.has(item.id) && (!parentId || templateParentId(item) !== parentId)),
        ...templates,
      ],
    },
  };
}

async function refreshTemplateDefinitions() {
  const response = await getContentBuilderData();
  const refreshedOptions = response.data?.options;
  if (!refreshedOptions?.templateDefinitions) return;
  state.options = {
    ...state.options,
    ...refreshedOptions,
    templateDefinitions: refreshedOptions.templateDefinitions,
  };
}

function selectSavedTemplateWithoutReset(template) {
  const recordType = currentRecordType();
  const typeValue = document.getElementById("contentType")?.value || "";
  if (
    recordType !== template.recordType ||
    normalizedType(typeValue) !== normalizedType(template.appliesTo)
  ) {
    return;
  }

  const currentValues = captureTemplateGuidedValues();
  const variants = entityVariantsFromBuilder();
  const select = document.getElementById("contentTemplate");
  const help = document.getElementById("contentTemplateHelp");
  const templates = templateDefinitions(recordType, typeValue);
  if (select) {
    select.innerHTML = templates.map((item) =>
      `<option value="${escapeHTML(item.id)}">${escapeHTML(templateOptionLabel(item))}</option>`,
    ).join("");
    select.value = template.id;
  }
  if (help) {
    help.textContent =
      `${templates.length} saved template${templates.length === 1 ? "" : "s"} available for ${typeValue}.`;
  }
  const targetVariantId = state.templateTargetVariantId || variants[0]?.entityVariantId || "";
  const target = variants.find((variant) => variant.entityVariantId === targetVariantId);
  if (target) {
    target.templateVariantId = template.id;
    target.templateId = template.templateId || "";
    target.templateFieldValues = {};
  }
  renderEntityVariantRows(variants);
  state.templateTargetVariantId = "";
  renderTemplateGuidedFields();
  restoreTemplateGuidedValues(currentValues);
}

function templateParentId(template) {
  return template?.templateId || template?.defaults?.templateId || template?.id || "";
}

function setTemplateDrawerMode(mode) {
  const editing = mode === "edit";
  const title = document.getElementById("contentTemplateToolTitle");
  const recordType = document.getElementById("templateRecordType");
  const templateId = document.getElementById("templateId");
  if (title) title.textContent = editing ? "Edit template" : "Create new template";
  if (recordType) recordType.disabled = editing;
  if (templateId) templateId.dataset.locked = editing ? "true" : "false";
}

function openTemplateEditorForSelectedTemplate() {
  const selected = selectedTemplate();
  if (!selected) {
    showToast("Choose a template to edit first.", "error");
    return;
  }
  const recordType = currentRecordType();
  const parentId = templateParentId(selected);
  const siblings = (state.options.templateDefinitions?.[recordType] || [])
    .filter((template) => templateParentId(template) === parentId)
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  const source = siblings[0] || selected;
  const defaults = source.defaults || {};
  const section = document.getElementById("contentTemplateToolSection");
  const form = document.getElementById("contentTemplateForm");
  const recordTypeSelect = document.getElementById("templateRecordType");

  form?.reset();
  section?.classList.remove("hidden");
  document.body.classList.add("overflow-hidden");
  setTemplateDrawerMode("edit");
  if (recordTypeSelect) recordTypeSelect.value = recordType;
  updateTemplateManagerTypeOptions();
  setInputValue("templateId", parentId);
  setInputValue("templateName", source.templateName || source.name || "");
  setSelectValue("templateAppliesTo", source.appliesTo);
  setInputValue("templateDescription", source.templateDescription || source.description || "");
  setCheckboxValue("templateIsDefault", siblings.some((template) =>
    template.templateIsDefault === true || template.isDefault === true));
  setCheckboxValue("templateActive", source.templateActive !== false &&
    siblings.some((template) => template.active !== false));
  setCheckboxValue("templateRequiresShipping", defaults.requiresShipping === true);
  setCheckboxValue("templateInventoryTracked", defaults.inventoryTracked === true);
  setCheckboxValue("templateIsShopProduct", defaults.isShopProduct === true);
  setCheckboxValue("templateSoldByRecoveryTools", defaults.soldByRecoveryTools !== false);
  setCheckboxValue("templateUnlocksAccess", defaults.unlocksAccess === true);
  setCheckboxValue("templateRequiresCalendar", defaults.requiresCalendar === true);
  setCheckboxValue("templateRequiresSessionTime", defaults.requiresSessionTime === true);
  setCheckboxValue("templateTracksSeats", defaults.tracksSeats === true);
  setCheckboxValue("templateRequiresLocation", defaults.requiresLocation === true);
  setCheckboxValue("templateRequiresInstructor", defaults.requiresInstructor === true);
  setCheckboxValue("templateIssuesCertificate", defaults.issuesCertificate === true);

  const hasStoredVariantDefault = siblings.some((template) =>
    template.variantIsDefault !== undefined);
  renderTemplateVariants(siblings.map((template, index) => ({
    id: template.id,
    name: template.name,
    description: template.variantDescription || template.description || "",
    isDefault: hasStoredVariantDefault
      ? template.variantIsDefault === true
      : template.id === selected.id || (!selected.id && index === 0),
    active: template.variantActive !== false && template.active !== false,
    sortOrder: template.sortOrder || index + 1,
    defaults: template.defaults || {},
  })));
  showTemplateFormPart(1);
  document.getElementById("templateName")?.focus();
}

function openTemplateCreatorForCurrentRecord() {
  const recordType = currentRecordType();
  if (!["item", "blueprint", "plan"].includes(recordType)) return;
  const section = document.getElementById("contentTemplateToolSection");
  const recordTypeSelect = document.getElementById("templateRecordType");
  const appliesToSelect = document.getElementById("templateAppliesTo");
  const currentType = document.getElementById("contentType")?.value || "";

  document.getElementById("contentTemplateForm")?.reset();
  setTemplateDrawerMode("create");
  section?.classList.remove("hidden");
  document.body.classList.add("overflow-hidden");
  if (recordTypeSelect) recordTypeSelect.value = recordType;
  updateTemplateManagerTypeOptions();
  if (appliesToSelect && [...appliesToSelect.options].some((option) => option.value === currentType)) {
    appliesToSelect.value = currentType;
  }
  setInputValue("templateName", "");
  setInputValue("templateDescription", "");
  setCheckboxValue("templateIsDefault", false);
  setCheckboxValue("templateActive", true);
  renderTemplateVariants([{
    name: "Default",
    isDefault: true,
    active: true,
    sortOrder: 1,
    defaults: {
      durationMinutes: recordType === "plan" ? templateInput("contentDurationMinutes") : null,
      sizeLabel: recordType === "plan" ? templateInput("contentSizeLabel") : "",
      fields: [],
    },
  }]);
  showTemplateFormPart(1);
  updateGeneratedTemplateId();
  document.getElementById("templateName")?.focus();
}

function updateTemplateManagerTypeOptions() {
  const recordType = document.getElementById("templateRecordType")?.value || "item";
  fillSelect(
    document.getElementById("templateAppliesTo"),
    state.options[typeOptionsKey(recordType)] || [],
    recordType,
  );
  document.getElementById("itemTemplateDefaults")?.classList.toggle("hidden", recordType !== "item");
  document.getElementById("templateCertificateDefaults")?.classList.toggle(
    "hidden",
    !["item", "plan"].includes(recordType),
  );
  document.querySelectorAll(".template-variant-plan-defaults").forEach((section) => {
    section.classList.toggle("hidden", recordType !== "plan");
  });
  updateGeneratedTemplateId();
}

function templateAssetLinksFromBuilder(templateFieldValues) {
  return selectedAssetTemplateFields().flatMap((field) => {
    const key = templateFieldKey(field.key || field.id || field.name);
    const rawValue = templateFieldValues[key];
    const values = Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : [];
    return uniqueValues(values).map((assetId) => ({
      assetId,
      fieldKey: key,
      fieldName: field.name || "Template Asset",
    }));
  });
}

function templateAssetLinksForVariant(variant) {
  const template = templateDefinitions(currentRecordType(), document.getElementById("contentType")?.value)
    .find((candidate) => candidate.id === variant.templateVariantId);
  return templateFields(template).filter(isAssetTemplateField).flatMap((field) => {
    const key = templateFieldKey(field.key || field.id || field.name);
    const rawValue = variant.templateFieldValues?.[key];
    const values = Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : [];
    return uniqueValues(values).map((assetId) => ({
      assetId,
      fieldKey: key,
      fieldName: field.name || "Template Asset",
      entityVariantId: variant.entityVariantId,
    }));
  });
}

function variantHasAssetTemplateFields(variant) {
  const template = templateDefinitions(currentRecordType(), document.getElementById("contentType")?.value)
    .find((candidate) => candidate.id === variant.templateVariantId);
  return templateFields(template).some(isAssetTemplateField);
}

function originalTemplateAssetIds() {
  if (!state.editingRecord) return [];
  const values = templateFieldValuesForRecord(state.editingRecord);
  const variantLinks = (state.editingRecord.entityVariants || [])
    .flatMap((variant) => templateAssetLinksForVariant(variant));
  return uniqueValues([
    ...templateAssetLinksFromBuilder(values).map((link) => link.assetId),
    ...variantLinks.map((link) => link.assetId),
  ]);
}

async function formPayload(confirmDuplicate = false, { validate = true } = {}) {
  const recordType = document.getElementById("contentRecordType")?.value || "item";
  const entityVariants = entityVariantsFromBuilder();
  if (validate && !entityVariants.length) throw new Error("Add at least one variant before saving.");
  entityVariants.forEach((variant, index) => {
    const row = document.querySelectorAll(".content-entity-variant-row")[index];
    if (validate && !variant.templateVariantId) {
      throw new Error(`Choose a template for ${variant.name}.`);
    }
    templateFieldValuesFromBuilder({ validate, root: row });
  });
  const primaryVariant = entityVariants[0];
  const blueprintRecipeVariants = recordType === "blueprint"
    ? entityVariants.filter((variant) => variant.linkedItemComponents.length)
    : [];
  const primaryBlueprintRecipe = blueprintRecipeVariants[0]?.linkedItemComponents || [];
  const blueprintRecipeItemIds = uniqueValues(
    blueprintRecipeVariants.flatMap((variant) =>
      variant.linkedItemComponents.map((component) => component.itemId)),
  );
  const primaryBlueprintRecipeCost = primaryBlueprintRecipe.reduce(
    (sum, component) => sum + Number(component.estimatedCost || 0),
    0,
  );
  const primaryBehaviours = primaryVariant.behaviourDefaults || {};
  const templateFieldValues = primaryVariant.templateFieldValues || {};
  const templateId = primaryVariant.templateVariantId || "";
  if (validate && ["item", "blueprint", "plan"].includes(recordType) && !templateId) {
    throw new Error("Choose or create a template before building this record.");
  }
  const creatingNestedReusableRecord = contentBuilderCreationStack.length > 0 && !state.editingRecord;
  const productRelation = creatingNestedReusableRecord ? null : productRelationPayload();
  if (validate && productRelation?.linkRole === "ManufacturedFrom" &&
      !productRelation.existingProductId && !contentBuilderCreationStack.length) {
    throw new Error("Choose an existing Product for a manufacturing/cost Blueprint.");
  }
  const warmupBlueprintIds = splitCsv(templateInput("contentWarmupBlueprintIds"));
  const mainBlueprintIds = splitCsv(templateInput("contentMainBlueprintIds"));
  const cooldownBlueprintIds = splitCsv(templateInput("contentCooldownBlueprintIds"));
  const blueprintItemIds = splitCsv(templateInput("contentBlueprintItemIds"));
  const linkedBlueprintIds = [
    ...splitCsv(document.getElementById("contentLinkedBlueprintIds")?.value),
    ...warmupBlueprintIds,
    ...mainBlueprintIds,
    ...cooldownBlueprintIds,
  ];

  return {
    recordType,
    status: document.getElementById("contentStatus")?.value || "draft",
    visibility: document.getElementById("contentVisibility")?.value || "private",
    name: document.getElementById("contentName")?.value || "",
    type: document.getElementById("contentType")?.value || "",
    template: templateId,
    templateId,
    id: document.getElementById("contentId")?.value || "",
    shortDescription: document.getElementById("contentShortDescription")?.value || "",
    longDescription: document.getElementById("contentLongDescription")?.value || "",
    notes: document.getElementById("contentLongDescription")?.value || "",
    tags: selectedTagsFromControls(),
    newTags: selectedNewTagsFromControls(validate),
    websiteVisible: entityVariants.some((variant) => variant.libraryVisible === true),
    isShopProduct: recordType === "item"
      ? primaryBehaviours.isShopProduct === true
      : document.getElementById("contentIsShopProduct")?.checked === true,
    createsProduct: Boolean(productRelation),
    soldByRecoveryTools: recordType === "item"
      ? primaryBehaviours.soldByRecoveryTools !== false
      : document.getElementById("contentSoldByRecoveryTools")?.checked !== false,
    requiresShipping: recordType === "item"
      ? primaryBehaviours.requiresShipping === true
      : document.getElementById("contentRequiresShipping")?.checked === true,
    inventoryTracked: recordType === "item"
      ? primaryBehaviours.inventoryTracked === true
      : document.getElementById("contentInventoryTracked")?.checked === true,
    requiresCalendar: recordType === "item"
      ? primaryBehaviours.requiresCalendar === true
      : document.getElementById("contentRequiresCalendar")?.checked === true,
    requiresSessionTime: recordType === "item"
      ? primaryBehaviours.requiresSessionTime === true
      : document.getElementById("contentRequiresSessionTime")?.checked === true,
    tracksSeats: recordType === "item"
      ? primaryBehaviours.tracksSeats === true
      : document.getElementById("contentTracksSeats")?.checked === true,
    unlocksAccess: recordType === "item"
      ? primaryBehaviours.unlocksAccess === true
      : document.getElementById("contentUnlocksAccess")?.checked === true,
    requiresLocation: recordType === "item"
      ? primaryBehaviours.requiresLocation === true
      : selectedTemplate()?.defaults?.requiresLocation === true,
    requiresInstructor: recordType === "item"
      ? primaryBehaviours.requiresInstructor === true
      : selectedTemplate()?.defaults?.requiresInstructor === true,
    issuesCertificate: recordType === "item"
      ? primaryBehaviours.issuesCertificate === true
      : document.getElementById("contentIssuesCertificate")?.checked === true,
    eventStartAt: document.getElementById("contentEventStartAt")?.value || "",
    eventEndAt: document.getElementById("contentEventEndAt")?.value || "",
    eventLocation: document.getElementById("contentEventLocation")?.value || "",
    instructor: document.getElementById("contentInstructor")?.value || "",
    certificateName: document.getElementById("contentCertificateName")?.value || "",
    linkedItemIds: [
      ...splitCsv(document.getElementById("contentLinkedItemIds")?.value),
      ...blueprintItemIds,
      ...blueprintRecipeItemIds,
    ],
    linkedItemComponents: recordType === "blueprint" ? primaryBlueprintRecipe : [],
    estimatedUnitCost: recordType === "blueprint" ? primaryBlueprintRecipeCost : null,
    linkedBlueprintIds: [...new Set(linkedBlueprintIds)],
    linkedPlanIds: splitCsv(document.getElementById("contentLinkedPlanIds")?.value),
    audience: isProductManufactureBlueprint() ? "" : document.getElementById("contentAudience")?.value || "",
    goal: isProductManufactureBlueprint() ? "" : document.getElementById("contentGoal")?.value || "",
    durationMinutes: Number(templateInput("contentDurationMinutes") || 0) || null,
    sizeLabel: templateInput("contentSizeLabel"),
    startDate: templateInput("contentStartDate"),
    endDate: templateInput("contentEndDate"),
    sku: productRelation?.sku || "",
    productId: productRelation?.productId || "",
    price: productRelation?.effectiveShopPrice ?? null,
    stockQty: primaryVariant.stockQty ?? productRelation?.stock ?? null,
    reorderLevel: primaryVariant.reorderLevel ?? null,
    inventoryUnit: primaryVariant.inventoryUnit || "",
    inventoryLocation: primaryVariant.inventoryLocation || "",
    unitCost: primaryVariant.unitCost ?? null,
    supplierId: primaryVariant.supplierId || "",
    costReference: primaryVariant.costReference || "",
    purchaseUrl: primaryVariant.purchaseUrl || "",
    variants: productRelation?.variants || [],
    productRelation,
    unlinkProductIds: splitCsv(document.getElementById("contentUnlinkProductId")?.value),
    shopVisible: productRelation?.visible === true,
    shopStatus: productRelation?.shopStatus || "draft",
    featured: productRelation?.featured === true,
    templateContent: {
      warmupBlueprintIds,
      mainBlueprintIds,
      cooldownBlueprintIds,
      blueprintItemIds,
    },
    templateFieldValues,
    entityVariants,
    scheduledActiveAt: primaryVariant.scheduledActiveAt || "",
    scheduledPauseAt: primaryVariant.scheduledPauseAt || "",
    hasAssetTemplateFields: entityVariants.some(variantHasAssetTemplateFields),
    templateAssetLinks: entityVariants.flatMap((variant) => templateAssetLinksForVariant(variant)),
    originalTemplateAssetIds: originalTemplateAssetIds(),
    confirmDuplicate,
  };
}

function templatePayload() {
  const recordType = document.getElementById("templateRecordType")?.value || "item";
  const defaults = {
  };

  if (recordType === "item") {
    defaults.requiresShipping = document.getElementById("templateRequiresShipping")?.checked === true;
    defaults.inventoryTracked = document.getElementById("templateInventoryTracked")?.checked === true;
    defaults.isShopProduct = document.getElementById("templateIsShopProduct")?.checked === true;
    defaults.soldByRecoveryTools =
      document.getElementById("templateSoldByRecoveryTools")?.checked !== false;
    defaults.unlocksAccess = document.getElementById("templateUnlocksAccess")?.checked === true;
    defaults.requiresCalendar = document.getElementById("templateRequiresCalendar")?.checked === true;
    defaults.requiresSessionTime =
      document.getElementById("templateRequiresSessionTime")?.checked === true;
    defaults.tracksSeats = document.getElementById("templateTracksSeats")?.checked === true;
    defaults.requiresLocation = document.getElementById("templateRequiresLocation")?.checked === true;
    defaults.requiresInstructor =
      document.getElementById("templateRequiresInstructor")?.checked === true;
    defaults.stockStatus = defaults.inventoryTracked ? "draft" : "not-tracked";
  }
  if (["item", "plan"].includes(recordType)) {
    defaults.issuesCertificate = document.getElementById("templateIssuesCertificate")?.checked === true;
  }

  return {
    id: document.getElementById("templateId")?.value || generatedTemplateId(),
    recordType,
    appliesTo: document.getElementById("templateAppliesTo")?.value || "",
    name: document.getElementById("templateName")?.value || "",
    description: document.getElementById("templateDescription")?.value || "",
    isDefault: document.getElementById("templateIsDefault")?.checked === true,
    active: document.getElementById("templateActive")?.checked !== false,
    defaults,
    variants: templateVariantsFromDrawer(),
  };
}

function showDuplicateWarning(similar, payload) {
  const warning = document.getElementById("contentDuplicateWarning");
  const confirmBtn = document.getElementById("confirmDuplicateContentBtn");
  if (!warning || !confirmBtn) return;

  state.pendingPayload = payload;
  state.duplicateWarningActive = true;
  warning.classList.remove("hidden");
  confirmBtn.classList.remove("hidden");
  warning.innerHTML = `
    <div class="font-semibold">Similar records found. Check these before saving:</div>
    <div class="mt-2 space-y-2">${similar.map(renderRecordPill).join("")}</div>
  `;
  showBuilderStep(2);
}

async function loadData() {
  const res = await getContentBuilderData();
  state = {
    ...state,
    options: res.data?.options || state.options,
    records: res.data?.records || state.records,
    pendingPayload: null,
  };
  renderExistingProductOptions(state.editingRecord?.productId || "");

  if (state.editingRecord) {
    const refreshed = findRecord(editingCollectionKey(), state.editingRecord.id);
    if (refreshed) {
      populateBuilderFromRecord(refreshed);
    } else {
      updateFormForRecordType();
    }
  } else {
    updateFormForRecordType();
    renderTagControls(selectedTagsFromControls());
  }
  updateTemplateManagerTypeOptions();
}

function confirmationCopy(action) {
  return {
    save: {
      title: "Content saved",
      message: "Your changes have been saved.",
    },
    approve: {
      title: "Content approved",
      message: "The content has been approved and its active settings have been applied.",
    },
    active: {
      title: "Content set active",
      message: "The content is now active, or scheduled to become active at the selected time.",
    },
    pause: {
      title: "Content paused",
      message: "The content is now paused, or scheduled to pause at the selected time.",
    },
    archive: {
      title: "Content archived",
      message: "The content has been archived.",
    },
  }[action] || {
    title: "Content saved",
    message: "Your changes have been saved.",
  };
}

function showSaveConfirmation({ action, payload, recordId, record }) {
  const confirmation = document.getElementById("contentBuilderConfirmation");
  const copy = confirmationCopy(action);
  const name = record?.name || payload.name || recordId;
  confirmation?.classList.add("hidden");
  confirmation?.classList.remove("flex");
  renderBuilderSummaries(record);
  showBuilderStep(4);
  setContentEntityEditorDrawerOpen(false);
  updateConnectionsWorkspaceAvailability();
  showToast(`${copy.title}: ${name}`, "success");
  document.getElementById("openContentEntityEditorDrawerBtn")?.focus();
}

async function savePayload(payload, action = "save") {
  const saveButton = document.getElementById("saveContentBuilderBtn");
  saveButton?.setAttribute("disabled", "disabled");
  try {
    let recordId = state.editingRecord?.id || "";
    const recordType = state.editingRecord?.recordType || payload.recordType;
    if (state.editingRecord) {
      await updateContentControlRecord({
        recordType: state.editingRecord.recordType,
        recordId: state.editingRecord.id,
        updates: payload,
      });
      showToast("Content record updated.", "success");
      state.isDirty = false;
      await loadData();
      const refreshed = findRecord(recordType, recordId);
      if (contentBuilderCreationStack.length) {
        await restoreNestedParent({
          selectedRecord: refreshed || { ...state.editingRecord, ...payload, id: recordId, recordType },
        });
        return;
      }
      showSaveConfirmation({ action, payload, recordId, record: refreshed });
      return;
    }

    const res = await createContentBuilderRecord(payload);
    if (res.data?.duplicateWarning) {
      showDuplicateWarning(res.data.similar || [], payload);
      state.pendingAction = action;
      showToast("Similar record found. Review before saving.", "error");
      return;
    }

    recordId = res.data?.id || payload.id || "";
    showToast("Content record saved.", "success");
    state.isDirty = false;
    state.duplicateWarningActive = false;
    state.pendingAction = "save";
    await loadData();
    const savedRecord = findRecord(recordType, recordId);
    if (savedRecord) {
      populateBuilderFromRecord(savedRecord);
      history.replaceState(
        {},
        "",
        `/admin/content/builder?type=${encodeURIComponent(recordType)}&id=${encodeURIComponent(recordId)}`,
      );
    }
    if (contentBuilderCreationStack.length) {
      await restoreNestedParent({
        selectedRecord: savedRecord || { ...payload, id: recordId, recordType },
      });
      return;
    }
    showSaveConfirmation({ action, payload, recordId, record: savedRecord });
  } catch (err) {
    console.error("Failed to save content record:", err);
    showToast(err.message || "Failed to save content record.", "error");
  } finally {
    saveButton?.removeAttribute("disabled");
  }
}

function applySaveAction(payload, action = "save") {
  const requestedWebsiteVisible = payload.websiteVisible === true;
  const requestedProductVisible = payload.productRelation?.visible === true || payload.shopVisible === true;
  if (action === "save") return payload;

  const awaitingApproval = payload.approvalStatus === "awaiting-approval" ||
    state.editingRecord?.approvalStatus === "awaiting-approval" ||
    payload.status === "review" || state.editingRecord?.status === "review";
  const futureActiveAt = payload.scheduledActiveAt &&
    new Date(payload.scheduledActiveAt).getTime() > Date.now();
  const futurePauseAt = payload.scheduledPauseAt &&
    new Date(payload.scheduledPauseAt).getTime() > Date.now();
  const activationRequested = action === "active" || (action === "approve" && awaitingApproval);
  const isActive = activationRequested && !futureActiveAt;
  const isPaused = action === "pause" && !futurePauseAt;
  const isArchived = action === "archive";
  const scheduledStatus = state.editingRecord?.status === "active" ? "active" : "draft";
  const status = isActive
    ? "active"
    : isPaused
      ? "paused"
      : isArchived ? "archived" : activationRequested || action === "pause" ? scheduledStatus : "draft";
  const approvalStatus = action === "approve" || isActive
    ? "approved"
    : payload.approvalStatus || state.editingRecord?.approvalStatus || "draft";

  return {
    ...payload,
    entityVariants: isActive
      ? (payload.entityVariants || []).map((variant) => ({
        ...variant,
        status: variant.status === "archived" ? "archived" : "active",
      }))
      : payload.entityVariants,
    status,
    approvalStatus,
    publishRequested: false,
    requestedWebsiteVisible,
    requestedProductVisible,
    websiteVisible: isActive ? requestedWebsiteVisible : false,
    shopVisible: isActive ? requestedProductVisible : false,
    shopStatus: isActive ? "active" : isArchived ? "archived" : "draft",
    productRelation: payload.productRelation
      ? {
        ...payload.productRelation,
        visible: isActive ? requestedProductVisible : false,
        shopStatus: isActive ? "active" : isArchived ? "archived" : "draft",
        archived: isArchived || payload.productRelation.archived === true,
      }
      : null,
  };
}

async function buildAndSavePayload(confirmDuplicate = false, action = "save") {
  try {
    const payload = await formPayload(confirmDuplicate);
    if (action === "save") {
      const reviewStatus = document.getElementById("contentReviewEntityStatus")?.value;
      if (reviewStatus) payload.status = reviewStatus;
      if (reviewStatus === "active") payload.approvalStatus = "approved";
      else if (reviewStatus === "review") payload.approvalStatus = "awaiting-approval";
      else payload.approvalStatus = state.editingRecord?.approvalStatus || "draft";
    }
    await savePayload(applySaveAction(payload, action), action);
  } catch (err) {
    console.error("Failed to prepare content record:", err);
    showToast(err.message || "Check the form values and try again.", "error");
  }
}

function setProductSaveFeedback(type, message) {
  const feedback = document.getElementById("contentProductSaveFeedback");
  if (!feedback) return;
  const styles = {
    saving: ["border-blue-500", "bg-blue-950", "text-blue-100"],
    success: ["border-emerald-500", "bg-emerald-950", "text-emerald-100"],
    error: ["border-red-500", "bg-red-950", "text-red-100"],
  };
  Object.values(styles).flat().forEach((className) => feedback.classList.remove(className));
  feedback.classList.add(...(styles[type] || styles.saving));
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
}

function clearProductSaveFieldErrors() {
  document.querySelectorAll("#contentProductDrawer [data-product-save-error]").forEach((element) => {
    const addedClasses = String(element.dataset.productSaveErrorClasses || "").split(" ").filter(Boolean);
    element.classList.remove(...addedClasses);
    element.removeAttribute("aria-invalid");
    delete element.dataset.productSaveError;
    delete element.dataset.productSaveErrorClasses;
  });
  document.querySelectorAll("#contentProductDrawer .product-save-field-error").forEach((note) => note.remove());
}

function markProductSaveFieldError(target, message) {
  if (!target) return false;
  const visibleTarget = target.matches("input, select, textarea, button") && !target.classList.contains("hidden")
    ? target
    : target.closest(
      ".product-bundle-component-row, .product-variant-content-link-row, " +
      ".content-product-unlock-row, [data-variant-editor-section], details, section",
    ) || target;
  const attentionClasses = ["border-purple-500", "bg-purple-950/40", "ring-1", "ring-purple-500"];
  const addedClasses = attentionClasses.filter((className) => !visibleTarget.classList.contains(className));
  visibleTarget.classList.add(...addedClasses);
  visibleTarget.dataset.productSaveError = "true";
  visibleTarget.dataset.productSaveErrorClasses = addedClasses.join(" ");
  if (target.matches("input, select, textarea")) target.setAttribute("aria-invalid", "true");
  const note = document.createElement("p");
  note.className = "product-save-field-error mt-2 text-sm font-medium text-purple-300";
  note.textContent = `Needs attention: ${message}`;
  visibleTarget.insertAdjacentElement("afterend", note);
  visibleTarget.scrollIntoView({ behavior: "smooth", block: "center" });
  if (target.matches("input, select, textarea, button") && !target.classList.contains("hidden")) {
    target.focus({ preventScroll: true });
  }
  return true;
}

function highlightProductSaveError(message) {
  const normalized = normalizedText(message);
  const activeVariantPanel = [...document.querySelectorAll(".product-variant-editor-panel")]
    .find((panel) => !panel.classList.contains("hidden"));
  const activeVariantRow = activeVariantPanel?.closest(".content-product-variant-row");
  const activeConnectionVariantId = document.getElementById("contentVariantOwnedConnections")
    ?.dataset.activeProductVariantId || "";
  const connectionVariantRow = activeConnectionVariantId
    ? document.querySelector(`.content-product-variant-row[data-product-variant-id="${CSS.escape(activeConnectionVariantId)}"]`)
    : null;
  const variantRow = activeVariantRow || connectionVariantRow;
  let target = null;
  if (normalized.includes("session start") || normalized.includes("session end")) {
    target = variantRow?.querySelector(".product-variant-event-start");
  } else if (normalized.includes("location") || normalized.includes("address")) {
    target = variantRow?.querySelector(".product-variant-event-location");
  } else if (normalized.includes("linked product variant") || normalized.includes("cannot include itself")) {
    target = variantRow?.querySelector(".product-bundle-component-row");
  } else if (normalized.includes("manufacturing") || normalized.includes("operations blueprint") ||
      normalized.includes("blueprint type")) {
    target = [...document.querySelectorAll(".product-variant-content-link-row")]
      .find((row) => !row.classList.contains("hidden"));
  } else if (normalized.includes("unlock after purchase") || normalized.includes("content to unlock")) {
    target = [...document.querySelectorAll(".content-product-unlock-row")]
      .find((row) => !row.classList.contains("hidden"));
  } else if (normalized.includes("affiliate wholesale")) {
    target = document.getElementById("contentProductWholesalePrice");
  } else if (normalized.includes("marketplace start")) {
    target = variantRow?.querySelector(".product-variant-marketplace-start") ||
      document.getElementById("contentProductMarketplaceStartsAt");
  } else if (normalized.includes("marketplace end")) {
    target = variantRow?.querySelector(".product-variant-marketplace-end") ||
      document.getElementById("contentProductMarketplaceEndsAt");
  } else if (normalized.includes("sale end")) {
    target = variantRow?.querySelector(".product-variant-sale-end") ||
      document.getElementById("contentProductSaleEndsAt");
  } else if (normalized.includes("select or create a product")) {
    target = document.getElementById("contentProductId");
  }
  target ||= activeVariantPanel?.querySelector(`[data-variant-editor-section="${CSS.escape(activeVariantPanel.dataset.editorSection || "")}"]`);
  target ||= document.querySelector("#contentProductDrawer details[open]");
  target ||= document.getElementById("contentProductSaveFeedback");
  markProductSaveFieldError(target, message);
}

function focusProductVariantSaveIssue(variantId, section, selector) {
  const row = [...document.querySelectorAll(".content-product-variant-row")].find((candidate) =>
    (candidate.querySelector(".product-variant-id")?.value || candidate.dataset.productVariantId || "") ===
      variantId);
  if (!row) return;
  row.querySelector(`[data-variant-editor="${section}"]`)?.click();
  setTimeout(() => {
    const field = row.querySelector(selector);
    field?.scrollIntoView({ behavior: "smooth", block: "center" });
    field?.focus({ preventScroll: true });
  }, 0);
}

async function saveProductDetailsFromDrawer({ closeDrawer = true, validateComplete = true } = {}) {
  const button = document.getElementById("applyContentProductBtn");
  const returnStep = state.currentStep;
  if (button?.dataset.saving === "true") return false;
  if (button) {
    button.dataset.saving = "true";
    button.disabled = true;
    button.textContent = "Saving product details...";
  }
  setProductSaveFeedback("saving", "Saving Product details. Please wait; one click is enough.");
  clearProductSaveFieldErrors();
  try {
    const payload = await formPayload(false);
    if (!payload.productRelation) throw new Error("Select or create a Product first.");
    const productVariants = payload.productRelation.variants || [];
    if (validateComplete && payload.productRelation.requiresSessionTime === true) {
      const incomplete = productVariants.find((variant) => !variant.eventStartAt || !variant.eventEndAt);
      if (incomplete) {
        focusProductVariantSaveIssue(incomplete.variantId, "purchase", ".product-variant-event-start");
        throw new Error(`Enter the session start and end time for ${incomplete.name || "each Product variant"}.`);
      }
    }
    if (validateComplete && payload.productRelation.requiresLocation === true) {
      const incomplete = productVariants.find((variant) => !variant.eventLocation);
      if (incomplete) {
        focusProductVariantSaveIssue(incomplete.variantId, "purchase", ".product-variant-event-location");
        throw new Error(`Enter the location or address for ${incomplete.name || "each Product variant"}.`);
      }
    }
    payload.status = state.editingRecord?.status || payload.status || "draft";
    payload.shopVisible = payload.productRelation.visible === true;
    const savedProductId = payload.productRelation.productId || payload.productRelation.existingProductId || "";

    if (state.editingRecord) {
      await updateContentControlRecord({
        recordType: state.editingRecord.recordType,
        recordId: state.editingRecord.id,
        updates: payload,
      });
    } else {
      const response = await createContentBuilderRecord(payload);
      if (response.data?.duplicateWarning) {
        showDuplicateWarning(response.data.similar || [], payload);
        throw new Error("Review the similar record before creating this Product.");
      }
      const recordId = response.data?.id;
      if (!recordId) throw new Error("The Product saved, but the content ID was not returned.");
      state.editingRecord = { id: recordId, recordType: payload.recordType };
      history.replaceState({}, "", `/admin/content/builder?type=${encodeURIComponent(payload.recordType)}` +
        `&id=${encodeURIComponent(recordId)}`);
    }
    setProductSaveFeedback("success", "Product details saved successfully.");
    if (!closeDrawer) {
      state.editingRecord = {
        ...(state.editingRecord || {}),
        ...payload,
        id: state.editingRecord?.id,
        recordType: state.editingRecord?.recordType || payload.recordType,
      };
      state.isDirty = false;
      renderBuilderSummaries(state.editingRecord);
      showToast("Product section saved.", "success");
      window.dispatchEvent(new CustomEvent("admin-product-saved"));
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 450));
    state.isDirty = false;
    closeContentProductDrawer();
    await loadData();
    if (savedProductId && contentBuilderCreationStack.at(-1)?.target?.connectionKind ===
        "product-prerequisite") {
      const savedProduct = (state.records.products || []).find((product) =>
        product.id === savedProductId);
      await restoreNestedParent({
        selectedRecord: savedProduct || { id: savedProductId, name: savedProductId },
      });
      window.dispatchEvent(new CustomEvent("admin-product-saved"));
      return;
    }
    if (savedProductId && (state.records.products || []).some((product) => product.id === savedProductId)) {
      chooseExistingProduct(savedProductId);
    }
    state.isDirty = false;
    showBuilderStep(returnStep);
    renderBuilderSummaries(state.editingRecord);
    showToast("Product details saved.", "success");
    window.dispatchEvent(new CustomEvent("admin-product-saved"));
    return true;
  } catch (error) {
    console.error("Failed to save Product details:", error);
    const message = error.message || "Failed to save Product details.";
    setProductSaveFeedback("error", message);
    highlightProductSaveError(message);
    showToast(message, "error");
    return false;
  } finally {
    if (button) {
      button.dataset.saving = "false";
      button.disabled = false;
      button.textContent = "Save product details";
    }
  }
}

async function saveProductSection(doneButton) {
  if (doneButton?.dataset.saving === "true") return false;
  const originalText = doneButton?.textContent || "Done";
  if (doneButton) {
    doneButton.dataset.saving = "true";
    doneButton.disabled = true;
    doneButton.textContent = "Saving...";
  }
  try {
    return await saveProductDetailsFromDrawer({ closeDrawer: false, validateComplete: false });
  } finally {
    if (doneButton) {
      doneButton.dataset.saving = "false";
      doneButton.disabled = false;
      doneButton.textContent = originalText;
    }
  }
}

async function saveConnectionsFromPage() {
  const button = document.getElementById("saveContentConnectionsBtn");
  if (!state.editingRecord?.id) {
    showToast("Review and save this content before adding connections.", "error");
    showBuilderStep(3);
    return;
  }
  if (button?.dataset.saving === "true") return;
  if (button) {
    button.dataset.saving = "true";
    button.disabled = true;
    button.textContent = "Saving connections...";
  }
  try {
    const payload = await formPayload(false);
    payload.status = state.editingRecord.status || payload.status || "draft";
    payload.approvalStatus = state.editingRecord.approvalStatus || payload.approvalStatus || "draft";
    await updateContentControlRecord({
      recordType: state.editingRecord.recordType,
      recordId: state.editingRecord.id,
      updates: payload,
    });
    state.isDirty = false;
    await loadData();
    showBuilderStep(4);
    renderBuilderSummaries(state.editingRecord);
    showToast("Connections saved.", "success");
    window.dispatchEvent(new CustomEvent("admin-product-saved"));
  } catch (error) {
    console.error("Failed to save content connections:", error);
    showToast(error.message || "Failed to save connections.", "error");
  } finally {
    if (button) {
      button.dataset.saving = "false";
      button.disabled = false;
      button.textContent = "Save connections";
    }
  }
}

async function saveTemplate() {
  const saveButton = document.getElementById("templateFormSaveBtn");
  if (saveButton?.dataset.saving === "true") return;
  if (saveButton) {
    saveButton.dataset.saving = "true";
    saveButton.setAttribute("disabled", "disabled");
    saveButton.textContent = "Saving template...";
  }
  try {
    const previouslySelectedId = selectedTemplate()?.id || "";
    const payload = templatePayload();
    const response = await upsertContentBuilderTemplate(payload);
    const savedTemplate = response.data?.template;
    const definitions = response.data?.definitions || [];
    if (!savedTemplate || !definitions.length) {
      throw new Error("The template was saved without returned variant definitions.");
    }

    addSavedTemplatesToState(definitions);
    try {
      await refreshTemplateDefinitions();
    } catch (refreshError) {
      console.warn("Template saved, but its server definitions could not be refreshed immediately.", refreshError);
    }
    const savedIds = new Set(definitions.map((definition) => definition.id));
    const refreshedDefinitions = templateDefinitions(savedTemplate.recordType, savedTemplate.appliesTo)
      .filter((definition) => savedIds.has(definition.id));
    const availableDefinitions = refreshedDefinitions.length ? refreshedDefinitions : definitions;
    const selectedDefinition = availableDefinitions.find((definition) => definition.id === previouslySelectedId) ||
      availableDefinitions.find((definition) => definition.isDefault) ||
      availableDefinitions[0];
    if (selectedDefinition?.active !== false) {
      selectSavedTemplateWithoutReset(selectedDefinition);
      showToast("Template saved and selected.", "success");
    } else {
      showToast("Inactive template saved. It will not appear in template selectors.", "success");
    }
    document.getElementById("contentTemplateForm")?.reset();
    closeTemplateCreator();
  } catch (err) {
    console.error("Failed to save content template:", err);
    const message = err?.code === "functions/deadline-exceeded" || err?.code === "deadline-exceeded"
      ? "The template save timed out. Your form is still open; restart the Functions emulator and try again."
      : err.message || "Failed to save template.";
    showToast(message, "error");
  } finally {
    saveButton?.removeAttribute("disabled");
    if (saveButton) {
      delete saveButton.dataset.saving;
      saveButton.textContent = "Save template";
    }
  }
}

export async function setupContentBuilder() {
  const section = document.getElementById("adminContentBuilderSection");
  if (!section || section.dataset.initialized === "true") return;
  section.dataset.initialized = "true";
  restorePersistedContentBuilderCreationStack();
  window.addEventListener("content-builder-root-reset", resetContentBuilderCreationStack);
  orderProductDrawerSections();
  initializeContentBuilderWorkspace();
  setContentErdBranchDefaults();
  ["product", "library"].forEach((branch) => {
    const checkbox = document.getElementById(
      branch === "library" ? "contentShowLibraryErd" : "contentShowProductErd",
    );
    checkbox?.addEventListener("change", () => {
      renderBuilderSummaries();
    });
  });

  setupBuilderStepControls();
  document.getElementById("contentRecordType")?.addEventListener("change", () => {
    if (!state.editingRecord) {
      setHiddenRelationshipIds("contentLinkedItemIds", []);
      setHiddenRelationshipIds("contentLinkedBlueprintIds", []);
      setHiddenRelationshipIds("contentLinkedPlanIds", []);
    }
    updateFormForRecordType();
  });
  document.getElementById("newContentBuilderRecordBtn")?.addEventListener("click", () => {
    clearEditMode();
    showBuilderStep(1);
    setContentEntityEditorDrawerOpen(true);
  });
  document.getElementById("openContentEntityEditorDrawerBtn")?.addEventListener("click", () => {
    showBuilderStep(state.editingRecord?.id ? 1 : state.currentStep || 1);
    setContentEntityEditorDrawerOpen(true);
  });
  document.getElementById("closeContentEntityEditorDrawerBtn")?.addEventListener(
    "click", closeOrReturnFromContentCreator,
  );
  document.getElementById("returnToParentEntityBtn")?.addEventListener("click", () => {
    restoreNestedParent({ cancelled: true });
  });
  setupBuilderFilters();
  document.getElementById("contentType")?.addEventListener("change", () => {
    const variants = entityVariantsFromBuilder();
    const defaultTemplate = updateTemplatesForType();
    const validTemplateIds = new Set(templateDefinitions(
      currentRecordType(),
      document.getElementById("contentType")?.value || "",
    ).map((template) => template.id));
    renderEntityVariantRows(variants.map((variant) => {
      if (validTemplateIds.has(variant.templateVariantId)) return variant;
      return {
        ...variant,
        templateId: defaultTemplate?.templateId || "",
        templateVariantId: defaultTemplate?.id || "",
        templateFieldValues: {},
      };
    }));
    applyTypeDrivenFieldGroups();
    renderSimilarList();
    renderRelationshipPickers();
    updateBuilderFilterButtons(currentRecordType());
    updateProductRelationshipControl();
    document.getElementById("contentAudienceGoalFields")?.classList.toggle(
      "hidden",
      isProductManufactureBlueprint(),
    );
  });
  document.getElementById("contentTemplate")?.addEventListener("change", () => {
    const template = selectedTemplate();
    applyTemplateToPrimaryEntityVariant(template);
    applyTemplateDefaults();
  });
  document.getElementById("editContentTemplateBtn")?.addEventListener(
    "click",
    openTemplateEditorForSelectedTemplate,
  );
  document.getElementById("createPlanTemplateBtn")?.addEventListener(
    "click",
    openTemplateCreatorForCurrentRecord,
  );
  document.getElementById("closeContentTemplateToolBtn")?.addEventListener(
    "click",
    closeTemplateCreator,
  );
  document.getElementById("contentTemplateToolSection")?.addEventListener("click", (event) => {
    if (event.target.id === "contentTemplateToolSection") closeTemplateCreator();
  });
  document.getElementById("closeContentAssetDrawerBtn")?.addEventListener("click", closeContentAssetDrawer);
  document.getElementById("toggleContentAssetHelpBtn")?.addEventListener("click", () => {
    const button = document.getElementById("toggleContentAssetHelpBtn");
    const panel = document.getElementById("contentAssetHelpPanel");
    const isOpening = panel?.classList.contains("hidden");
    panel?.classList.toggle("hidden", !isOpening);
    button?.setAttribute("aria-expanded", String(isOpening));
    if (button) button.textContent = isOpening ? "Hide help" : "Help";
  });
  document.getElementById("contentAssetDrawer")?.addEventListener("click", (event) => {
    if (event.target.id === "contentAssetDrawer") closeContentAssetDrawer();
  });
  document.getElementById("contentAssetDrawerForm")?.addEventListener("submit", saveContentAsset);
  document.getElementById("contentAssetType")?.addEventListener("change", (event) => {
    const file = document.getElementById("contentAssetFile");
    if (file) file.accept = assetFileAccept(event.target.value);
    const external = ["Video", "Canva Design"].includes(event.target.value);
    setInputValue("contentAssetStorageMethod", external ? "external" : "upload");
    if (external) {
      setInputValue("contentAssetExternalProvider", event.target.value === "Canva Design" ? "canva" : "youtube");
    }
    updateContentAssetStorageMethod();
  });
  document.getElementById("contentAssetStorageMethod")?.addEventListener(
    "change",
    updateContentAssetStorageMethod,
  );
  document.getElementById("contentAssetFile")?.addEventListener("change", (event) => {
    assetDrawerFile = event.target.files?.[0] || null;
    const selectedFile = document.getElementById("contentAssetSelectedFile");
    if (selectedFile) {
      selectedFile.textContent = assetDrawerFile
        ? `Selected: ${assetDrawerFile.name}`
        : "No file selected.";
    }
    if (assetDrawerFile && resumeAssetSaveAfterFileSelection) {
      resumeAssetSaveAfterFileSelection = false;
      const form = document.getElementById("contentAssetDrawerForm");
      if (form?.reportValidity()) form.requestSubmit();
    } else if (!assetDrawerFile) {
      resumeAssetSaveAfterFileSelection = false;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !document.getElementById("contentTemplateToolSection")?.classList.contains("hidden")
    ) {
      closeTemplateCreator();
    }
    if (
      event.key === "Escape" &&
      !document.getElementById("contentAssetDrawer")?.classList.contains("hidden")
    ) closeContentAssetDrawer();
  });
  document.getElementById("contentName")?.addEventListener("input", () => {
    renderSimilarList();
    updateContentBuilderCreationBreadcrumb();
  });
  ["contentName", "contentShortDescription", "contentLongDescription", "contentProductPrice",
    "contentProductSalePrice"]
    .forEach((id) => document.getElementById(id)?.addEventListener("input", () => {
      refreshMarketplacePreviews();
      renderMarketplaceTileControls();
    }));
  document.getElementById("contentSimilarList")?.addEventListener("click", async (event) => {
    const button = event.target.closest(
      ".edit-similar-content-record, .use-similar-content-record",
    );
    if (!button) return;
    const recordType = button.dataset.recordType || currentRecordType();
    const recordId = button.dataset.recordId || "";
    const record = findRecord(recordType, recordId);
    if (!record) {
      showToast("That similar record could not be loaded. Refresh and try again.", "error");
      return;
    }
    if (button.classList.contains("use-similar-content-record")) {
      await restoreNestedParent({ selectedRecord: record });
      return;
    }
    history.replaceState({}, "", `/admin/content/builder?type=${encodeURIComponent(recordType)}&id=${encodeURIComponent(recordId)}`);
    populateBuilderFromRecord(record);
    showBuilderStep(1);
    setContentEntityEditorDrawerOpen(true);
    state.isDirty = false;
    showToast(
      contentBuilderCreationStack.length
        ? `Editing ${record.name || record.id}. Save it to link it and return to the previous work.`
        : `Editing ${record.name || record.id} instead.`,
      "success",
    );
  });
  document.getElementById("contentTagRows")?.addEventListener("change", handleTagRowsChange);
  document.getElementById("contentTagRows")?.addEventListener("input", handleTagRowsInput);
  document.getElementById("contentTagRows")?.addEventListener("click", handleTagRowsClick);
  document.getElementById("contentTagRows")?.addEventListener("focusin", (event) => {
    if (!event.target.classList.contains("content-tag-select")) return;
    const row = event.target.closest(".content-tag-row");
    closeTagSuggestions(row);
    renderTagSuggestions(row);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".content-tag-row")) closeTagSuggestions();
  });
  document.getElementById("contentTagCategoryFilter")?.addEventListener("change", refreshExistingTagOptions);
  document.getElementById("templateGuidedFields")?.addEventListener(
    "click",
    handleTemplateGuidedFieldsClick,
  );
  document.getElementById("contentEntityVariantRows")?.addEventListener(
    "click",
    handleTemplateGuidedFieldsClick,
  );
  document.getElementById("contentLinkedRecordSelectorResults")?.addEventListener("click", async (event) => {
    const variantCheckbox = event.target.closest("[data-linked-selector-variant-record-id]");
    if (variantCheckbox && linkedRecordSelectorContext?.multiple) {
      const recordId = variantCheckbox.dataset.linkedSelectorVariantRecordId || "";
      const variantId = variantCheckbox.dataset.linkedSelectorVariantId || "";
      const key = linkedSelectorChoiceKey(recordId, variantId);
      if (variantCheckbox.checked) {
        linkedRecordSelectorContext.selectedChoices.set(key, { recordId, variantId });
      } else linkedRecordSelectorContext.selectedChoices.delete(key);
      renderLinkedRecordSelector();
      return;
    }
    const allVariants = event.target.closest("[data-linked-selector-all-variants]");
    if (allVariants && linkedRecordSelectorContext?.multiple) {
      const recordId = allVariants.dataset.linkedSelectorAllVariants || "";
      const record = linkedSelectorRecords().find((candidate) => candidate.id === recordId);
      linkedSelectorRecordVariants(record, linkedRecordSelectorContext).forEach((variant) => {
        const variantId = linkedSelectorVariantId(variant);
        if (linkedSelectorVariantUnavailable(linkedRecordSelectorContext, recordId, variantId)) return;
        const key = linkedSelectorChoiceKey(recordId, variantId);
        if (allVariants.checked) {
          linkedRecordSelectorContext.selectedChoices.set(key, { recordId, variantId });
        } else linkedRecordSelectorContext.selectedChoices.delete(key);
      });
      renderLinkedRecordSelector();
      return;
    }
    const editOption = event.target.closest("[data-linked-selector-edit-record-id]");
    if (editOption) {
      const context = linkedRecordSelectorContext;
      if (!context?.select || !context.trigger) return;
      context.select.value = editOption.dataset.linkedSelectorEditRecordId || "";
      refreshLinkedTemplatePickerLabel(context.select);
      context.select.dispatchEvent(new Event("change", { bubbles: true }));
      const trigger = context.trigger;
      closeLinkedRecordSelector();
      await editSelectedLinkedRecord(trigger);
      return;
    }
    const option = event.target.closest("[data-linked-selector-record-id]");
    const context = linkedRecordSelectorContext;
    const select = context?.select;
    if (!option || !select) return;
    const recordId = option.dataset.linkedSelectorRecordId || "";
    if (context.onSelect) {
      const record = linkedSelectorRecords(context).find((candidate) =>
        (candidate.id || candidate.assetId) === recordId);
      try {
        await context.onSelect(record);
        closeLinkedRecordSelector();
      } catch (error) {
        console.error("Failed to link selected record:", error);
        showToast(error.message || "Failed to link the selected record.", "error");
      }
      return;
    }
    if (![...select.options].some((selectOption) => selectOption.value === recordId)) {
      const record = linkedSelectorRecords(context).find((candidate) =>
        (candidate.id || candidate.assetId) === recordId);
      select.add(new Option(linkedTemplateRecordLabel(record || { id: recordId }), recordId));
    }
    select.value = recordId;
    refreshLinkedTemplatePickerLabel(select);
    const field = select.closest(".content-template-linked-field");
    if (field) refreshLinkedTemplateField(field);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    state.isDirty = true;
    closeLinkedRecordSelector();
  });
  ["contentLinkedRecordSearch", "contentLinkedRecordTagFilter", "contentLinkedRecordTypeFilter"]
    .forEach((id) => document.getElementById(id)?.addEventListener(
      id === "contentLinkedRecordSearch" ? "input" : "change",
      renderLinkedRecordSelector,
    ));
  document.getElementById("closeContentLinkedRecordSelectorBtn")?.addEventListener(
    "click", closeLinkedRecordSelector,
  );
  document.getElementById("confirmContentLinkedRecordSelectorBtn")?.addEventListener("click", () => {
    const context = linkedRecordSelectorContext;
    if (!context?.multiple || !context.selectedChoices?.size) return;
    if (applyLinkedSelectorChoices(context)) closeLinkedRecordSelector();
  });
  document.getElementById("createContentLinkedRecordBtn")?.addEventListener(
    "click", createFromLinkedRecordSelector,
  );
  document.getElementById("refreshContentLinkedRecordSelectorBtn")?.addEventListener("click", async () => {
    const button = document.getElementById("refreshContentLinkedRecordSelectorBtn");
    button?.setAttribute("disabled", "");
    try {
      const response = await getContentBuilderData();
      state.options = { ...state.options, ...(response.data?.options || {}) };
      state.records = { ...state.records, ...(response.data?.records || {}) };
      renderLinkedRecordSelector();
      showToast("Selector results refreshed.", "success");
    } catch (error) {
      console.error("Failed to refresh linked content selector:", error);
      showToast(error.message || "Failed to refresh selector results.", "error");
    } finally {
      button?.removeAttribute("disabled");
    }
  });
  document.getElementById("templateGuidedFields")?.addEventListener("change", (event) => {
    const field = event.target.closest(".content-template-linked-field");
    if (field) refreshLinkedTemplateField(field);
  });
  document.getElementById("advancedContentFields")?.addEventListener("input", (event) => {
    if (event.target.classList.contains("content-relationship-search")) {
      const query = normalizedType(event.target.value);
      const picker = event.target.closest(".content-relationship-picker");
      picker?.querySelectorAll(".content-relationship-row").forEach((row) => {
        row.classList.toggle("hidden", query && !row.dataset.search.includes(query));
      });
      return;
    }

    if (event.target.classList.contains("content-relationship-checkbox")) {
      syncRelationshipPicker(event.target.dataset.relationKind);
      updateBlueprintEstimatedCost();
      updateConnectedProductCostPreview();
      state.isDirty = true;
      renderBuilderSummaries();
    }
    if (event.target.classList.contains("blueprint-item-quantity")) {
      updateBlueprintEstimatedCost();
      updateConnectedProductCostPreview();
      state.isDirty = true;
      renderBuilderSummaries();
    }
  });
  document.getElementById("contentIsShopProduct")?.addEventListener("change", (event) => {
    if (event.target.checked) openContentProductDrawer();
    showBuilderStep(state.currentStep);
    renderBuilderSummaries();
    updateSaveWorkflow();
  });
  document.getElementById("contentVariantConnectionRows")?.addEventListener("change", (event) => {
    if (!event.target.matches(
      ".variant-add-to-shop, .variant-add-to-library, .variant-use-as-manufacturing",
    )) return;
    const variants = entityVariantsFromBuilder();
    const directProductSelected =
      document.getElementById("contentIsShopProduct")?.checked === true;
    setCheckboxValue(
      "contentIsShopProduct",
      directProductSelected || variants.some((variant) => variant.shopEnabled),
    );
    setCheckboxValue("contentWebsiteVisible", variants.some((variant) => variant.libraryVisible));
    updateProductRelationshipControl();
    state.isDirty = true;
    updateSaveWorkflow();
    renderBuilderSummaries();
  });
  document.getElementById("openVariantShopProductBtn")?.addEventListener("click", () => {
    const variants = entityVariantsFromBuilder();
    const manufacturing = variants.some((variant) => variant.manufacturingRecipe);
    setCheckboxValue("contentIsShopProduct", true);
    if (manufacturing) updateProductRelationshipControl("ManufacturedFrom");
    openContentProductDrawer();
  });
  document.getElementById("applyVariantLibraryBtn")?.addEventListener("click", () => {
    const variants = entityVariantsFromBuilder();
    if (!variants.some((variant) => variant.libraryVisible)) {
      showToast("Select at least one variant to add to the Library.", "error");
      return;
    }
    setCheckboxValue("contentWebsiteVisible", true);
    state.isDirty = true;
    showToast("Library variants selected. They will be saved with this entity.", "success");
  });
  document.getElementById("saveContentConnectionsBtn")?.addEventListener(
    "click",
    saveConnectionsFromPage,
  );
  document.getElementById("contentRelationshipSummary")?.addEventListener("click", async (event) => {
    const productPreviewTarget = event.target.closest("[data-product-editor-target]");
    if (productPreviewTarget) {
      setCheckboxValue("contentIsShopProduct", true);
      openContentProductDrawer();
      focusProductEditorTarget(productPreviewTarget.dataset.productEditorTarget);
      return;
    }
    const button = event.target.closest("[data-connection-action], [data-connection-edit]");
    if (!button) return;
    const action = button.dataset.connectionAction || button.dataset.connectionEdit || "";
    if (action === "product") {
      setCheckboxValue("contentIsShopProduct", true);
      openContentProductDrawer();
      return;
    }
    if (action === "product-status") {
      openProductStatusEditor();
      return;
    }
    if (action === "product-variant") {
      openProductVariantEditor(
        button.dataset.connectionVariantId || "",
        button.dataset.connectionProductSection || "identity",
      );
      return;
    }
    if (action === "product-unlocks") {
      openProductUnlockConnections(button.dataset.connectionVariantId || "");
      return;
    }
    if (action === "entity-status") {
      await openEntityStatusEditor(button.dataset.connectionEntityVariantId || "");
      return;
    }
    if (["entity", "build"].includes(action)) {
      const entityVariantId = button.dataset.connectionEntityVariantId || "";
      if (entityVariantId) {
        await openEntityVariantEditor(entityVariantId);
        return;
      }
      await navigateBuilderStep(action === "build" ? 2 : 1);
      if (action === "build") {
        document.getElementById("contentEntityVariantRows")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    if (action === "asset") {
      openEntityAssetSelector(button);
      return;
    }
    if (action === "library") {
      openLibraryConnectionDrawer();
      return;
    }
    if (action === "entity-stock") {
      openEntityStockDrawer(button.dataset.connectionEntityVariantId || "");
      return;
    }
    if (action === "inventory-stocktake") {
      const detail = {
        entityId: button.dataset.connectionEntityId ||
          document.getElementById("contentId")?.value || state.editingRecord?.id || "",
        entityVariantId: button.dataset.connectionEntityVariantId || "",
        entityName: button.dataset.connectionEntityName || "",
      };
      sessionStorage.setItem("recovery-tools-inventory-stocktake-focus", JSON.stringify(detail));
      document.querySelector(".admin-link[href=\"/admin/products\"]")?.click();
      window.dispatchEvent(new CustomEvent("inventory-stocktake-focus", { detail }));
      return;
    }
    if (action === "stock") {
      setCheckboxValue("contentIsShopProduct", true);
      openContentProductDrawer();
      const variantId = button.dataset.connectionVariantId || "";
      const escapedVariantId = typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(variantId)
        : variantId.replace(/["\\]/g, "\\$&");
      const row = variantId
        ? document.querySelector(`.content-product-variant-row[data-product-variant-id="${escapedVariantId}"]`)
        : document.querySelector(".content-product-variant-row");
      row?.querySelector("[data-variant-editor=\"purchase\"]")?.click();
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (action === "bundle") {
      setCheckboxValue("contentIsShopProduct", true);
      openContentProductDrawer();
      const variantId = button.dataset.connectionVariantId || currentProductVariants()[0]?.variantId || "";
      const escapedVariantId = typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(variantId)
        : variantId.replace(/["\\]/g, "\\$&");
      const row = variantId
        ? document.querySelector(`.content-product-variant-row[data-product-variant-id="${escapedVariantId}"]`)
        : document.querySelector(".content-product-variant-row");
      row?.querySelector("[data-variant-editor=\"purchase\"]")?.click();
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (["blueprint-manufacturing", "blueprint-operations"].includes(action)) {
      openProductBlueprintConnections(
        action === "blueprint-operations" ? "OperatedWith" : "ManufacturedFrom",
        button.dataset.connectionVariantId || "",
      );
      return;
    }
    if (action === "entity-field") {
      await openEntityVariantEditor(
        button.dataset.connectionEntityVariantId || "",
        button.dataset.connectionFieldKey || "",
      );
      return;
    }
    if (action === "entity-connections") {
      await navigateBuilderStep(2);
      const target = document.querySelector(".content-template-linked-field") ||
        document.getElementById("advancedContentFields") ||
        document.getElementById("contentEntityVariantRows");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  ["closeContentLibraryConnectionDrawerBtn", "cancelContentLibraryConnectionBtn"]
    .forEach((id) => document.getElementById(id)?.addEventListener(
      "click", () => setConnectionDrawerOpen("contentLibraryConnectionDrawer", false),
    ));
  document.getElementById("saveContentLibraryConnectionBtn")?.addEventListener(
    "click", applyLibraryConnectionDrawer,
  );
  ["closeContentEntityStockDrawerBtn", "cancelContentEntityStockBtn"]
    .forEach((id) => document.getElementById(id)?.addEventListener(
      "click", () => closeEntityStockDrawer({ restoreValues: true }),
    ));
  document.getElementById("saveContentEntityStockBtn")?.addEventListener(
    "click", applyEntityStockDrawer,
  );
  document.getElementById("contentProductPrice")?.addEventListener("input", updateConnectedProductCostPreview);
  document.getElementById("contentProductDeliveryType")?.addEventListener("change", () => {
    updateProductPhysicalFields();
  });
  document.getElementById("contentProductHasPhysicalFulfilment")?.addEventListener("change", () => {
    updateProductPhysicalFields();
    syncSelectedProductVariantRows();
    state.isDirty = true;
  });
  document.getElementById("contentProductInventoryTracked")?.addEventListener(
    "change",
    () => {
      updateProductPhysicalFields();
      renderMarketplaceTileControls();
      refreshMarketplacePreviews();
    },
  );
  document.getElementById("contentProductAvailableToAffiliates")?.addEventListener("change", () => {
    updateProductPhysicalFields();
    renderMarketplaceTileControls();
    refreshMarketplacePreviews();
    state.isDirty = true;
  });
  ["contentProductRequiresShipping", "contentProductRequiresCalendar", "contentProductTracksSeats", "contentProductRequiresSessionTime",
    "contentProductRequiresLocation", "contentProductRequiresInstructor"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      updateProductPhysicalFields();
      renderMarketplaceTileControls();
    });
  });
  document.getElementById("contentItemUnitCost")?.addEventListener("input", updateConnectedProductCostPreview);
  document.getElementById("contentProductManufacturingRecipe")?.addEventListener("change", (event) => {
    const manufacturing = event.target.checked === true && currentRecordType() === "blueprint";
    const roleInput = document.getElementById("contentProductLinkRole");
    if (roleInput) roleInput.value = manufacturing ? "ManufacturedFrom" : "Represents";
    renderProductBlueprintOptions(
      manufacturing ? document.getElementById("contentId")?.value || state.editingRecord?.id || "" : "",
    );
  });
  document.getElementById("contentProductSearch")?.addEventListener("input", (event) => {
    renderProductChoiceList(event.target.value);
  });
  document.getElementById("contentProductEntitySearch")?.addEventListener(
    "input",
    renderProductEntityChoices,
  );
  document.getElementById("contentProductEntityTypeFilter")?.addEventListener("change", () => {
    fillProductEntitySubtypeFilter();
    renderProductEntityChoices();
  });
  document.getElementById("contentProductEntitySubtypeFilter")?.addEventListener(
    "change",
    renderProductEntityChoices,
  );
  document.getElementById("contentProductEntityChoiceList")?.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-product-entity-id]");
    if (choice) chooseProductEntity(choice.dataset.productEntityType, choice.dataset.productEntityId);
  });
  document.getElementById("contentProductChoiceList")?.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-product-choice]");
    if (choice) chooseExistingProduct(choice.dataset.productChoice);
  });
  document.getElementById("addProductVariantContentLinkBtn")?.addEventListener(
    "click",
    (event) => {
      const ownerVariantId = event.currentTarget.dataset.productVariantId || "";
      const existing = [...document.querySelectorAll(".product-variant-content-link-row")].find((row) =>
        row.querySelector(".variant-content-product-variant")?.value === ownerVariantId);
      if (existing) {
        openLinkedRecordSelector(existing.querySelector(".open-content-linked-selector"));
        return;
      }
      addProductVariantContentLinkRow(ownerVariantId);
      const created = [...document.querySelectorAll(".product-variant-content-link-row")].find((row) =>
        row.querySelector(".variant-content-product-variant")?.value === ownerVariantId);
      openLinkedRecordSelector(created?.querySelector(".open-content-linked-selector"));
    },
  );
  document.getElementById("productVariantContentLinkRows")?.addEventListener("click", (event) => {
    const remove = event.target.closest(".remove-product-variant-content-link");
    if (!remove) return;
    remove.closest(".product-variant-content-link-row")?.remove();
    productVariantContentLinksFromRows(true);
    renderProductBlueprintOptions(document.getElementById("contentProductBlueprintId")?.value || "");
    filterVariantOwnedConnections(
      document.getElementById("contentVariantOwnedConnections")?.dataset.activeProductVariantId || "",
    );
    refreshMarketplacePreviews();
    state.isDirty = true;
  });
  document.getElementById("productVariantContentLinkRows")?.addEventListener("change", (event) => {
    if (!event.target.matches(
      ".variant-content-product-variant, .variant-content-blueprint, " +
      ".variant-content-blueprint-variant, .variant-content-link-role",
    )) return;
    if (event.target.classList.contains("variant-content-link-role")) {
      refreshProductBlueprintRoleConstraint(
        event.target.closest(".product-variant-content-link-row"),
        true,
      );
    }
    if (event.target.classList.contains("variant-content-blueprint")) {
      const row = event.target.closest(".product-variant-content-link-row");
      const variantSelect = row?.querySelector(".variant-content-blueprint-variant");
      if (variantSelect) {
        variantSelect.innerHTML = `<option value="">${escapeHTML(defaultBlueprintContentVariantLabel(event.target.value))}</option>` +
          blueprintContentVariantOptions(event.target.value);
      }
    }
    refreshProductBlueprintConnectionSummary(
      event.target.closest(".product-variant-content-link-row"),
    );
    productVariantContentLinksFromRows(true);
    renderProductBlueprintOptions(document.getElementById("contentProductBlueprintId")?.value || "");
    refreshMarketplacePreviews();
    state.isDirty = true;
  });
  document.getElementById("contentProductVariants")?.addEventListener("change", () => {
    renderProductVariantContentLinkRows(productVariantContentLinksFromRows(true));
  });
  document.getElementById("addContentProductVariantBtn")?.addEventListener(
    "click",
    addIndependentProductVariant,
  );
  ["contentProductTileImageSource", "contentProductTileDescriptionSource"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      renderMarketplaceTileControls();
      document.getElementById(id)?.closest("[data-product-context-panel]")?.classList.add("hidden");
      state.isDirty = true;
      returnToProductTilePreview();
    });
  });
  [
    ["contentProductPreviewName", "contentName"],
    ["contentProductPreviewShortDescription", "contentShortDescription"],
    ["contentProductPreviewLongDescription", "contentLongDescription"],
  ].forEach(([sourceId, targetId]) => {
    document.getElementById(sourceId)?.addEventListener("input", (event) => {
      setInputValue(targetId, event.target.value);
      if (targetId === "contentName") renderSimilarList();
      refreshMarketplacePreviews();
      renderMarketplaceTileControls();
      state.isDirty = true;
    });
  });
  document.getElementById("contentProductDrawer")?.addEventListener("click", async (event) => {
    const editLinkedRecord = event.target.closest(".edit-selected-linked-record");
    if (editLinkedRecord) {
      editSelectedLinkedRecord(editLinkedRecord);
      return;
    }
    const linkedSelector = event.target.closest(".open-content-linked-selector");
    if (linkedSelector) {
      openLinkedRecordSelector(linkedSelector);
      return;
    }
    const closeContext = event.target.closest("[data-close-product-context]");
    if (closeContext) {
      if (!await saveProductSection(closeContext)) return;
      closeContext.closest("[data-product-context-panel]")?.classList.add("hidden");
      returnToProductTilePreview();
      return;
    }
    const closeButton = event.target.closest("[data-close-product-editor]");
    if (!closeButton) return;
    const section = closeButton.closest("details");
    if (!section) return;
    if (section.id === "contentProductFulfilmentSection") section.dataset.reviewed = "true";
    if (!await saveProductSection(closeButton)) return;
    section.open = false;
    if (section.hasAttribute("data-product-preview-section")) section.classList.add("hidden");
    returnToProductTilePreview();
  });
  document.getElementById("contentProductDrawer")?.addEventListener("change", (event) => {
    const statusCheckbox = event.target.closest(".content-product-status-checkbox");
    if (!statusCheckbox) return;
    const currentStatus = currentProductEditorStatus();
    const nextStatus = statusCheckbox.dataset.contentProductStatus || "draft";
    if (!statusCheckbox.checked) {
      syncProductStatusCheckboxes();
      return;
    }
    if (["paused", "archived"].includes(nextStatus) && nextStatus !== currentStatus &&
        !window.confirm(`Are you sure you want to mark this Product as ${nextStatus}?`)) {
      syncProductStatusCheckboxes();
      return;
    }
    setProductEditorStatus(nextStatus);
  });
  document.getElementById("closeVariantOwnedConnectionsBtn")?.addEventListener("click", async (event) => {
    if (!await saveProductSection(event.currentTarget)) return;
    const owner = document.getElementById("contentVariantOwnedConnections");
    owner?.classList.add("hidden");
    const summary = document.getElementById("contentVariantOwnedConnectionsSummary");
    if (summary) summary.textContent = "Select Blueprints or Unlocks from a variant preview.";
    returnToVariantPreview(document.querySelector(
      `.content-product-variant-row[data-product-variant-id="${CSS.escape(owner?.dataset.activeProductVariantId || "")}"]`,
    ));
  });
  document.getElementById("contentProductTilePreview")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-product-status-controls]")) {
      const controls = document.querySelector(".content-product-status-checkbox")?.closest("fieldset");
      controls?.scrollIntoView({ behavior: "smooth", block: "center" });
      controls?.querySelector("input:checked")?.focus({ preventScroll: true });
      return;
    }
    const trigger = event.target.closest("[data-product-editor-target]");
    if (trigger) focusProductEditorTarget(trigger.dataset.productEditorTarget);
  });
  ["contentProductMarketplaceMode", "contentProductMarketplaceAudience", "contentProductShopStatus"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      renderMarketplaceTileControls();
      refreshMarketplacePreviews();
      state.isDirty = true;
    });
  });
  ["contentProductWholesalePrice", "contentProductDeliveryType",
    "contentProductFeatured", "contentProductArchived", "contentProductHasPhysicalFulfilment"]
    .forEach((id) => document.getElementById(id)?.addEventListener("change", () => {
      if (id === "contentProductArchived") {
        const archivedInput = document.getElementById(id);
        if (archivedInput && !archivedInput.checked && currentProductVariants().length &&
            currentProductVariants().every((variant) => variant.status === "archived")) {
          archivedInput.checked = true;
          archivedInput.dataset.autoArchived = "true";
          showToast("Reactivate at least one Product variant before restoring the Product.", "error");
        } else if (archivedInput) {
          delete archivedInput.dataset.autoArchived;
        }
      }
      renderMarketplaceTileControls();
      refreshMarketplacePreviews();
      if (id === "contentProductDeliveryType") {
        document.getElementById(id)?.closest("[data-product-context-panel]")?.classList.add("hidden");
        returnToProductTilePreview();
      }
    }));
  document.getElementById("contentProductCategoryId")?.addEventListener("change", (event) => {
    const select = event.currentTarget;
    if (select.value === "__create_category__") {
      const panel = document.getElementById("contentProductCategoryCreate");
      panel?.classList.remove("hidden");
      panel?.classList.add("flex");
      document.getElementById("contentProductCategoryNewName")?.focus();
      return;
    }
    select.dataset.previousCategoryId = select.value;
    closeProductCategoryCreator({ restoreSelection: false });
    renderMarketplaceTileControls();
    refreshMarketplacePreviews();
    select.closest("[data-product-context-panel]")?.classList.add("hidden");
    returnToProductTilePreview();
  });
  document.getElementById("saveContentProductCategoryBtn")?.addEventListener("click", saveProductCategory);
  document.getElementById("cancelContentProductCategoryBtn")?.addEventListener(
    "click", () => closeProductCategoryCreator(),
  );
  document.getElementById("contentProductCategoryNewName")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    saveProductCategory();
  });
  document.getElementById("contentProductWholesalePrice")?.addEventListener(
    "input",
    renderMarketplaceTileControls,
  );
  document.getElementById("contentProductVariantRows")?.addEventListener("mouseover", (event) => {
    const trigger = event.target.closest(".open-admin-linked-variant-bubble");
    if (trigger && !trigger.contains(event.relatedTarget)) showAdminLinkedVariantBubble(trigger);
  });
  document.getElementById("contentProductVariantRows")?.addEventListener("mouseout", (event) => {
    const trigger = event.target.closest(".open-admin-linked-variant-bubble");
    if (trigger && !trigger.contains(event.relatedTarget)) closeAdminLinkedVariantBubbleSoon();
  });
  document.getElementById("contentProductVariantRows")?.addEventListener("click", async (event) => {
    const editLinkedRecord = event.target.closest(".edit-selected-linked-record");
    if (editLinkedRecord) {
      event.stopPropagation();
      editSelectedLinkedRecord(editLinkedRecord);
      return;
    }
    const linkedSelector = event.target.closest(".open-content-linked-selector");
    if (linkedSelector) {
      event.stopPropagation();
      openLinkedRecordSelector(linkedSelector);
      return;
    }
    const copySettings = event.target.closest("[data-copy-product-variant-settings]");
    if (copySettings) {
      syncSelectedProductVariantRows();
      const row = copySettings.closest(".content-product-variant-row");
      const targetVariantId = row?.dataset.productVariantId || "";
      const sourceVariantId = row?.querySelector(".copy-product-variant-source")?.value || "";
      const variants = currentProductVariants();
      const source = variants.find((variant) => variant.variantId === sourceVariantId);
      const targetIndex = variants.findIndex((variant) => variant.variantId === targetVariantId);
      if (!source || targetIndex < 0) {
        showToast("Choose another Product variant to copy.", "error");
        return;
      }
      variants[targetIndex] = copyProductVariantSettings(source, variants[targetIndex]);
      copyVariantOwnedConnections(sourceVariantId, targetVariantId);
      setInputValue("contentProductVariants", serializeProductVariants(variants));
      renderSelectedProductVariantRows(variants);
      state.isDirty = true;
      showToast("Variant price, fulfilment, visibility, descriptions, Blueprints, unlocks and promotion media copied.", "success");
      return;
    }
    const duplicateVariant = event.target.closest("[data-duplicate-product-variant]");
    if (duplicateVariant) {
      syncSelectedProductVariantRows();
      const sourceVariantId = duplicateVariant.closest(".content-product-variant-row")
        ?.dataset.productVariantId || "";
      const variants = currentProductVariants();
      const source = variants.find((variant) => variant.variantId === sourceVariantId);
      if (!source) return;
      const duplicateId = generatedProductVariantId(`COPY-${Date.now()}`);
      const duplicate = {
        ...structuredClone(source),
        variantId: duplicateId,
        contentVariantId: "",
        contentVariantLinkReviewed: false,
        name: `${source.name || "Product variant"} copy`,
        sku: "",
        stock: 0,
        status: "draft",
        marketplaceMode: "hidden",
      };
      variants.push(duplicate);
      copyVariantOwnedConnections(sourceVariantId, duplicateId);
      setInputValue("contentProductVariants", serializeProductVariants(variants));
      renderSelectedProductVariantRows(variants);
      document.querySelector(`.content-product-variant-row[data-product-variant-id="${CSS.escape(duplicateId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      state.isDirty = true;
      showToast("Variant duplicated as a safe hidden draft with zero stock and a new exact-variant ID.", "success");
      return;
    }
    const restoreField = event.target.closest("[data-restore-variant-field]");
    if (restoreField) {
      const row = restoreField.closest(".content-product-variant-row");
      const field = restoreField.dataset.restoreVariantField;
      const selectors = {
        name: ".product-variant-name",
        colour: ".product-variant-colour",
        size: ".product-variant-size",
        weight: ".product-variant-weight",
        shortDescription: ".product-variant-short-description",
        longDescription: ".product-variant-long-description",
        price: ".product-variant-price",
        affiliatePrice: ".product-variant-wholesale-price",
        fulfilment: ".product-variant-physical-fulfilment",
        visibility: ".product-variant-marketplace-mode",
      };
      const input = row?.querySelector(selectors[field] || "[data-no-variant-field]");
      if (!row || !input) return;
      if (["name", "colour", "size"].includes(field)) {
        const contentVariantId = row.querySelector(".product-variant-content-variant")?.value ||
          row.dataset.contentVariantId || "";
        const entityVariant = entityVariantsFromBuilder().find((variant) =>
          variant.entityVariantId === contentVariantId) || {};
        input.value = field === "name" ? entityVariant.name || "" :
          field === "size" ? entityVariant.sizeLabel || "" : entityVariant.colour || "";
      } else if (field === "visibility") {
        input.value = "inherit";
        row.querySelector(".product-variant-marketplace-start").value = "";
        row.querySelector(".product-variant-marketplace-end").value = "";
      } else if (field === "fulfilment") {
        input.value = "none";
      } else {
        input.value = "";
      }
      updateMarketplacePreviewRow(input);
      syncSelectedProductVariantRows();
      state.isDirty = true;
      showToast("Inherited value restored. Save Product details when finished.", "success");
      return;
    }
    const linkedVariantPreview = event.target.closest(".open-admin-linked-variant-bubble");
    if (linkedVariantPreview) {
      showAdminLinkedVariantBubble(linkedVariantPreview, true);
      return;
    }
    const createPromotionAsset = event.target.closest(".create-product-variant-promotion-asset");
    if (createPromotionAsset) {
      openContentAssetDrawer(createPromotionAsset);
      return;
    }
    const addPromotionAsset = event.target.closest(".add-existing-product-variant-promotion-asset");
    if (addPromotionAsset) {
      const row = addPromotionAsset.closest(".content-product-variant-row");
      const picker = row?.querySelector(".product-variant-promotion-asset-picker");
      const selected = row?.querySelector(".product-variant-promotion-assets");
      const assetId = picker?.value || "";
      const option = [...(selected?.options || [])].find((candidate) => candidate.value === assetId);
      if (!assetId || !option) {
        showToast("Choose a video Asset first.", "error");
        return;
      }
      option.selected = true;
      picker.value = "";
      refreshPromotionAssetSelection(row);
      updateMarketplacePreviewRow(selected);
      state.isDirty = true;
      return;
    }
    const removePromotionAsset = event.target.closest(".remove-product-variant-promotion-asset");
    if (removePromotionAsset) {
      const row = removePromotionAsset.closest(".content-product-variant-row");
      const selected = row?.querySelector(".product-variant-promotion-assets");
      const option = [...(selected?.options || [])].find((candidate) =>
        candidate.value === removePromotionAsset.dataset.assetId);
      if (option) option.selected = false;
      refreshPromotionAssetSelection(row);
      updateMarketplacePreviewRow(selected);
      state.isDirty = true;
      return;
    }
    const productEditorTrigger = event.target.closest("[data-product-editor-target]");
    if (productEditorTrigger) {
      focusProductEditorTarget(productEditorTrigger.dataset.productEditorTarget);
      return;
    }
    const closeEditor = event.target.closest("[data-close-variant-editor]");
    if (closeEditor) {
      syncSelectedProductVariantRows();
      if (!await saveProductSection(closeEditor)) return;
      const panel = closeEditor.closest(".product-variant-editor-panel");
      const row = closeEditor.closest(".content-product-variant-row");
      panel?.classList.add("hidden");
      if (panel) panel.dataset.editorSection = "";
      returnToVariantPreview(row);
      return;
    }
    const closeSection = event.target.closest("[data-close-variant-section]");
    if (closeSection) {
      const row = closeSection.closest(".content-product-variant-row");
      const panel = closeSection.closest(".product-variant-editor-panel");
      if (panel?.dataset.editorSection === "purchase" && row) {
        row.dataset.purchaseSetupReviewed = "true";
      }
      if (!await saveProductSection(closeSection)) return;
      closeVariantEditorAndReturn(row);
      state.isDirty = true;
      return;
    }
    const statusCheckbox = event.target.closest(".product-variant-status-checkbox");
    if (statusCheckbox) {
      const row = statusCheckbox.closest(".content-product-variant-row");
      const nextStatus = statusCheckbox.dataset.productVariantStatus || "draft";
      if (!statusCheckbox.checked) {
        statusCheckbox.checked = true;
        return;
      }
      const currentStatus = row?.querySelector(".product-variant-status")?.value || "draft";
      const variantName = row?.querySelector(".product-variant-name")?.value || "this variant";
      if (["paused", "archived"].includes(nextStatus) && nextStatus !== currentStatus &&
          !window.confirm(`Are you sure you want to mark ${variantName} as ${nextStatus}?`)) {
        statusCheckbox.checked = false;
        const currentCheckbox = row?.querySelector(
          `.product-variant-status-checkbox[data-product-variant-status="${currentStatus}"]`,
        );
        if (currentCheckbox) currentCheckbox.checked = true;
        return;
      }
      row?.querySelectorAll(".product-variant-status-checkbox").forEach((checkbox) => {
        checkbox.checked = checkbox === statusCheckbox;
      });
      const status = row?.querySelector(".product-variant-status");
      if (status) status.value = nextStatus;
      if (row) row.dataset.pendingStatus = nextStatus;
      state.isDirty = true;
      return;
    }
    const saveVariant = event.target.closest("[data-save-variant-editor]");
    if (saveVariant) {
      const row = saveVariant.closest(".content-product-variant-row");
      syncSelectedProductVariantRows();
      if (!await saveProductSection(saveVariant)) return;
      closeVariantEditorAndReturn(row);
      return;
    }
    const connectionTrigger = event.target.closest("[data-variant-connection]");
    if (connectionTrigger) {
      const row = connectionTrigger.closest(".content-product-variant-row");
      document.querySelectorAll(".product-variant-editor-panel").forEach((panel) => {
        panel.classList.add("hidden");
        panel.dataset.editorSection = "";
      });
      const connection = connectionTrigger.dataset.variantConnection;
      const productVariantId = openVariantOwnedConnections(row, connection);
      if (!productVariantId) return;
      if (connection === "blueprint") {
        const addButton = document.getElementById("addProductVariantContentLinkBtn");
        if (addButton) {
          addButton.dataset.productVariantId = productVariantId;
          addButton.disabled = !productVariantId;
        }
        const existing = productVariantContentLinksFromRows(true)
          .some((link) => link.productVariantId === productVariantId);
        if (!existing) addProductVariantContentLinkRow(productVariantId);
        filterVariantOwnedConnections(productVariantId);
        const section = document.getElementById("productVariantContentLinkRows")?.closest("details");
        if (section) {
          section.classList.remove("hidden");
          section.open = true;
        }
        document.getElementById("contentProductUnlockRows")?.closest("section")
          ?.classList.add("hidden");
        section?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (connection === "unlock") {
        const addButton = document.getElementById("addContentProductUnlockBtn");
        if (addButton) {
          addButton.dataset.productVariantId = productVariantId;
          addButton.disabled = !productVariantId;
        }
        const existing = productUnlocksFromRows(true)
          .some((grant) => grant.productVariantId === productVariantId);
        if (!existing) addProductUnlockRow(productVariantId);
        filterVariantOwnedConnections(productVariantId);
        const section = document.getElementById("contentProductUnlockRows")?.closest("section");
        section?.classList.remove("hidden");
        const blueprintSection = document.getElementById("productVariantContentLinkRows")?.closest("details");
        if (blueprintSection) blueprintSection.open = false;
        section?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    const editorTrigger = event.target.closest("[data-variant-editor]");
    if (editorTrigger) {
      const row = editorTrigger.closest(".content-product-variant-row");
      const panel = row?.querySelector(".product-variant-editor-panel");
      const section = editorTrigger.dataset.variantEditor || "admin";
      if (!row || !panel) return;
      document.getElementById("contentVariantOwnedConnections")?.classList.add("hidden");
      document.querySelectorAll(".content-product-variant-row").forEach((otherRow) => {
        if (otherRow === row) return;
        const otherPanel = otherRow.querySelector(".product-variant-editor-panel");
        otherPanel?.classList.add("hidden");
        if (otherPanel) otherPanel.dataset.editorSection = "";
      });
      const closingCurrent = !panel.classList.contains("hidden") &&
        panel.dataset.editorSection === section;
      panel.classList.toggle("hidden", closingCurrent);
      panel.dataset.editorSection = closingCurrent ? "" : section;
      const sectionTitles = {
        image: "Marketplace image",
        identity: "Product variant details",
        description: "Description overrides",
        price: "Marketplace price",
        purchase: "Purchase setup",
        visibility: "Visibility and status",
        sale: "Sale",
        promotion: "Promotion videos",
        prerequisites: "Purchase prerequisites",
      };
      const heading = panel.querySelector(".variant-editor-heading-title");
      if (heading) heading.textContent = sectionTitles[section] || "Product variant details";
      const doneFooter = panel.querySelector(".variant-editor-done-footer");
      const activeSection = panel.querySelector(
        `[data-variant-editor-section="${CSS.escape(section)}"]`,
      );
      if (doneFooter) {
        if (!closingCurrent && !["visibility", "description"].includes(section) && activeSection) {
          activeSection.appendChild(doneFooter);
          doneFooter.hidden = false;
          doneFooter.classList.remove("hidden");
        } else {
          panel.appendChild(doneFooter);
          doneFooter.hidden = true;
        }
      }
      [...panel.children].forEach((child) => {
        if (child.classList.contains("variant-editor-heading")) {
          child.hidden = closingCurrent;
          child.classList.toggle("hidden", closingCurrent);
          return;
        }
        if (child.classList.contains("variant-editor-done-footer")) {
          child.hidden = true;
          child.classList.add("hidden");
          return;
        }
        const shouldHide = !closingCurrent && section !== "admin" &&
          child.dataset.variantEditorSection !== section;
        child.hidden = shouldHide;
        child.classList.toggle("hidden", shouldHide);
      });
      if (!closingCurrent) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    const addPrerequisite = event.target.closest(".add-product-prerequisite");
    if (addPrerequisite) {
      const productRow = addPrerequisite.closest(".content-product-variant-row");
      const rows = productRow?.querySelector(".product-prerequisite-rows");
      const sourceVariantId = productRow?.querySelector(".product-variant-id")?.value ||
        productRow?.dataset.productVariantId || "";
      const existing = [...(rows?.querySelectorAll(".product-prerequisite-row") || [])].find((row) =>
        row.querySelector(".product-prerequisite-kind")?.value === "product");
      if (existing) {
        openLinkedRecordSelector(existing.querySelector(".product-prerequisite-product-picker .open-content-linked-selector"));
        return;
      }
      rows?.querySelector(".product-prerequisite-empty")?.remove();
      rows?.insertAdjacentHTML("beforeend", prerequisiteRowsMarkup([{
        requirementType: "product-variant",
        productId: "",
        productVariantId: "",
      }], sourceVariantId));
      const selectorTrigger = rows?.lastElementChild?.querySelector(
        ".product-prerequisite-product-picker .open-content-linked-selector",
      );
      if (selectorTrigger) openLinkedRecordSelector(selectorTrigger);
      return;
    }
    const chooseExternalQualification = event.target.closest(".choose-external-qualification");
    if (chooseExternalQualification) {
      const productRow = chooseExternalQualification.closest(".content-product-variant-row");
      const rows = productRow?.querySelector(".product-prerequisite-rows");
      const sourceVariantId = productRow?.querySelector(".product-variant-id")?.value ||
        productRow?.dataset.productVariantId || "";
      const existing = [...(rows?.querySelectorAll(".product-prerequisite-row") || [])].find((row) =>
        row.querySelector(".product-prerequisite-kind")?.value === "item");
      if (existing) {
        openLinkedRecordSelector(existing.querySelector(".product-prerequisite-item-picker .open-content-linked-selector"));
        return;
      }
      rows?.querySelector(".product-prerequisite-empty")?.remove();
      rows?.insertAdjacentHTML("beforeend", prerequisiteRowsMarkup([{
        requirementType: "item",
        itemId: "__pending__",
      }], sourceVariantId));
      const prerequisiteRow = rows?.lastElementChild;
      const selectorTrigger = prerequisiteRow?.querySelector(
        ".product-prerequisite-item-picker .open-content-linked-selector",
      );
      if (selectorTrigger) openLinkedRecordSelector(selectorTrigger);
      return;
    }
    const removePrerequisite = event.target.closest(".remove-product-prerequisite");
    if (removePrerequisite) {
      const rows = removePrerequisite.closest(".product-prerequisite-rows");
      removePrerequisite.closest(".product-prerequisite-row")?.remove();
      if (rows && !rows.querySelector(".product-prerequisite-row")) rows.innerHTML = prerequisiteRowsMarkup([]);
      syncSelectedProductVariantRows();
      return;
    }
    const addBundleComponent = event.target.closest(".add-product-bundle-component");
    if (addBundleComponent) {
      const sourceRow = addBundleComponent.closest(".content-product-variant-row");
      const variantId = sourceRow?.querySelector(".product-variant-id")?.value.trim() ||
        sourceRow?.dataset.productVariantId || "";
      syncSelectedProductVariantRows();
      const variants = currentProductVariants();
      const variant = variants.find((entry) => entry.variantId === variantId);
      if (!variant) return;
      if ((variant.bundleComponents || []).length) {
        const existingSelector = sourceRow.querySelector(
          ".product-bundle-component-row .open-content-linked-selector",
        );
        if (existingSelector) openLinkedRecordSelector(existingSelector);
        return;
      }
      variant.bundleComponents = [{
        bundleComponentId: `BUNDLE-COMPONENT-${Date.now()}`,
        componentProductId: "",
        componentProductVariantId: "",
        quantity: 1,
        inventoryAction: "deduct",
      }];
      setInputValue("contentProductVariants", serializeProductVariants(variants));
      renderSelectedProductVariantRows(variants);
      const refreshedRow = document.querySelector(
        `.content-product-variant-row[data-product-variant-id="${CSS.escape(variantId)}"]`,
      );
      refreshedRow?.querySelector("[data-variant-editor=\"purchase\"]")?.click();
      const bundleRows = refreshedRow?.querySelectorAll(".product-bundle-component-row") || [];
      const selector = bundleRows[bundleRows.length - 1]
        ?.querySelector(".open-content-linked-selector");
      if (selector) openLinkedRecordSelector(selector);
      state.isDirty = true;
      return;
    }
    const addManualInclusion = event.target.closest(".add-product-manual-inclusion");
    if (addManualInclusion) {
      const sourceRow = addManualInclusion.closest(".content-product-variant-row");
      const rows = sourceRow?.querySelector(".product-manual-inclusion-rows");
      rows?.querySelector(".product-manual-inclusion-empty")?.remove();
      rows?.insertAdjacentHTML("beforeend", manualInclusionsMarkup([{
        inclusionId: `INCLUSION-${Date.now()}`,
        name: "",
        quantity: 1,
      }]));
      rows?.lastElementChild?.querySelector(".product-manual-inclusion-name")?.focus();
      state.isDirty = true;
      return;
    }
    const importBlueprintInclusions = event.target.closest(".import-blueprint-inclusions");
    if (importBlueprintInclusions) {
      const sourceRow = importBlueprintInclusions.closest(".content-product-variant-row");
      const variantId = sourceRow?.querySelector(".product-variant-id")?.value.trim() ||
        sourceRow?.dataset.productVariantId || "";
      const imported = blueprintInclusionsForProductVariant(variantId);
      if (!imported.length) {
        showToast("Connect a populated Manufacturing or Workshop Operations Blueprint first.", "error");
        return;
      }
      const rows = sourceRow.querySelector(".product-manual-inclusion-rows");
      const existing = [...rows.querySelectorAll(".product-manual-inclusion-row")].map((row) => ({
        inclusionId: row.dataset.inclusionId,
        name: row.querySelector(".product-manual-inclusion-name")?.value.trim() || "",
        quantity: Number(row.querySelector(".product-manual-inclusion-quantity")?.value || 1),
        sourceBlueprintId: row.dataset.sourceBlueprintId || "",
        sourceComponentId: row.dataset.sourceComponentId || "",
      })).filter((entry) => entry.name);
      const importedKeys = new Set(imported.map((entry) =>
        `${entry.sourceBlueprintId}:${entry.sourceComponentId}`));
      rows.innerHTML = manualInclusionsMarkup([
        ...existing.filter((entry) => !importedKeys.has(
          `${entry.sourceBlueprintId}:${entry.sourceComponentId}`,
        )),
        ...imported,
      ]);
      syncSelectedProductVariantRows();
      updateMarketplacePreviewRow(sourceRow);
      state.isDirty = true;
      showToast(`${imported.length} Blueprint inclusion${imported.length === 1 ? "" : "s"} imported.`, "success");
      return;
    }
    const removeBundleComponent = event.target.closest(".remove-product-bundle-component");
    if (removeBundleComponent) {
      const rows = removeBundleComponent.closest(".product-bundle-component-rows");
      removeBundleComponent.closest(".product-bundle-component-row")?.remove();
      if (rows && !rows.querySelector(".product-bundle-component-row")) {
        rows.innerHTML = bundleComponentsMarkup([]);
      }
      syncSelectedProductVariantRows();
      state.isDirty = true;
      return;
    }
    const removeManualInclusion = event.target.closest(".remove-product-manual-inclusion");
    if (removeManualInclusion) {
      const rows = removeManualInclusion.closest(".product-manual-inclusion-rows");
      removeManualInclusion.closest(".product-manual-inclusion-row")?.remove();
      if (rows && !rows.querySelector(".product-manual-inclusion-row")) {
        rows.innerHTML = manualInclusionsMarkup([]);
      }
      syncSelectedProductVariantRows();
      state.isDirty = true;
      return;
    }
  });
  document.getElementById("contentProductVariantRows")?.addEventListener("input", (event) => {
    syncSelectedProductVariantRows();
    updateMarketplacePreviewRow(event.target);
    renderMarketplaceTileControls();
    state.isDirty = true;
  });
  document.getElementById("contentProductVariantRows")?.addEventListener("change", (event) => {
    if (event.target.classList.contains("product-variant-content-variant")) {
      const reviewed = Boolean(event.target.value);
      event.target.classList.toggle("border-purple-500", !reviewed);
      event.target.classList.toggle("bg-purple-950/40", !reviewed);
      event.target.classList.toggle("ring-1", !reviewed);
      event.target.classList.toggle("ring-purple-500", !reviewed);
      event.target.classList.toggle("border-[#407471]", reviewed);
      event.target.classList.toggle("bg-gray-950", reviewed);
    }
    if (event.target.classList.contains("product-prerequisite-kind")) {
      const row = event.target.closest(".product-prerequisite-row");
      const target = row?.querySelector(".product-prerequisite-target");
      const isItem = event.target.value === "item";
      const productPicker = row?.querySelector(".product-prerequisite-product-picker");
      const itemPicker = row?.querySelector(".product-prerequisite-item-picker");
      const productSelect = row?.querySelector(".product-prerequisite-product-selector");
      const itemSelect = row?.querySelector(".product-prerequisite-item-selector");
      const variant = row?.querySelector(".product-prerequisite-variant");
      if (target) target.value = "";
      if (productSelect) productSelect.value = "";
      if (itemSelect) itemSelect.value = "";
      refreshLinkedTemplatePickerLabel(productSelect);
      refreshLinkedTemplatePickerLabel(itemSelect);
      productPicker?.classList.add("hidden");
      itemPicker?.classList.add("hidden");
      if (variant) {
        variant.disabled = isItem;
        variant.innerHTML = isItem
          ? "<option value=\"\">Manual verification will be added later</option>"
          : "<option value=\"\">Choose required variant</option>";
      }
      const trigger = (isItem ? itemPicker : productPicker)
        ?.querySelector(".open-content-linked-selector");
      setTimeout(() => trigger?.click(), 0);
    }
    if (event.target.classList.contains("product-prerequisite-product-selector") ||
        event.target.classList.contains("product-prerequisite-item-selector")) {
      const row = event.target.closest(".product-prerequisite-row");
      const isItem = event.target.classList.contains("product-prerequisite-item-selector");
      const target = row?.querySelector(".product-prerequisite-target");
      const kind = row?.querySelector(".product-prerequisite-kind");
      const variant = row?.querySelector(".product-prerequisite-variant");
      const other = row?.querySelector(isItem
        ? ".product-prerequisite-product-selector"
        : ".product-prerequisite-item-selector");
      if (kind) kind.value = isItem ? "item" : "product";
      if (target) {
        if (![...target.options].some((option) => option.value === event.target.value)) {
          target.add(new Option(event.target.value, event.target.value));
        }
        target.value = event.target.value || "";
      }
      if (other) {
        other.value = "";
        refreshLinkedTemplatePickerLabel(other);
      }
      row?.querySelector(".product-prerequisite-product-picker")
        ?.classList.toggle("hidden", isItem);
      row?.querySelector(".product-prerequisite-item-picker")
        ?.classList.toggle("hidden", !isItem);
      if (variant) {
        const sourceVariantId = row?.closest(".content-product-variant-row")
          ?.querySelector(".product-variant-id")?.value || "";
        variant.disabled = isItem;
        variant.innerHTML = isItem
          ? "<option value=\"\">Manual verification will be added later</option>"
          : `<option value="">Choose required variant</option>${prerequisiteVariantOptions(
            event.target.value,
            "",
            sourceVariantId,
          )}`;
      }
    }
    if (event.target.classList.contains("product-bundle-component-product")) {
      const row = event.target.closest(".product-bundle-component-row");
      const variant = row?.querySelector(".product-bundle-component-variant");
      if (variant) {
        variant.innerHTML = `<option value="">Choose exact Product variant</option>${bundleVariantOptions(event.target.value)}`;
      }
    }
    syncSelectedProductVariantRows();
    updateMarketplacePreviewRow(event.target);
    renderMarketplaceTileControls();
    renderProductVariantContentLinkRows(productVariantContentLinksFromRows(true));
    state.isDirty = true;
  });
  document.getElementById("addContentEntityVariantBtn")?.addEventListener("click", addEntityVariantRow);
  document.getElementById("contentEntityVariantRows")?.addEventListener("click", (event) => {
    handleTemplateGuidedFieldsClick(event);
    const addReference = event.target.closest(".add-content-entity-variant-reference");
    if (addReference) {
      const rows = addReference.closest(".content-entity-variant-row")
        ?.querySelector(".content-entity-variant-reference-rows");
      rows?.insertAdjacentHTML("beforeend", variantReferenceRowMarkup());
      rows?.lastElementChild?.querySelector("input")?.focus();
      state.isDirty = true;
      return;
    }
    const removeReference = event.target.closest(".remove-content-entity-variant-reference");
    if (removeReference) {
      const rows = removeReference.closest(".content-entity-variant-reference-rows");
      const entries = rows?.querySelectorAll(".content-entity-variant-reference-row") || [];
      if (entries.length > 1) removeReference.closest(".content-entity-variant-reference-row")?.remove();
      else {
        const input = entries[0]?.querySelector("input");
        if (input) input.value = "";
      }
      state.isDirty = true;
      return;
    }
    const editTemplate = event.target.closest(".edit-entity-variant-template");
    const createTemplate = event.target.closest(".create-entity-variant-template");
    if (editTemplate || createTemplate) {
      const row = event.target.closest(".content-entity-variant-row");
      state.templateTargetVariantId = row?.dataset.entityVariantId || "";
      const selectedId = row?.querySelector(".content-entity-variant-template")?.value || "";
      setSelectValue("contentTemplate", selectedId);
      if (editTemplate) openTemplateEditorForSelectedTemplate();
      else openTemplateCreatorForCurrentRecord();
      return;
    }
    const addRecipe = event.target.closest(".add-blueprint-variant-recipe-row");
    if (addRecipe) {
      const variantRows = [...document.querySelectorAll(".content-entity-variant-row")];
      const index = variantRows.indexOf(addRecipe.closest(".content-entity-variant-row"));
      const variants = entityVariantsFromBuilder();
      variants[index].linkedItemComponents.push({
        componentId: `COMPONENT-${variants[index].linkedItemComponents.length + 1}`,
        itemId: "",
        itemVariantId: "",
        productId: "",
        productVariantId: "",
        quantity: 1,
        unit: "each",
      });
      renderEntityVariantRows(variants);
      return;
    }
    const removeRecipe = event.target.closest(".remove-blueprint-variant-recipe-row");
    if (removeRecipe) {
      removeRecipe.closest(".blueprint-variant-recipe-row")?.remove();
      updateBlueprintVariantRecipeTotals();
      updateConnectedProductCostPreview();
      state.isDirty = true;
      return;
    }
    const remove = event.target.closest(".remove-content-entity-variant");
    if (!remove) return;
    const rows = [...document.querySelectorAll(".content-entity-variant-row")];
    const index = rows.indexOf(remove.closest(".content-entity-variant-row"));
    const variants = entityVariantsFromBuilder();
    variants.splice(index, 1);
    renderEntityVariantRows(variants);
    renderBuilderSummaries();
  });
  document.getElementById("contentEntityVariantRows")?.addEventListener("input", (event) => {
    const row = event.target.closest(".content-entity-variant-row");
    if (row && event.target.classList.contains("content-entity-variant-name")) {
      const output = row.querySelector(".variant-summary-name");
      if (output) output.textContent = event.target.value || "Unnamed variant";
    }
    if (row && event.target.classList.contains("content-entity-variant-owner")) {
      const output = row.querySelector(".variant-summary-owner");
      if (output) output.textContent = event.target.value || "Recovery Tools";
    }
    updateBlueprintVariantRecipeTotals();
    updateConnectedProductCostPreview();
    renderBuilderSummaries();
  });
  document.getElementById("contentEntityVariantRows")?.addEventListener("toggle", (event) => {
    const row = event.target.closest(".content-entity-variant-row");
    if (!row) return;
    const chevron = row.querySelector(".content-entity-variant-chevron");
    if (chevron) chevron.textContent = row.open ? "−" : "+";
  }, true);
  document.getElementById("contentEntityVariantRows")?.addEventListener("change", (event) => {
    if (event.target.classList.contains("content-template-linked-select")) {
      const selectedAsset = (state.records.assets || []).find((asset) =>
        (asset.assetId || asset.id) === event.target.value);
      if (normalizedText(selectedAsset?.assetType || selectedAsset?.type) === "image") {
        populateProductVariantsFromEntity();
      }
    }
    if (event.target.classList.contains("blueprint-variant-recipe-source-type")) {
      const recipeRow = event.target.closest(".blueprint-variant-recipe-row");
      const sourceSelect = recipeRow?.querySelector(".blueprint-variant-recipe-item");
      const variantSelect = recipeRow?.querySelector(".blueprint-variant-recipe-item-variant");
      if (sourceSelect) sourceSelect.innerHTML = workshopOperationsSourceOptions(event.target.value);
      if (variantSelect) variantSelect.innerHTML = workshopOperationsVariantOptions(event.target.value, "");
    }
    if (event.target.classList.contains("blueprint-variant-recipe-item")) {
      const recipeRow = event.target.closest(".blueprint-variant-recipe-row");
      const variantSelect = recipeRow?.querySelector(".blueprint-variant-recipe-item-variant");
      if (variantSelect) {
        const sourceType = recipeRow?.querySelector(".blueprint-variant-recipe-source-type")?.value;
        if (sourceType) {
          variantSelect.innerHTML = workshopOperationsVariantOptions(sourceType, event.target.value);
        } else {
          variantSelect.innerHTML = blueprintRecipeVariantOptions(event.target.value);
          const variants = itemVariantsForRecipe(event.target.value);
          if (variants.length === 1) variantSelect.value = variants[0].entityVariantId || "";
        }
      }
    }
    if (event.target.classList.contains("content-entity-variant-template")) {
      const rows = [...document.querySelectorAll(".content-entity-variant-row")];
      const changedRow = event.target.closest(".content-entity-variant-row");
      const index = rows.indexOf(changedRow);
      const variants = entityVariantsFromBuilder();
      variants[index].templateVariantId = event.target.value;
      const definition = templateDefinitions(currentRecordType(), document.getElementById("contentType")?.value)
        .find((candidate) => candidate.id === event.target.value);
      variants[index].templateId = definition?.templateId || "";
      variants[index].templateFieldValues = {};
      if (index === 0) {
        setSelectValue("contentTemplate", event.target.value);
        applyTemplateDefaults();
      }
      renderEntityVariantRows(variants);
    }
    updateBlueprintVariantRecipeTotals();
    updateConnectedProductCostPreview();
    renderBuilderSummaries();
  });
  document.getElementById("contentVariantConnectionRows")?.addEventListener("input", (event) => {
    if (event.target.classList.contains("variant-purchase-url")) {
      updateVariantOrderingButton(event.target.closest(".content-variant-connection-row"));
    }
    state.isDirty = true;
  });
  document.getElementById("contentVariantConnectionRows")?.addEventListener("change", (event) => {
    if (event.target.classList.contains("variant-supplier-id")) {
      updateVariantOrderingButton(event.target.closest(".content-variant-connection-row"));
    }
    state.isDirty = true;
  });
  document.getElementById("contentVariantConnectionRows")?.addEventListener("click", (event) => {
    const button = event.target.closest(".open-variant-ordering-page");
    if (!button || button.disabled) return;
    const url = button.dataset.orderingUrl || "";
    if (!externalUrl(url)) {
      showToast("Add a complete ordering URL beginning with http:// or https://.", "error");
      return;
    }
    window.open(externalUrl(url), "_blank", "noopener,noreferrer");
  });
  document.getElementById("addContentProductUnlockBtn")?.addEventListener("click", (event) => {
    const ownerVariantId = event.currentTarget.dataset.productVariantId || "";
    const existing = [...document.querySelectorAll(".content-product-unlock-row")].find((row) =>
      row.querySelector(".content-product-unlock-variant")?.value === ownerVariantId);
    if (existing) {
      openLinkedRecordSelector(existing.querySelector(".open-content-linked-selector"));
      return;
    }
    addProductUnlockRow(ownerVariantId);
    const created = [...document.querySelectorAll(".content-product-unlock-row")].find((row) =>
      row.querySelector(".content-product-unlock-variant")?.value === ownerVariantId);
    openLinkedRecordSelector(created?.querySelector(".open-content-linked-selector"));
  });
  document.getElementById("contentProductUnlockRows")?.addEventListener("change", (event) => {
    if (event.target.classList.contains("content-product-unlock-variant")) {
      filterVariantOwnedConnections(
        document.getElementById("contentVariantOwnedConnections")?.dataset.activeProductVariantId || "",
      );
      state.isDirty = true;
      refreshMarketplacePreviews();
      return;
    }
    if (event.target.classList.contains("content-product-unlock-duration-type")) {
      const row = event.target.closest(".content-product-unlock-row");
      const amount = row?.querySelector(".content-product-unlock-duration-value");
      const durationType = event.target.value || "";
      if (amount) {
        amount.disabled = !durationType;
        amount.placeholder = durationType ? `Number of ${durationType}` : "Select a duration first";
        if (!durationType) amount.value = "";
        else amount.focus();
      }
      state.isDirty = true;
      return;
    }
    if (!event.target.classList.contains("content-product-unlock-type") &&
        !event.target.classList.contains("content-product-unlock-target")) return;
    const allRows = [...document.querySelectorAll(".content-product-unlock-row")];
    const index = allRows.indexOf(event.target.closest(".content-product-unlock-row"));
    const grants = productUnlocksFromRows(true);
    if (event.target.classList.contains("content-product-unlock-type")) {
      grants[index].accessEntityType = event.target.value;
      grants[index].accessEntityId = "";
    }
    grants[index].accessEntityVariantId = "";
    renderProductUnlockRows(grants);
    refreshMarketplacePreviews();
  });
  document.getElementById("contentProductUnlockRows")?.addEventListener("click", (event) => {
    const remove = event.target.closest(".remove-content-product-unlock");
    if (!remove) return;
    const allRows = [...document.querySelectorAll(".content-product-unlock-row")];
    const index = allRows.indexOf(remove.closest(".content-product-unlock-row"));
    const grants = productUnlocksFromRows(true);
    grants.splice(index, 1);
    renderProductUnlockRows(grants);
    refreshMarketplacePreviews();
  });
  document.getElementById("closeContentProductDrawerBtn")?.addEventListener("click", closeContentProductDrawer);
  document.getElementById("toggleContentProductHelpBtn")?.addEventListener("click", () => {
    const button = document.getElementById("toggleContentProductHelpBtn");
    const panel = document.getElementById("contentProductHelpPanel");
    const opening = panel?.classList.contains("hidden");
    panel?.classList.toggle("hidden", !opening);
    button?.setAttribute("aria-expanded", String(opening));
    if (button) button.textContent = opening ? "Hide help" : "Help";
  });
  document.getElementById("applyContentProductBtn")?.addEventListener(
    "click",
    saveProductDetailsFromDrawer,
  );
  document.getElementById("contentProductDrawer")?.addEventListener("click", (event) => {
    if (event.target.id === "contentProductDrawer") closeContentProductDrawer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("contentProductDrawer")?.classList.contains("hidden")) {
      closeContentProductDrawer();
    }
  });
  document.getElementById("contentExistingProductId")?.addEventListener("change", (event) => {
    setInputValue("contentProductId", event.target.value);
    updateProductRelationStatus(event.target.value ? { productId: event.target.value } : null);
    state.isDirty = true;
    renderBuilderSummaries();
  });
  document.getElementById("unlinkContentProductBtn")?.addEventListener("click", () => {
    const productId = document.getElementById("contentProductId")?.value ||
      state.editingRecord?.productId || "";
    if (!productId) return;
    const confirmed = window.confirm(
      "Unlink this Product? The Product and content record will both be preserved.",
    );
    if (!confirmed) return;
    setInputValue("contentUnlinkProductId", productId);
    setCheckboxValue("contentIsShopProduct", false);
    setInputValue("contentProductId", "");
    updateProductRelationStatus(null);
    state.isDirty = true;
    showBuilderStep(state.currentStep);
    renderBuilderSummaries();
  });
  document.getElementById("contentWebsiteVisible")?.addEventListener("change", updateSaveWorkflow);
  [
    "contentUnlocksAccess",
    "contentRequiresCalendar",
    "contentRequiresSessionTime",
    "contentTracksSeats",
    "contentIssuesCertificate",
    "contentRequiresShipping",
    "contentInventoryTracked",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      applyTemplateDrivenItemFields();
      updateProductPhysicalFields();
      updateItemInventoryFields();
    });
  });
  document.getElementById("templateRecordType")?.addEventListener("change", updateTemplateManagerTypeOptions);
  document.getElementById("templateAppliesTo")?.addEventListener("change", updateTemplateManagerTypeOptions);
  document.getElementById("templateName")?.addEventListener("input", updateGeneratedTemplateId);
  document.getElementById("addTemplateVariantBtn")?.addEventListener("click", addTemplateVariant);
  document.getElementById("templateFormNextBtn")?.addEventListener(
    "click",
    continueToTemplateFields,
  );
  document.getElementById("templateFormBackBtn")?.addEventListener(
    "click",
    () => showTemplateFormPart(1),
  );
  document.getElementById("templateFormSaveBtn")?.addEventListener("click", saveTemplate);
  document.getElementById("templateVariantRows")?.addEventListener("input", handleTemplateVariantRowsInput);
  document.getElementById("templateVariantRows")?.addEventListener("change", handleTemplateVariantRowsChange);
  document.getElementById("templateVariantRows")?.addEventListener("click", handleTemplateVariantRowsClick);
  document.getElementById("refreshContentBuilderBtn")?.addEventListener("click", () => {
    loadData().catch((err) => {
      console.error("Failed to refresh content builder:", err);
      showToast("Failed to refresh content builder.", "error");
    });
  });

  document.getElementById("contentBuilderForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    buildAndSavePayload(false);
  });
  document.getElementById("saveContentBuilderBtn")?.addEventListener("click", () => {
    buildAndSavePayload(false);
  });
  document.getElementById("contentReviewEntityStatus")?.addEventListener("change", (event) => {
    setInputValue("contentStatus", event.target.value || "draft");
    applyLifecycleStatusHighlight(event.target);
    state.isDirty = true;
  });
  document.getElementById("contentVariantReviewRows")?.addEventListener("change", (event) => {
    const status = event.target.closest(".content-entity-variant-status");
    if (!status) return;
    applyLifecycleStatusHighlight(status);
    const variantId = status.closest("[data-entity-variant-id]")?.dataset.entityVariantId || "";
    const actionStatus = [...document.querySelectorAll(".content-variant-action-row")]
      .find((row) => row.dataset.entityVariantId === variantId)
      ?.querySelector(".content-entity-variant-status");
    if (actionStatus) {
      actionStatus.value = status.value;
      applyLifecycleStatusHighlight(actionStatus);
    }
    state.isDirty = true;
  });
  document.getElementById("contentVariantReviewRows")?.addEventListener("click", (event) => {
    if (event.target.closest(".content-entity-variant-status")) event.stopPropagation();
  });

  document.getElementById("saveContinueContentBtn")?.addEventListener("click", () => {
    buildAndSavePayload(false, "active");
  });

  document.getElementById("approveContentBuilderBtn")?.addEventListener("click", () => {
    buildAndSavePayload(false, "approve");
  });

  document.getElementById("pauseContentBuilderBtn")?.addEventListener("click", () => {
    buildAndSavePayload(false, "pause");
  });

  document.getElementById("archiveContentBuilderBtn")?.addEventListener("click", () => {
    buildAndSavePayload(false, "archive");
  });

  document.getElementById("confirmDuplicateContentBtn")?.addEventListener("click", () => {
    const payload = state.pendingPayload;
    if (!payload) {
      buildAndSavePayload(true);
      return;
    }
    savePayload({ ...payload, confirmDuplicate: true }, state.pendingAction || "save");
  });
  document.getElementById("contentTemplateForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!document.getElementById("templateFormPartTwo")?.classList.contains("hidden")) {
      saveTemplate();
      return;
    }
    continueToTemplateFields();
  });

  window.addEventListener("popstate", () => {
    if (document.getElementById("adminContentBuilderSection")?.classList.contains("hidden")) return;
    applyBuilderRoute();
  });

  try {
    await loadData();
    applyBuilderRoute();
  } catch (err) {
    console.error("Failed to load content builder:", err);
    showToast("Failed to load content builder.", "error");
  }
}
