import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { functions, storage } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";

const getContentBuilderData = httpsCallable(functions, "getContentBuilderData");
const createContentBuilderRecord = httpsCallable(functions, "createContentBuilderRecord");
const upsertContentBuilderTemplate = httpsCallable(functions, "upsertContentBuilderTemplate");
const updateContentControlRecord = httpsCallable(functions, "updateContentControlRecord");
const upsertAdminAsset = httpsCallable(functions, "upsertAdminAsset");
let assetDrawerField = null;
let assetDrawerFile = null;
let resumeAssetSaveAfterFileSelection = false;

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
  item: ["1. Details", "2. Build", "3. Connections", "4. Review", "5. Actions"],
  blueprint: ["1. Details", "2. Build", "3. Connections", "4. Review", "5. Actions"],
  plan: ["1. Details", "2. Build", "3. Connections", "4. Review", "5. Actions"],
  campaign: ["1. Details", "2. Build", "3. Connections", "4. Review", "5. Actions"],
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

function updateConnectedProductCostPreview() {
  let cost = 0;
  const blueprintId = document.getElementById("contentProductBlueprintId")?.value || "";
  const costBlueprint = (state.records.blueprints || []).find((blueprint) => blueprint.id === blueprintId);
  if (costBlueprint) cost = Number(costBlueprint.estimatedUnitCost ?? 0) || 0;
  else if (currentRecordType() === "blueprint") cost = updateBlueprintEstimatedCost();
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

  sections.item?.classList.toggle("hidden", recordType === "item");
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

function knownContentTags() {
  const categoryId = document.getElementById("contentTagCategoryFilter")?.value || "";
  const allRecords = Object.values(state.records || {}).flatMap((records) => records || []);
  return uniqueValues([
    ...(state.options.tagOptions || [])
      .filter((tag) => !categoryId || tag.categoryId === categoryId)
      .map((tag) => tag.name || tag.id),
    ...(!categoryId ? allRecords.flatMap((record) => record.tags || []) : []),
  ])
    .sort((left, right) => left.localeCompare(right));
}

function tagRowMarkup(value = "") {
  const selectedValue = String(value || "").trim();
  const knownTags = uniqueValues([...knownContentTags(), selectedValue]).filter(Boolean);
  const selectedKey = selectedValue.toLowerCase();
  const isKnownTag = knownTags.some((tag) => tag.toLowerCase() === selectedKey);
  const customValue = selectedValue && !isKnownTag ? selectedValue : "";
  const options = [
    `<option value="">Choose existing tag</option>`,
    ...knownTags.map((tag) => {
      const selected = isKnownTag && tag.toLowerCase() === selectedKey ? " selected" : "";
      return `<option value="${escapeHTML(tag)}"${selected}>${escapeHTML(tag)}</option>`;
    }),
    `<option value="__new__"${customValue ? " selected" : ""}>Add new tag...</option>`,
  ].join("");

  return `
    <div class="content-tag-row grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <select class="content-tag-select rounded bg-gray-800 px-3 py-2 text-white">
        ${options}
      </select>
      <input
        class="content-tag-new rounded bg-gray-800 px-3 py-2 text-white ${customValue ? "" : "hidden"}"
        placeholder="New tag"
        value="${escapeHTML(customValue)}"
      >
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
    if (selected === "__new__") return row.querySelector(".content-tag-new")?.value || "";
    return selected;
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

function handleTagRowsChange(event) {
  const row = event.target.closest(".content-tag-row");
  if (!row) return;

  if (event.target.classList.contains("content-tag-select")) {
    const input = row.querySelector(".content-tag-new");
    if (input) {
      input.classList.toggle("hidden", event.target.value !== "__new__");
      if (event.target.value !== "__new__") input.value = "";
    }
  }

  syncTagInput();
}

function handleTagRowsClick(event) {
  if (!event.target.classList.contains("content-tag-remove")) return;
  const rows = document.getElementById("contentTagRows");
  const row = event.target.closest(".content-tag-row");
  if (!rows || !row) return;

  if (rows.querySelectorAll(".content-tag-row").length <= 1) {
    const select = row.querySelector(".content-tag-select");
    const input = row.querySelector(".content-tag-new");
    if (select) select.value = "";
    if (input) {
      input.value = "";
      input.classList.add("hidden");
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
  return String(value || "")
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
      };
    });
}

function serializeProductVariants(variants = []) {
  return variants.map((variant) => [
    variant.variantId || variant.id || "",
    variant.name || "",
    variant.colour || "",
    variant.size || "",
    variant.sku || "",
    variant.priceOverride ?? "",
    variant.stock ?? 0,
    variant.status || "active",
    variant.contentVariantId || "",
    variant.calendarBookingReference || "",
    variant.seatCapacity ?? "",
    variant.eventStartAt || "",
    variant.eventEndAt || "",
    variant.eventLocation || "",
    variant.instructor || "",
    variant.deliveryMode || "",
    variant.physicalFulfilment || "",
  ].join(" | ")).join("\n");
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
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
  ].join("");
  if (options.some((record) => record.id === current)) select.value = current;
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

function variantTemplateFieldsMarkup(template, recordType, variant = {}) {
  if (!template) return "<p class=\"mt-3 text-xs text-gray-400\">Choose a template to display this variant's fields.</p>";
  const defaults = template.defaults || {};
  const common = recordType === "plan" ? `
    <div class="mt-3 grid gap-3 md:grid-cols-2">
      <label class="block text-xs text-gray-300">Size / variant label
        <input class="content-entity-variant-size-label mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
          value="${escapeHTML(variant.sizeLabel ?? defaults.sizeLabel ?? "")}">
      </label>
    </div>` : "";
  return `${common}${renderTemplateCustomFields(template)}`;
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
    <section class="mt-3 rounded border border-gray-700 bg-gray-950/50 p-3">
      <h5 class="font-medium text-white">Item stock</h5>
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
    return `<details class="rounded border border-gray-700 bg-gray-900/60" ${index === 0 ? "open" : ""}>
      <summary class="cursor-pointer bg-gray-800/70 p-3 text-sm text-white">${escapeHTML(variant.name || `Variant ${index + 1}`)} · ${escapeHTML(template ? templateOptionLabel(template) : "No template")} · ${escapeHTML(variant.owner || "Recovery Tools")}</summary>
      <div class="p-3">
      <dl class="mt-2 grid gap-2 text-xs text-gray-300 sm:grid-cols-2">
        <div><dt class="text-gray-500">Template</dt><dd>${escapeHTML(templateOptionLabel(template))}</dd></div>
        <div><dt class="text-gray-500">Status</dt><dd>${escapeHTML(variant.status || "draft")}</dd></div>
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
          <select class="content-entity-variant-status mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">${compactSelectOptions(["draft", "review", "active", "paused", "archived"], variant.status || "draft")}</select>
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

function blueprintVariantRecipeMarkup(variant) {
  if (currentRecordType() !== "blueprint") return "";
  const components = Array.isArray(variant.linkedItemComponents) ? variant.linkedItemComponents : [];
  const rows = components.map((component) => `
    <div class="blueprint-variant-recipe-row grid gap-2 md:grid-cols-[1fr_8rem_auto]">
      <select class="blueprint-variant-recipe-item rounded bg-gray-800 px-2 py-2 text-white">
        ${blueprintRecipeItemOptions(component.itemId)}
      </select>
      <input class="blueprint-variant-recipe-quantity rounded bg-gray-800 px-2 py-2 text-white"
        type="number" min="0" step="0.01" value="${escapeHTML(component.quantity ?? 1)}" aria-label="Quantity">
      <button type="button" class="remove-blueprint-variant-recipe-row rounded border border-red-700 px-3 py-1 text-red-200">Remove</button>
    </div>`).join("");
  const total = components.reduce((sum, component) => sum + Number(component.estimatedCost ?? 0), 0);
  return `
    <details class="mt-3 rounded border border-gray-700 p-3">
      <summary class="cursor-pointer font-semibold text-white">Variant-specific Item recipe</summary>
      <div class="blueprint-variant-recipe-rows mt-3 space-y-2">${rows || "<p class=\"text-xs text-gray-400\">No variant-specific Items yet.</p>"}</div>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" class="add-blueprint-variant-recipe-row rounded border border-[#407471] px-3 py-1 text-xs text-[#9edbd7]">Add Item</button>
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
        <button type="button" class="create-entity-variant-template rounded border border-[#407471] px-3 py-1 text-xs text-[#9edbd7]">Create new template</button>
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
    const actionRow = document.querySelector(`.content-variant-action-row[data-entity-variant-id="${CSS.escape(variantId)}"]`);
    const connectionRow = document.querySelector(`.content-variant-connection-row[data-entity-variant-id="${CSS.escape(variantId)}"]`);
    const templateVariantId = row.querySelector(".content-entity-variant-template")?.value || "";
    const definition = templateDefinitions(currentRecordType(), document.getElementById("contentType")?.value)
      .find((candidate) => candidate.id === templateVariantId);
    const recipeComponents = [...row.querySelectorAll(".blueprint-variant-recipe-row")].map((recipeRow) => {
      const itemId = recipeRow.querySelector(".blueprint-variant-recipe-item")?.value || "";
      const item = (state.records.items || []).find((record) => record.id === itemId);
      const quantity = optionalNumberFromElement(
        recipeRow.querySelector(".blueprint-variant-recipe-quantity"),
      ) ?? 0;
      const unitCost = Number(item?.itemUnitCost ?? 0) || 0;
      return { itemId, quantity, unitCost, estimatedCost: quantity * unitCost };
    }).filter((component) => component.itemId && component.quantity > 0);
    const references = uniqueValues([...row.querySelectorAll(".content-entity-variant-reference")]
      .map((input) => input.value));
    return {
      entityVariantId: variantId,
      name,
      templateId: definition?.templateId || "",
      templateVariantId,
      durationMinutes: null,
      sizeLabel: row.querySelector(".content-entity-variant-size-label")?.value.trim() || "",
      reference: references[0] || "",
      references,
      owner: row.querySelector(".content-entity-variant-owner")?.value.trim() || "",
      ownerType: row.querySelector(".content-entity-variant-owner-type")?.value || "admin",
      templateFieldValues: templateFieldValuesFromBuilder({ root: row }),
      behaviourDefaults: templateBehaviourDefaults(definition),
      shopEnabled: connectionRow?.querySelector(".variant-add-to-shop")?.checked === true,
      libraryVisible: connectionRow?.querySelector(".variant-add-to-library")?.checked === true,
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
      const itemId = recipeRow.querySelector(".blueprint-variant-recipe-item")?.value || "";
      const item = (state.records.items || []).find((record) => record.id === itemId);
      const quantity = optionalNumberFromElement(
        recipeRow.querySelector(".blueprint-variant-recipe-quantity"),
      ) ?? 0;
      total += quantity * (Number(item?.itemUnitCost ?? 0) || 0);
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

function populateProductVariantsFromEntity() {
  const input = document.getElementById("contentProductVariants");
  if (!input) return;
  const current = parseProductVariants(input.value);
  const entityVariants = entityVariantsFromBuilder();
  const entityVariantIds = new Set(entityVariants.map((variant) => variant.entityVariantId));
  const selected = entityVariants.filter((variant) => variant.shopEnabled === true);
  const selectedIds = new Set(selected.map((variant) => variant.entityVariantId));
  const retained = current.filter((variant) =>
    !entityVariantIds.has(variant.contentVariantId) || selectedIds.has(variant.contentVariantId));
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
      stock: entityVariant.stockQty ?? 0,
      status: "draft",
      contentVariantId: entityVariant.entityVariantId,
    };
    retained.push(generated);
    usedVariantIds.add(generated.variantId);
  });

  input.value = serializeProductVariants(retained);
  renderSelectedProductVariantRows(retained, selected);
  renderProductVariantContentLinkRows(productVariantContentLinksFromRows(true));
  updateProductPhysicalFields();
}

function renderSelectedProductVariantRows(
  productVariants = currentProductVariants(),
  selectedEntityVariants = entityVariantsFromBuilder().filter((variant) => variant.shopEnabled === true),
) {
  const container = document.getElementById("contentProductVariantRows");
  if (!container) return;
  const summary = document.getElementById("contentProductVariantSummary");
  if (!selectedEntityVariants.length) {
    if (summary) summary.textContent = "No variants selected for Shop.";
    container.innerHTML = "<p class=\"text-sm text-gray-400\">No variants are selected for Shop. Close this drawer and select at least one variant on the Connections page.</p>";
    return;
  }
  if (summary) {
    summary.textContent = `${selectedEntityVariants.length} selected variant${selectedEntityVariants.length === 1 ? "" : "s"}`;
  }
  container.innerHTML = selectedEntityVariants.map((entityVariant, index) => {
    const productVariant = productVariants.find((variant) =>
      variant.contentVariantId === entityVariant.entityVariantId) || {};
    return `
      <details class="content-product-variant-row overflow-hidden rounded-lg border border-gray-600 border-l-4 border-l-[#407471] bg-gray-900/80" ${index === 0 ? "open" : ""} data-content-variant-id="${escapeHTML(entityVariant.entityVariantId)}">
        <summary class="cursor-pointer bg-gray-800/90 p-3 hover:bg-gray-800">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <span class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#407471] bg-[#153b38] font-semibold text-[#bce7e4]">${index + 1}</span>
              <div>
                <p class="font-semibold text-white">${escapeHTML(productVariant.name || entityVariant.name || entityVariant.entityVariantId)}</p>
                <p class="text-xs text-gray-400">${index === 0 ? "Primary Product variant" : `Additional Product variant ${index + 1}`}</p>
              </div>
            </div>
            <span class="rounded bg-gray-900 px-2 py-1 text-xs text-gray-300">${escapeHTML(productVariant.status || "draft")}</span>
          </div>
        </summary>
        <div class="grid gap-3 border-t border-gray-700 bg-gray-950/30 p-4 md:grid-cols-2 xl:grid-cols-4">
          <label class="block text-sm">Product variant ID
            <input class="product-variant-id mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(productVariant.variantId || "")}">
          </label>
          <label class="block text-sm">Selling name
            <input class="product-variant-name mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(productVariant.name || entityVariant.name || "")}">
          </label>
          <label class="block text-sm">SKU
            <input class="product-variant-sku mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(productVariant.sku || "")}" placeholder="Auto-filled if blank">
          </label>
          <label class="block text-sm">Status
            <select class="product-variant-status mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
              ${compactSelectOptions(["draft", "active", "paused", "archived"], productVariant.status || "draft")}
            </select>
          </label>
          <label class="block text-sm">Colour
            <input class="product-variant-colour mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(productVariant.colour || "")}">
          </label>
          <label class="block text-sm">Size / weight
            <input class="product-variant-size mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" value="${escapeHTML(productVariant.size || entityVariant.sizeLabel || "")}">
          </label>
          <label class="block text-sm">Price override
            <input class="product-variant-price mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" step="0.01" value="${escapeHTML(productVariant.priceOverride ?? "")}">
          </label>
          <label class="product-variant-stock-field block text-sm">Product stock
            <input class="product-variant-stock mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" step="1" value="${escapeHTML(productVariant.stock ?? entityVariant.stockQty ?? 0)}">
            <span class="mt-1 block text-xs text-gray-400">Sellable stock for this variant.</span>
          </label>
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
          <label class="block text-sm">Physical fulfilment
            <select class="product-variant-physical-fulfilment mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
              ${compactSelectOptions(
    ["none", "shipping", "pickup", "shipping-or-pickup"],
    productVariant.physicalFulfilment ||
      document.getElementById("contentProductPhysicalFulfilment")?.value ||
      "none",
  )}
            </select>
          </label>
          <label class="product-variant-seats-field hidden block text-sm">Ticket / seat capacity
            <input class="product-variant-seat-capacity mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white" type="number" min="0" step="1" value="${escapeHTML(productVariant.seatCapacity ?? "")}">
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
        </div>
      </details>`;
  }).join("");
}

function syncSelectedProductVariantRows() {
  const input = document.getElementById("contentProductVariants");
  if (!input) return;
  const current = parseProductVariants(input.value);
  const byContentVariantId = new Map(current.map((variant) => [variant.contentVariantId, variant]));
  document.querySelectorAll(".content-product-variant-row").forEach((row) => {
    const contentVariantId = row.dataset.contentVariantId || "";
    const existing = byContentVariantId.get(contentVariantId) || {};
    byContentVariantId.set(contentVariantId, {
      ...existing,
      variantId: row.querySelector(".product-variant-id")?.value.trim() ||
        generatedProductVariantId(contentVariantId),
      name: row.querySelector(".product-variant-name")?.value.trim() || "Variant",
      colour: row.querySelector(".product-variant-colour")?.value.trim() || "",
      size: row.querySelector(".product-variant-size")?.value.trim() || "",
      sku: row.querySelector(".product-variant-sku")?.value.trim() || "",
      priceOverride: optionalNumberFromElement(row.querySelector(".product-variant-price")),
      stock: optionalNumberFromElement(row.querySelector(".product-variant-stock")) ?? 0,
      status: row.querySelector(".product-variant-status")?.value || "draft",
      contentVariantId,
      deliveryMode: row.querySelector(".product-variant-delivery-mode")?.value || "",
      physicalFulfilment: row.querySelector(".product-variant-physical-fulfilment")?.value || "none",
      calendarBookingReference: row.querySelector(".product-variant-calendar-reference")?.value.trim() || "",
      seatCapacity: optionalNumberFromElement(row.querySelector(".product-variant-seat-capacity")),
      eventStartAt: row.querySelector(".product-variant-event-start")?.value || "",
      eventEndAt: row.querySelector(".product-variant-event-end")?.value || "",
      eventLocation: row.querySelector(".product-variant-event-location")?.value.trim() || "",
      instructor: existing.instructor || "",
    });
  });
  input.value = serializeProductVariants([...byContentVariantId.values()]);
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

function isShopProductSelected() {
  if ([...document.querySelectorAll(".variant-add-to-shop")].some((input) => input.checked)) return true;
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

function showBuilderStep(step = state.currentStep) {
  const nextStep = Math.max(1, Math.min(Number(step || 1), 5));
  state.currentStep = nextStep;
  if (nextStep >= 3 && document.querySelector(".content-entity-variant-row")) {
    renderVariantStepRows(entityVariantsFromBuilder());
  }

  document.querySelectorAll(".builder-step-btn").forEach((button) => {
    const active = Number(button.dataset.builderStep || 1) === nextStep;
    button.classList.toggle("bg-[#407471]", active);
    button.classList.toggle("bg-gray-700", !active);
  });

  document.querySelectorAll(".builder-step-panel").forEach((panel) => {
    const panelStep = Number(panel.dataset.builderPanel || 1);
    panel.classList.toggle("hidden", panelStep !== nextStep || !panelAllowedForRecordType(panel));
  });

  const backBtn = document.getElementById("builderBackStepBtn");
  const nextBtn = document.getElementById("builderNextStepBtn");
  if (backBtn) backBtn.disabled = nextStep === 1;
  if (nextBtn) nextBtn.classList.toggle("hidden", nextStep === 5);
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

  document.getElementById("contentBuilderForm")?.addEventListener("input", () => {
    state.isDirty = true;
    renderBuilderSummaries();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.isDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function navigateBuilderStep(targetStep) {
  const nextStep = Math.max(1, Math.min(Number(targetStep || 1), 5));
  if (state.currentStep === 2 && nextStep > 2 && state.isDirty) {
    const saved = await saveVariantsFromBuild();
    if (!saved) return;
  }
  showBuilderStep(nextStep);
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

function linkedTemplateSelectMarkup(field, key, required = false) {
  const records = linkedTemplateFieldRecords(field);
  return `
    <select
      class="content-template-variable content-template-linked-select min-w-0 flex-1 rounded
        bg-gray-800 px-3 py-2 text-white"
      data-field-key="${escapeHTML(key)}"
      data-field-type="linked"
      data-repeatable="false"
      ${required ? "required" : ""}
    >
      <option value="">Choose a record</option>
      ${records.map((record) => `
        <option value="${escapeHTML(record.id)}">
          ${escapeHTML(linkedTemplateRecordLabel(record))}
        </option>
      `).join("")}
    </select>
  `;
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
      control = repeatable
        ? renderRepeatableLinkedTemplateField(field, key, name, required)
        : linkedTemplateSelectMarkup(field, key, required);
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
        ${fieldType === "linked" && !repeatable && assetTypeForTemplateField(field) ? `
          <button type="button" class="create-content-template-asset mt-2 rounded border border-[#407471]
            px-3 py-1 text-xs text-[#9edbd7] hover:bg-[#153b38]"
            data-field-key="${escapeHTML(key)}"
            data-field-name="${escapeHTML(name)}"
            data-asset-type="${escapeHTML(assetTypeForTemplateField(field))}">Add new asset</button>
        ` : ""}
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
    const selected = uniqueValues([...field.querySelectorAll(".content-template-linked-select")]
      .map((input) => input.value));
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
  if (select) {
    [...select.options].forEach((option) => {
      option.disabled = false;
      option.selected = option.value === value;
    });
    if (value && select.value !== value) select.add(new Option(value, value, true, true));
  }
  rows.appendChild(row);
  refreshLinkedTemplateField(field);
  return row;
}

function restoreLinkedTemplateField(field, rawValues) {
  const values = uniqueValues(Array.isArray(rawValues) ? rawValues : [rawValues]);
  const minimum = Math.max(Number(field.dataset.minEntries || 0), 0);
  const desiredRows = Math.max(values.length, minimum, 1);
  const rows = field.querySelector(".content-template-linked-rows");
  if (!rows) return;
  while (rows.children.length < desiredRows) addLinkedTemplateFieldRow(field, "", true);
  while (rows.children.length > desiredRows) rows.lastElementChild?.remove();
  [...rows.querySelectorAll(".content-template-linked-select")].forEach((select, index) => {
    const value = values[index] || "";
    if (value && ![...select.options].some((option) => option.value === value)) {
      select.add(new Option(value, value));
    }
    select.value = value;
  });
  refreshLinkedTemplateField(field);
}

function handleTemplateGuidedFieldsClick(event) {
  const createAsset = event.target.closest(".create-content-template-asset");
  if (createAsset) {
    openContentAssetDrawer(createAsset);
    return;
  }
  const field = event.target.closest(".content-template-linked-field");
  if (!field) return;
  if (event.target.closest(".add-content-template-entry")) {
    addLinkedTemplateFieldRow(field)?.querySelector("select")?.focus();
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
  assetDrawerField = {
    key: templateFieldKey(button.dataset.fieldKey || repeatableField?.dataset.fieldKey),
    name: button.dataset.fieldName || repeatableField?.dataset.fieldName || "Template Asset",
    type: button.dataset.assetType || repeatableField?.dataset.assetType || "Document",
    repeatableField,
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
}

function selectNewTemplateAsset(asset) {
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
    const savedAsset = {
      id: response.data?.assetId || assetId,
      assetId: response.data?.assetId || assetId,
      name: assetName,
      assetName,
      assetType,
      type: assetType.toLowerCase(),
      title: document.getElementById("contentAssetTitle")?.value.trim() || assetName,
      fileUrl,
      status: document.getElementById("contentAssetStatus")?.value || "active",
    };
    state.records.assets = [...state.records.assets.filter((asset) => asset.id !== savedAsset.id), savedAsset];
    selectNewTemplateAsset(savedAsset);
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
    label.textContent = recordType === "plan"
      ? "Plan template / variant"
      : `${recordType[0].toUpperCase()}${recordType.slice(1)} template`;
  }
  createButton?.classList.remove("hidden");
  editButton?.classList.remove("hidden");
  if (editButton) editButton.disabled = !selectedTemplate();
  help?.classList.remove("hidden");
  if (help) {
    help.textContent = templates.length
      ? `${templates.length} saved template${templates.length === 1 ? "" : "s"} available for ${typeValue}.`
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
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 rounded border border-yellow-700/70 bg-yellow-950/20 p-3">
      <div class="min-w-0">
        <div class="font-medium text-white">${escapeHTML(record.name)}</div>
        <div class="mt-1 break-all text-xs text-gray-400">${escapeHTML(record.id)}</div>
        <div class="mt-1 text-xs text-gray-400">${escapeHTML(typeStatus)}</div>
      </div>
      <button type="button"
        class="edit-similar-content-record shrink-0 rounded bg-[#407471] px-3 py-2 text-xs font-medium text-white hover:bg-[#305a56]"
        data-record-type="${escapeHTML(recordType)}"
        data-record-id="${escapeHTML(record.id)}">
        Edit instead
      </button>
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
}

function updateProductRelationshipControl(role = "") {
  const isBlueprint = currentRecordType() === "blueprint";
  const roleInput = document.getElementById("contentProductLinkRole");
  const manufacturingRow = document.getElementById("contentProductManufacturingRoleRow");
  const manufacturingCheckbox = document.getElementById("contentProductManufacturingRecipe");
  const resolvedRole = role || roleInput?.value || "Represents";
  const manufacturing = isBlueprint && resolvedRole === "ManufacturedFrom";
  manufacturingRow?.classList.toggle("hidden", !isBlueprint);
  if (manufacturingCheckbox) manufacturingCheckbox.checked = manufacturing;
  if (roleInput) roleInput.value = manufacturing ? "ManufacturedFrom" : "Represents";
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
    "Save keeps this record in its current workflow state. Approve confirms it is ready. " +
      "Set active makes it available in its configured connections. " +
      "Pause removes it from active use without deleting it.",
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
  const instructor = applyProductInstructorAssignments();
  populateGeneratedProductSku();
  const physical = isPhysicalProductConnection();

  const variants = parseProductVariants(document.getElementById("contentProductVariants")?.value);
  const physicalFulfilment =
    document.getElementById("contentProductPhysicalFulfilment")?.value || "none";
  const requiresShipping = [physicalFulfilment, ...variants.map((variant) => variant.physicalFulfilment)]
    .some((value) => ["shipping", "shipping-or-pickup"].includes(value));
  const inventoryTracked = physical &&
    document.getElementById("contentProductInventoryTracked")?.checked === true;
  const totalVariantStock = variants.reduce((total, variant) => total + Number(variant.stock || 0), 0);
  setInputValue("contentProductStock", inventoryTracked ? totalVariantStock : "");
  const linkRole = document.getElementById("contentProductLinkRole")?.value || "Represents";
  const manufacturingLink = currentRecordType() === "blueprint" && linkRole === "ManufacturedFrom";
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
    visible: document.getElementById("contentProductVisible")?.checked === true,
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
    variantContentLinks: productVariantContentLinksFromRows(),
    accessGrants: productUnlocksFromRows(),
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
  setInputValue("contentProductSku", product.sku);
  setSelectValue("contentProductCategoryId", product.productCategoryId);
  setSelectValue("contentProductDeliveryType", productDeliveryControlValue(
    product.productType,
    product.requiresShipping,
  ));
  setSelectValue(
    "contentProductPhysicalFulfilment",
    product.physicalFulfilment || (product.requiresShipping ? "shipping" : "none"),
  );
  setCheckboxValue("contentProductRequiresShipping", product.requiresShipping === true);
  setCheckboxValue("contentProductInventoryTracked", product.inventoryTracked === true);
  setCheckboxValue("contentProductRequiresCalendar", product.requiresCalendar === true);
  setCheckboxValue("contentProductRequiresSessionTime", product.requiresSessionTime === true);
  setCheckboxValue("contentProductTracksSeats", product.tracksSeats === true);
  setCheckboxValue("contentProductRequiresLocation", product.requiresLocation === true);
  setCheckboxValue("contentProductRequiresInstructor", product.requiresInstructor === true);
  setSelectValue("contentProductShopStatus", product.status || "draft");
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
  setCheckboxValue("contentProductFeatured", product.featured);
  setCheckboxValue("contentProductArchived", product.archived);
  state.retainedProductVariantContentLinks = (product.variantContentLinks || [])
    .filter((link) => link.linkRole !== "ManufacturedFrom");
  setInputValue("contentProductVariants", serializeProductVariants(product.variants || []));
  populateProductVariantsFromEntity();
  renderProductBlueprintOptions(product.manufacturingBlueprintId || "");
  renderProductVariantContentLinkRows(product.variantContentLinks || []);
  renderProductUnlockRows(product.accessGrants || []);
  renderProductInstructorRows(productInstructorAssignments(product));
  updateProductRelationStatus({ productId: product.id });
  renderProductChoiceList(document.getElementById("contentProductSearch")?.value || "", product.id);
  state.isDirty = true;
  renderBuilderSummaries();
  updateProductPhysicalFields();
}

function chooseNewProduct() {
  const linkedProductId = document.getElementById("contentProductId")?.value || state.editingRecord?.productId || "";
  if (linkedProductId) setInputValue("contentUnlinkProductId", linkedProductId);
  setSelectValue("contentExistingProductId", "");
  setInputValue("contentProductId", "");
  setInputValue("contentProductSku", "");
  setSelectValue("contentProductCategoryId", "");
  setSelectValue("contentProductDeliveryType", "Physical");
  setSelectValue("contentProductPhysicalFulfilment", "none");
  updateProductRelationshipControl("Represents");
  ["contentProductRequiresShipping", "contentProductInventoryTracked", "contentProductRequiresCalendar",
    "contentProductRequiresSessionTime", "contentProductTracksSeats", "contentProductRequiresLocation",
    "contentProductRequiresInstructor"].forEach((id) => setCheckboxValue(id, false));
  setSelectValue("contentProductShopStatus", "draft");
  setInputValue(
    "contentProductStock",
    currentRecordType() === "item" ? state.editingRecord?.itemStock ?? "" : "",
  );
  setCheckboxValue("contentProductVisible", false);
  setCheckboxValue("contentProductFeatured", false);
  setCheckboxValue("contentProductArchived", false);
  setInputValue("contentProductVariants", "");
  state.retainedProductVariantContentLinks = [];
  populateProductVariantsFromEntity();
  renderProductVariantContentLinkRows([]);
  renderProductBlueprintOptions("");
  renderProductUnlockRows([]);
  renderProductInstructorRows([]);
  updateProductRelationStatus(null);
  renderProductChoiceList(document.getElementById("contentProductSearch")?.value || "");
  state.isDirty = true;
  updateProductPhysicalFields();
}

function openContentProductDrawer() {
  const drawer = document.getElementById("contentProductDrawer");
  if (!drawer) return;
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
  document.getElementById("contentProductSearch")?.focus();
}

function closeContentProductDrawer() {
  const drawer = document.getElementById("contentProductDrawer");
  if (!drawer) return;
  if (drawer.contains(document.activeElement)) document.getElementById("contentIsShopProduct")?.focus();
  drawer.classList.add("hidden");
  drawer.setAttribute("aria-hidden", "true");
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

function isPhysicalProductConnection() {
  const hasPhysicalVariant = [...document.querySelectorAll(".product-variant-physical-fulfilment")]
    .some((select) => select.value && select.value !== "none");
  return ["Physical", "Hybrid"]
    .includes(document.getElementById("contentProductDeliveryType")?.value || "") ||
    document.getElementById("contentProductPhysicalFulfilment")?.value !== "none" ||
    hasPhysicalVariant;
}

function productDeliveryControlValue(productType, requiresShipping) {
  return productType || "Physical";
}

function updateProductPhysicalFields() {
  const physical = isPhysicalProductConnection();
  const physicalFulfilment =
    document.getElementById("contentProductPhysicalFulfilment")?.value || "none";
  setCheckboxValue(
    "contentProductRequiresShipping",
    ["shipping", "shipping-or-pickup"].includes(physicalFulfilment),
  );
  const tracked = physical && document.getElementById("contentProductInventoryTracked")?.checked === true;
  document.getElementById("contentProductRequiresShipping")?.closest("label")
    ?.classList.toggle("hidden", !physical);
  document.getElementById("contentProductInventoryTrackedField")?.classList.toggle("hidden", !physical);
  document.getElementById("contentProductInventoryHelp")?.classList.toggle("hidden", !physical);
  document.querySelectorAll(".product-variant-stock-field").forEach((field) => {
    field.classList.toggle("hidden", !tracked);
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
  document.getElementById("contentProductInstructorSection")?.classList.toggle("hidden", !instructor);
  if (!tracked) setInputValue("contentProductStock", "");
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

function currentProductVariants() {
  return parseProductVariants(document.getElementById("contentProductVariants")?.value);
}

function productVariantContentLinksFromRows(includeIncomplete = false) {
  let defaultBlueprintId = "";
  const manufacturingLinks = [...document.querySelectorAll(".product-variant-content-link-row")]
    .map((row) => {
      const productVariantId = row.querySelector(".variant-content-product-variant")?.value || "";
      const entityId = row.querySelector(".variant-content-blueprint")?.value || "";
      if (!productVariantId && entityId) defaultBlueprintId = entityId;
      return {
        productVariantId,
        entityType: "Blueprint",
        entityId,
        entityVariantId: "",
        linkRole: "ManufacturedFrom",
        status: "active",
      };
    })
    .filter((link) => link.productVariantId && (includeIncomplete || link.entityId));
  setInputValue("contentProductBlueprintId", defaultBlueprintId);
  const retained = Array.isArray(state.retainedProductVariantContentLinks)
    ? state.retainedProductVariantContentLinks
    : [];
  return [...retained, ...manufacturingLinks];
}

function renderProductVariantContentLinkRows(links = []) {
  const container = document.getElementById("productVariantContentLinkRows");
  if (!container) return;
  const productVariants = currentProductVariants();
  const blueprints = state.records.blueprints || [];
  const manufacturingLinks = links.filter((link) => link.linkRole === "ManufacturedFrom");
  const defaultBlueprintId = document.getElementById("contentProductBlueprintId")?.value || "";
  const rows = [
    ...(defaultBlueprintId ? [{ productVariantId: "", entityId: defaultBlueprintId }] : []),
    ...manufacturingLinks,
  ];
  container.innerHTML = rows.map((link) => {
    const productVariantOptions = productVariants.map((variant) => {
      const selected = variant.variantId === link.productVariantId ? " selected" : "";
      return `<option value="${escapeHTML(variant.variantId)}"${selected}>${escapeHTML(variant.name || variant.variantId)}</option>`;
    }).join("");
    const blueprintOptions = blueprints.map((record) => {
      const selected = record.id === link.entityId ? " selected" : "";
      return `<option value="${escapeHTML(record.id)}"${selected}>${escapeHTML(record.name || record.id)}</option>`;
    }).join("");
    return `
      <div class="product-variant-content-link-row grid gap-2 rounded border border-gray-700 p-2 md:grid-cols-[1fr_1.5fr_auto]">
        <select class="variant-content-product-variant rounded bg-gray-800 px-2 py-2 text-white">
          <option value="">All Product variants</option>${productVariantOptions}
        </select>
        <select class="variant-content-blueprint rounded bg-gray-800 px-2 py-2 text-white">
          <option value="">Choose manufacturing Blueprint</option>${blueprintOptions}
        </select>
        <button type="button" class="remove-product-variant-content-link rounded border border-red-700 px-3 py-1 text-red-200">Remove</button>
      </div>`;
  }).join("") || "<p class=\"text-xs text-gray-400\">No manufacturing Blueprint selected.</p>";
}

function addProductVariantContentLinkRow() {
  renderProductVariantContentLinkRows([
    ...productVariantContentLinksFromRows(),
    { productVariantId: "", entityType: "Blueprint", entityId: "", linkRole: "ManufacturedFrom" },
  ]);
}

function productInstructorAssignmentsFromRows(includeIncomplete = false) {
  return [...document.querySelectorAll(".content-product-instructor-row")].map((row) => ({
    productVariantId: row.querySelector(".content-product-instructor-variant")?.value || "",
    instructor: row.querySelector(".content-product-instructor-name")?.value.trim() || "",
  })).filter((assignment) => includeIncomplete || assignment.instructor);
}

function renderProductInstructorRows(assignments = []) {
  const container = document.getElementById("contentProductInstructorRows");
  if (!container) return;
  const variants = currentProductVariants();
  const savedInstructors = state.options.instructorOptions || [];
  container.innerHTML = assignments.map((assignment) => {
    const options = variants.map((variant) => {
      const selected = variant.variantId === assignment.productVariantId ? " selected" : "";
      return `<option value="${escapeHTML(variant.variantId)}"${selected}>${escapeHTML(variant.name || variant.variantId)}</option>`;
    }).join("");
    const instructorOptions = [...savedInstructors];
    if (assignment.instructor && !instructorOptions.some((option) => option.name === assignment.instructor)) {
      instructorOptions.push({ id: assignment.instructor, name: assignment.instructor, email: "" });
    }
    const instructorSelectOptions = instructorOptions.map((option) => {
      const selected = option.name === assignment.instructor ? " selected" : "";
      const label = option.email ? `${option.name} (${option.email})` : option.name;
      return `<option value="${escapeHTML(option.name)}"${selected}>${escapeHTML(label)}</option>`;
    }).join("");
    return `
      <div class="content-product-instructor-row grid gap-2 rounded border border-gray-700 p-2 md:grid-cols-[1fr_1.5fr_auto]">
        <select class="content-product-instructor-variant rounded bg-gray-800 px-2 py-2 text-white">
          <option value="">All Product variants</option>${options}
        </select>
        <select class="content-product-instructor-name rounded bg-gray-800 px-3 py-2 text-white">
          <option value="">Choose instructor</option>
          ${instructorSelectOptions || "<option value=\"\" disabled>No instructors saved</option>"}
        </select>
        <button type="button" class="remove-content-product-instructor rounded border border-red-700 px-3 py-1 text-red-200">Remove</button>
      </div>`;
  }).join("") || "<p class=\"text-xs text-gray-400\">No instructor assigned.</p>";
  setInputValue("contentProductInstructorAssignments", JSON.stringify(assignments));
}

function productInstructorAssignments(product = {}) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const defaultInstructor = product.instructor || "";
  const assignments = defaultInstructor
    ? [{ productVariantId: "", instructor: defaultInstructor }]
    : [];
  variants.forEach((variant) => {
    if (variant.instructor && variant.instructor !== defaultInstructor) {
      assignments.push({ productVariantId: variant.variantId || variant.id || "", instructor: variant.instructor });
    }
  });
  return assignments;
}

function applyProductInstructorAssignments() {
  const assignments = productInstructorAssignmentsFromRows();
  const defaultInstructor = assignments.find((assignment) => !assignment.productVariantId)?.instructor || "";
  const overrides = new Map(assignments
    .filter((assignment) => assignment.productVariantId)
    .map((assignment) => [assignment.productVariantId, assignment.instructor]));
  const variants = currentProductVariants().map((variant) => ({
    ...variant,
    instructor: overrides.get(variant.variantId) || defaultInstructor,
  }));
  setInputValue("contentProductVariants", serializeProductVariants(variants));
  setInputValue("contentProductInstructorAssignments", JSON.stringify(assignments));
  return defaultInstructor;
}

function addProductInstructorRow() {
  renderProductInstructorRows([
    ...productInstructorAssignmentsFromRows(true),
    { productVariantId: "", instructor: "" },
  ]);
}

function productUnlocksFromRows() {
  return [...document.querySelectorAll(".content-product-unlock-row")].map((row) => ({
    productVariantId: row.querySelector(".content-product-unlock-variant")?.value || "",
    accessEntityType: row.querySelector(".content-product-unlock-type")?.value || "Plan",
    accessEntityId: row.querySelector(".content-product-unlock-target")?.value || "",
    grantTiming: "on-payment-confirmed",
    durationType: "permanent",
    durationValue: null,
    revocable: true,
    status: "active",
  })).filter((grant) => grant.accessEntityId);
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
    return `
      <div class="content-product-unlock-row grid gap-2 rounded border border-gray-700 p-2
        md:grid-cols-[12rem_10rem_1fr_auto]">
        <select class="content-product-unlock-variant rounded bg-gray-800 px-2 py-2 text-white">
          <option value="">All Product variants</option>
          ${variantOptions}
        </select>
        <select class="content-product-unlock-type rounded bg-gray-800 px-2 py-2 text-white"
          data-row-index="${index}">
          ${typeOptions}
        </select>
        <select class="content-product-unlock-target min-w-0 rounded bg-gray-800 px-2 py-2 text-white">
          <option value="">Choose content to unlock</option>
          ${targetOptions}
        </select>
        <button type="button"
          class="remove-content-product-unlock rounded border border-red-700 px-3 py-1 text-red-200">
          Remove
        </button>
      </div>
    `;
  }).join("") || "<p class=\"text-xs text-gray-400\">No additional content unlocks selected.</p>";
}

function addProductUnlockRow() {
  renderProductUnlockRows([
    ...productUnlocksFromRows(),
    { productVariantId: "", accessEntityType: "Plan", accessEntityId: "" },
  ]);
}

function updateProductRelationStatus(record) {
  const status = document.getElementById("contentProductRelationStatus");
  const unlinkButton = document.getElementById("unlinkContentProductBtn");
  if (!status) return;
  const productId = record?.productId || record?.itemProductId || "";
  status.textContent = productId ? `Linked: ${productId}` : "No linked product";
  status.classList.toggle("bg-green-900/60", !!productId);
  status.classList.toggle("text-green-200", !!productId);
  status.classList.toggle("bg-gray-800", !productId);
  status.classList.toggle("text-gray-300", !productId);
  unlinkButton?.classList.toggle("hidden", !productId);
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
    list.textContent = "No assets linked.";
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

function summaryCard(label, value, tone = "default") {
  const toneClass = tone === "warning"
    ? "border-yellow-700 bg-yellow-900/20 text-yellow-100"
    : tone === "ok"
      ? "border-green-800 bg-green-900/20 text-green-100"
      : "border-gray-700 bg-gray-900/60 text-gray-200";
  return `
    <div class="rounded border ${toneClass} p-3">
      <div class="text-xs uppercase tracking-wide text-gray-400">${escapeHTML(label)}</div>
      <div class="mt-1 break-words font-medium">${escapeHTML(value || "-")}</div>
    </div>
  `;
}

function moneyLabel(value) {
  if (value === "" || value === null || value === undefined) return "No price set";
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "No price set";
}

function renderBuilderSummaries(record = state.editingRecord) {
  const relationships = document.getElementById("contentRelationshipSummary");
  const review = document.getElementById("contentReviewSummary");
  if (!relationships && !review) return;

  const productRelation = productRelationPayload() || {};
  const isShopProduct = isShopProductSelected();
  const productId = productRelation.productId || record?.productId || record?.itemProductId || "";
  const price = productRelation.effectiveShopPrice ??
    record?.productEffectiveShopPrice ??
    record?.productPrice ??
    "";
  const variants = productRelation.variants || record?.variants || [];
  const recordType = currentRecordType();
  const linkedItemCount = hiddenRelationshipIds("contentLinkedItemIds").length;
  const linkedBlueprintCount = hiddenRelationshipIds("contentLinkedBlueprintIds").length;
  const linkedPlanCount = hiddenRelationshipIds("contentLinkedPlanIds").length;
  const entityVariants = entityVariantsFromBuilder();
  const selectedAssetIds = uniqueValues([
    ...entityVariants.flatMap((variant) => templateAssetLinksForVariant(variant)).map((link) => link.assetId),
    ...(Array.isArray(record?.assets) ? record.assets : [])
      .map((asset) => typeof asset === "string" ? asset : asset.assetId || asset.id),
  ]);
  const assetLabel = (assetId) => {
    const asset = (state.records.assets || []).find((candidate) => candidate.id === assetId);
    return asset?.name || asset?.assetName || asset?.title || assetId;
  };
  const selectedAssetLabels = selectedAssetIds.map(assetLabel);
  const assetSummary = selectedAssetLabels.join(", ") || "No linked assets";
  const variantAssetIds = new Set();
  const variantAssetSummaries = entityVariants.map((variant) => {
    const assetIds = uniqueValues(templateAssetLinksForVariant(variant).map((link) => link.assetId));
    assetIds.forEach((assetId) => variantAssetIds.add(assetId));
    return assetIds.length
      ? `${variant.name}: ${assetIds.map(assetLabel).join(", ")}`
      : "";
  }).filter(Boolean);
  const unassignedAssetIds = selectedAssetIds.filter((assetId) => !variantAssetIds.has(assetId));
  const reviewAssetSummary = [
    ...variantAssetSummaries,
    ...(unassignedAssetIds.length
      ? [`Other linked assets: ${unassignedAssetIds.map(assetLabel).join(", ")}`]
      : []),
  ].join(" | ") || "No linked assets";
  const entityVariantSummary = entityVariants.length
    ? entityVariants.map((variant) => variant.name).join(", ")
    : "Primary version only";
  const libraryVisible = document.getElementById("contentWebsiteVisible")?.checked === true;
  const accessGrants = productRelation.accessGrants || record?.productAccessGrants || [];
  const estimatedCost = recordType === "blueprint" ? updateBlueprintEstimatedCost() : null;
  const itemCostSummary = recordType === "item"
    ? entityVariants
      .filter((variant) => variant.unitCost !== null && variant.unitCost !== undefined)
      .map((variant) => entityVariants.length > 1
        ? `${variant.name}: $${Number(variant.unitCost).toFixed(2)}`
        : `$${Number(variant.unitCost).toFixed(2)}`)
      .join(", ")
    : "";

  if (relationships) {
    relationships.innerHTML = [
      summaryCard(
        "Shop product",
        isShopProduct ? productId || "New product" : "Not connected",
        isShopProduct ? "ok" : "default",
      ),
      summaryCard("Library", libraryVisible ? "Add to library" : "Not in library", libraryVisible ? "ok" : "default"),
      summaryCard("Reusable Items", `${linkedItemCount} selected`, linkedItemCount ? "ok" : "default"),
      summaryCard("Blueprint components", `${linkedBlueprintCount} selected`, linkedBlueprintCount ? "ok" : "default"),
      summaryCard("Related Plans", `${linkedPlanCount} linked`, linkedPlanCount ? "ok" : "default"),
      summaryCard("Linked assets", assetSummary, selectedAssetIds.length ? "ok" : "warning"),
      summaryCard("Product unlocks", accessGrants.length ? `${accessGrants.length} targets` : "No unlocks"),
    ].join("");
  }

  if (review) {
    review.innerHTML = [
      summaryCard("Entity", recordType),
      summaryCard("Name", document.getElementById("contentName")?.value || record?.name || ""),
      summaryCard("Type", document.getElementById("contentType")?.value || record?.type || ""),
      summaryCard("Template", selectedTemplate()?.templateName || selectedTemplate()?.name || "Not selected"),
      summaryCard("Entity variants", entityVariantSummary),
      summaryCard("Status", document.getElementById("contentStatus")?.value || record?.status || "draft"),
      summaryCard("Tags", selectedTagsFromControls().join(", ") || "No tags"),
      summaryCard("Description", document.getElementById("contentShortDescription")?.value || "Not entered"),
      ...(estimatedCost === null ? [] : [summaryCard("Estimated unit cost", `$${estimatedCost.toFixed(2)}`)]),
      ...(recordType === "item"
        ? [summaryCard("Estimated unit cost", itemCostSummary || "Not entered")]
        : []),
      summaryCard("Library", libraryVisible ? "Included" : "Not included", libraryVisible ? "ok" : "default"),
      summaryCard(
        "Product",
        isShopProduct
          ? `${productId || "New product"} / ${moneyLabel(price)} / ${variants.length} variants`
          : "Not connected",
      ),
      summaryCard("Product unlocks", accessGrants.length ? `${accessGrants.length} targets` : "No unlocks"),
      summaryCard(
        "Connected content",
        `${linkedItemCount} Items / ${linkedBlueprintCount} Blueprints / ${linkedPlanCount} Plans`,
      ),
      summaryCard("Assets", reviewAssetSummary),
    ].join("");
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
  if (params.get("tag")) renderTagControls([params.get("tag")]);
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
}

function populateBuilderFromRecord(record) {
  const recordType = singularRecordType(record.recordType);
  state.editingRecord = { ...record, recordType };

  setSelectValue("contentRecordType", recordType);
  updateFormForRecordType();
  setSelectValue("contentType", record.type || record.itemType);
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
  setInputValue("contentShortDescription", record.shortDescription);
  setInputValue("contentLongDescription", record.longDescription);
  renderTagControls(record.tags || []);
  const storedVariants = Array.isArray(record.entityVariants) ? record.entityVariants : [];
  const legacyShopEnabled = Boolean(record.productId || record.createsProduct || record.isShopProduct);
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
    shopEnabled: variant?.shopEnabled ?? legacyShopEnabled,
    libraryVisible: variant?.libraryVisible ?? legacyLibraryVisible,
    ...variant,
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
  }];
  renderEntityVariantRows(hydratedVariants);

  if (recordType === "item") {
    setCheckboxValue("contentWebsiteVisible", record.websiteVisible || record.requestedWebsiteVisible);
    setCheckboxValue("contentIsShopProduct", record.isShopProduct);
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
    setSelectValue(
      "contentProductPhysicalFulfilment",
      record.productPhysicalFulfilment || (record.productRequiresShipping ? "shipping" : "none"),
    );
    setCheckboxValue("contentProductRequiresShipping", record.productRequiresShipping === true);
    setCheckboxValue("contentProductInventoryTracked", record.productInventoryTracked === true);
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
      .filter((link) => link.linkRole !== "ManufacturedFrom");
    setInputValue("contentProductVariants", serializeProductVariants(record.variants || []));
    renderProductBlueprintOptions(record.manufacturingBlueprintId || "");
    renderProductVariantContentLinkRows(record.productVariantContentLinks || []);
    renderProductUnlockRows(record.productAccessGrants || []);
    renderProductInstructorRows(productInstructorAssignments({
      instructor: record.productInstructor,
      variants: record.variants || [],
    }));
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
    setSelectValue(
      "contentProductPhysicalFulfilment",
      record.productPhysicalFulfilment || (record.productRequiresShipping ? "shipping" : "none"),
    );
    setCheckboxValue("contentProductRequiresShipping", record.productRequiresShipping === true);
    setCheckboxValue("contentProductInventoryTracked", record.productInventoryTracked === true);
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
      .filter((link) => link.linkRole !== "ManufacturedFrom");
    setInputValue("contentProductVariants", serializeProductVariants(record.variants || []));
    renderProductBlueprintOptions(record.manufacturingBlueprintId || "");
    renderProductVariantContentLinkRows(record.productVariantContentLinks || []);
    renderProductUnlockRows(record.productAccessGrants || []);
    renderProductInstructorRows(productInstructorAssignments({
      instructor: record.productInstructor,
      variants: record.variants || [],
    }));
    updateProductRelationStatus(record);
  }

  updateProductPhysicalFields();

  renderRelationshipPickers();

  state.currentStep = 2;
  state.isDirty = false;
  updateEditBanner();
  renderBuilderSummaries(record);
  showBuilderStep(2);
  renderSimilarList();
}

function applyBuilderRoute() {
  document.getElementById("contentBuilderForm")?.classList.remove("hidden");
  document.getElementById("contentBuilderConfirmation")?.classList.add("hidden");
  const params = new URLSearchParams(window.location.search);
  if (params.get("new") === "1") {
    populateNewBuilderFromRoute(params);
    return;
  }
  const recordId = params.get("id") || "";
  const recordType = params.get("type") || "";
  if (!recordId || !recordType) {
    clearEditMode({ updateHistory: false });
    return;
  }

  const record = findRecord(recordType, recordId);
  if (!record) {
    showToast("Could not find that content record to edit.", "error");
    return;
  }
  populateBuilderFromRecord(record);
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
    if (linkedTable) linkedTable.value = linkedDefaults[event.target.value] || "";
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
  const defaultTemplate = templates.find((template) => template.isDefault) || templates[0];
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

async function formPayload(confirmDuplicate = false) {
  const recordType = document.getElementById("contentRecordType")?.value || "item";
  const entityVariants = entityVariantsFromBuilder();
  if (!entityVariants.length) throw new Error("Add at least one variant before saving.");
  entityVariants.forEach((variant, index) => {
    const row = document.querySelectorAll(".content-entity-variant-row")[index];
    if (!variant.templateVariantId) throw new Error(`Choose a template for ${variant.name}.`);
    templateFieldValuesFromBuilder({ validate: true, root: row });
  });
  const primaryVariant = entityVariants[0];
  const primaryBehaviours = primaryVariant.behaviourDefaults || {};
  const templateFieldValues = primaryVariant.templateFieldValues || {};
  const templateId = primaryVariant.templateVariantId || "";
  if (["item", "blueprint", "plan"].includes(recordType) && !templateId) {
    throw new Error("Choose or create a template before building this record.");
  }
  const productRelation = productRelationPayload();
  if (productRelation?.linkRole === "ManufacturedFrom" && !productRelation.existingProductId) {
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
    websiteVisible: entityVariants.some((variant) => variant.libraryVisible === true),
    isShopProduct: recordType === "item"
      ? primaryBehaviours.isShopProduct === true
      : document.getElementById("contentIsShopProduct")?.checked === true,
    createsProduct: isShopProductSelected(),
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
    ],
    linkedItemComponents: recordType === "blueprint" ? blueprintItemComponentsFromPicker() : [],
    estimatedUnitCost: recordType === "blueprint" ? updateBlueprintEstimatedCost() : null,
    linkedBlueprintIds: [...new Set(linkedBlueprintIds)],
    linkedPlanIds: splitCsv(document.getElementById("contentLinkedPlanIds")?.value),
    audience: document.getElementById("contentAudience")?.value || "",
    goal: document.getElementById("contentGoal")?.value || "",
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
    defaults.issuesCertificate = document.getElementById("templateIssuesCertificate")?.checked === true;
    defaults.stockStatus = defaults.inventoryTracked ? "draft" : "not-tracked";
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
  showBuilderStep(5);
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
  const form = document.getElementById("contentBuilderForm");
  const confirmation = document.getElementById("contentBuilderConfirmation");
  if (!confirmation) return;

  const copy = confirmationCopy(action);
  const name = record?.name || payload.name || recordId;
  const productId = record?.productId || record?.itemProductId ||
    payload.productRelation?.productId || payload.productRelation?.existingProductId || payload.productId || "";
  const marketplaceVisible = Boolean(
    productId && (
      record?.shopVisible === true ||
      record?.productVisible === true ||
      record?.visible === true ||
      payload.shopVisible === true ||
      payload.productRelation?.visible === true
    ),
  );
  const libraryVisible = Boolean(
    record?.websiteVisible === true ||
    payload.websiteVisible === true,
  );

  form?.classList.add("hidden");
  confirmation.classList.remove("hidden");
  document.getElementById("contentBuilderConfirmationTitle").textContent = copy.title;
  document.getElementById("contentBuilderConfirmationMessage").textContent = copy.message;
  document.getElementById("contentBuilderConfirmationMeta").textContent =
    [name, recordId].filter(Boolean).join(" • ");

  const marketplaceLink = document.getElementById("contentBuilderMarketplaceLink");
  marketplaceLink?.classList.toggle("hidden", !marketplaceVisible);
  if (marketplaceLink) marketplaceLink.href = `/shop/${encodeURIComponent(productId)}`;

  const libraryLink = document.getElementById("contentBuilderLibraryLink");
  libraryLink?.classList.toggle("hidden", !libraryVisible);
  if (libraryLink) libraryLink.href = "/anato-me";

  confirmation.scrollIntoView({ behavior: "smooth", block: "start" });
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
    await savePayload(applySaveAction(payload, action), action);
  } catch (err) {
    console.error("Failed to prepare content record:", err);
    showToast(err.message || "Check the form values and try again.", "error");
  }
}

async function saveVariantsFromBuild() {
  try {
    const payload = await formPayload(false);
    payload.status = state.editingRecord?.status || "draft";
    if (!state.editingRecord) {
      payload.createsProduct = false;
      payload.isShopProduct = false;
      payload.productRelation = null;
    }
    payload.shopVisible = false;
    payload.websiteVisible = false;

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
        showToast("Similar record found. Edit it instead or confirm the new record first.", "error");
        return false;
      }
      const recordId = response.data?.id;
      if (!recordId) throw new Error("The variants saved, but the new record ID was not returned.");
      state.editingRecord = { id: recordId, recordType: payload.recordType };
      history.replaceState({}, "", `/admin/content/builder?type=${encodeURIComponent(payload.recordType)}&id=${encodeURIComponent(recordId)}`);
    }

    state.isDirty = false;
    await loadData();
    showToast("Variants saved automatically.", "success");
    return true;
  } catch (err) {
    console.error("Failed to save content variants:", err);
    showToast(err.message || "Failed to save variants.", "error");
    return false;
  }
}

async function saveTemplate() {
  const saveButton = document.querySelector("#contentTemplateForm button[type='submit']");
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

  setupBuilderStepControls();
  document.getElementById("contentRecordType")?.addEventListener("change", () => {
    if (!state.editingRecord) {
      setHiddenRelationshipIds("contentLinkedItemIds", []);
      setHiddenRelationshipIds("contentLinkedBlueprintIds", []);
      setHiddenRelationshipIds("contentLinkedPlanIds", []);
    }
    updateFormForRecordType();
  });
  document.getElementById("newContentBuilderRecordBtn")?.addEventListener("click", clearEditMode);
  setupBuilderFilters();
  document.getElementById("contentType")?.addEventListener("change", () => {
    const variants = entityVariantsFromBuilder();
    updateTemplatesForType();
    renderEntityVariantRows(variants);
    applyTypeDrivenFieldGroups();
    renderSimilarList();
    renderRelationshipPickers();
    updateBuilderFilterButtons(currentRecordType());
  });
  document.getElementById("contentTemplate")?.addEventListener("change", applyTemplateDefaults);
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
  document.getElementById("contentName")?.addEventListener("input", renderSimilarList);
  document.getElementById("contentSimilarList")?.addEventListener("click", (event) => {
    const button = event.target.closest(".edit-similar-content-record");
    if (!button) return;
    const recordType = button.dataset.recordType || currentRecordType();
    const recordId = button.dataset.recordId || "";
    const record = findRecord(recordType, recordId);
    if (!record) {
      showToast("That similar record could not be loaded. Refresh and try again.", "error");
      return;
    }
    history.pushState({}, "", `/admin/content/builder?type=${encodeURIComponent(recordType)}&id=${encodeURIComponent(recordId)}`);
    populateBuilderFromRecord(record);
    showToast(`Editing ${record.name || record.id} instead.`, "success");
  });
  document.getElementById("addContentTagBtn")?.addEventListener("click", () => addTagRow());
  document.getElementById("contentTagRows")?.addEventListener("change", handleTagRowsChange);
  document.getElementById("contentTagRows")?.addEventListener("input", syncTagInput);
  document.getElementById("contentTagRows")?.addEventListener("click", handleTagRowsClick);
  document.getElementById("contentTagCategoryFilter")?.addEventListener("change", () => {
    renderTagControls(selectedTagsFromControls());
  });
  document.getElementById("templateGuidedFields")?.addEventListener(
    "click",
    handleTemplateGuidedFieldsClick,
  );
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
    if (!event.target.matches(".variant-add-to-shop, .variant-add-to-library")) return;
    const variants = entityVariantsFromBuilder();
    setCheckboxValue("contentIsShopProduct", variants.some((variant) => variant.shopEnabled));
    setCheckboxValue("contentWebsiteVisible", variants.some((variant) => variant.libraryVisible));
    state.isDirty = true;
    updateSaveWorkflow();
    renderBuilderSummaries();
  });
  document.getElementById("openVariantShopProductBtn")?.addEventListener("click", () => {
    const variants = entityVariantsFromBuilder();
    if (!variants.some((variant) => variant.shopEnabled)) {
      showToast("Select at least one variant to add to the Shop Product.", "error");
      return;
    }
    setCheckboxValue("contentIsShopProduct", true);
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
  document.getElementById("contentProductPrice")?.addEventListener("input", updateConnectedProductCostPreview);
  document.getElementById("contentProductDeliveryType")?.addEventListener("change", () => {
    updateProductPhysicalFields();
  });
  document.getElementById("contentProductPhysicalFulfilment")?.addEventListener("change", () => {
    updateProductPhysicalFields();
    state.isDirty = true;
  });
  document.getElementById("contentProductInventoryTracked")?.addEventListener(
    "change",
    updateProductPhysicalFields,
  );
  ["contentProductRequiresCalendar", "contentProductTracksSeats", "contentProductRequiresSessionTime",
    "contentProductRequiresLocation", "contentProductRequiresInstructor"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", updateProductPhysicalFields);
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
  document.getElementById("contentProductChoiceList")?.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-product-choice]");
    if (choice) chooseExistingProduct(choice.dataset.productChoice);
  });
  document.getElementById("createNewProductChoiceBtn")?.addEventListener("click", chooseNewProduct);
  document.getElementById("addProductVariantContentLinkBtn")?.addEventListener(
    "click",
    addProductVariantContentLinkRow,
  );
  document.getElementById("productVariantContentLinkRows")?.addEventListener("click", (event) => {
    const remove = event.target.closest(".remove-product-variant-content-link");
    if (!remove) return;
    remove.closest(".product-variant-content-link-row")?.remove();
    productVariantContentLinksFromRows(true);
    renderProductBlueprintOptions(document.getElementById("contentProductBlueprintId")?.value || "");
    state.isDirty = true;
  });
  document.getElementById("productVariantContentLinkRows")?.addEventListener("change", (event) => {
    if (!event.target.matches(".variant-content-product-variant, .variant-content-blueprint")) return;
    productVariantContentLinksFromRows(true);
    renderProductBlueprintOptions(document.getElementById("contentProductBlueprintId")?.value || "");
    state.isDirty = true;
  });
  document.getElementById("contentProductVariants")?.addEventListener("change", () => {
    renderProductVariantContentLinkRows(productVariantContentLinksFromRows(true));
    renderProductInstructorRows(productInstructorAssignmentsFromRows(true));
  });
  document.getElementById("contentProductVariantRows")?.addEventListener("input", () => {
    syncSelectedProductVariantRows();
    state.isDirty = true;
  });
  document.getElementById("contentProductVariantRows")?.addEventListener("change", () => {
    syncSelectedProductVariantRows();
    renderProductVariantContentLinkRows(productVariantContentLinksFromRows(true));
    renderProductInstructorRows(productInstructorAssignmentsFromRows(true));
    state.isDirty = true;
  });
  document.getElementById("addContentProductInstructorBtn")?.addEventListener(
    "click",
    addProductInstructorRow,
  );
  document.getElementById("contentProductInstructorRows")?.addEventListener("click", (event) => {
    const remove = event.target.closest(".remove-content-product-instructor");
    if (!remove) return;
    remove.closest(".content-product-instructor-row")?.remove();
    state.isDirty = true;
  });
  document.getElementById("contentProductInstructorRows")?.addEventListener("change", () => {
    state.isDirty = true;
  });
  document.getElementById("contentProductInstructorRows")?.addEventListener("input", () => {
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
      variants[index].linkedItemComponents.push({ itemId: "", quantity: 1 });
      renderEntityVariantRows(variants);
      return;
    }
    const removeRecipe = event.target.closest(".remove-blueprint-variant-recipe-row");
    if (removeRecipe) {
      removeRecipe.closest(".blueprint-variant-recipe-row")?.remove();
      updateBlueprintVariantRecipeTotals();
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
    renderBuilderSummaries();
  });
  document.getElementById("contentEntityVariantRows")?.addEventListener("toggle", (event) => {
    const row = event.target.closest(".content-entity-variant-row");
    if (!row) return;
    const chevron = row.querySelector(".content-entity-variant-chevron");
    if (chevron) chevron.textContent = row.open ? "−" : "+";
  }, true);
  document.getElementById("contentEntityVariantRows")?.addEventListener("change", (event) => {
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
  document.getElementById("addContentProductUnlockBtn")?.addEventListener("click", addProductUnlockRow);
  document.getElementById("contentProductUnlockRows")?.addEventListener("change", (event) => {
    if (!event.target.classList.contains("content-product-unlock-type")) return;
    const allRows = [...document.querySelectorAll(".content-product-unlock-row")];
    const index = allRows.indexOf(event.target.closest(".content-product-unlock-row"));
    const grants = productUnlocksFromRows();
    grants[index] = {
      productVariantId: event.target.closest(".content-product-unlock-row")
        ?.querySelector(".content-product-unlock-variant")?.value || "",
      accessEntityType: event.target.value,
      accessEntityId: "",
    };
    renderProductUnlockRows(grants);
  });
  document.getElementById("contentProductUnlockRows")?.addEventListener("click", (event) => {
    const remove = event.target.closest(".remove-content-product-unlock");
    if (!remove) return;
    const allRows = [...document.querySelectorAll(".content-product-unlock-row")];
    const index = allRows.indexOf(remove.closest(".content-product-unlock-row"));
    const grants = productUnlocksFromRows();
    grants.splice(index, 1);
    renderProductUnlockRows(grants);
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
  document.getElementById("applyContentProductBtn")?.addEventListener("click", closeContentProductDrawer);
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
