import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { functions, storage } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";
import { selectCampaignMatches } from "./content-builder-relationships.js";

const getContentBuilderData = httpsCallable(functions, "getContentBuilderData");
const createContentBuilderRecord = httpsCallable(functions, "createContentBuilderRecord");
const upsertContentBuilderTemplate = httpsCallable(functions, "upsertContentBuilderTemplate");
const updateContentControlRecord = httpsCallable(functions, "updateContentControlRecord");

let state = {
  options: {
    itemTypes: [],
    itemKinds: [],
    categoryOptions: [],
    blueprintTypes: [],
    planTypes: [],
    campaignTypes: [],
    tagOptions: [],
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
};

const BUILDER_STEP_LABELS = {
  item: [
    "1. Type & Template",
    "2. Item Details",
    "3. Product / Asset / Access",
    "4. Relationships",
    "5. Review & Publish",
  ],
  blueprint: [
    "1. Type & Template",
    "2. Blueprint Details",
    "3. Instructions & Components",
    "4. Items, Assets & Relationships",
    "5. Review & Publish",
  ],
  plan: [
    "1. Plan Type",
    "2. Plan Details",
    "3. Build Plan & Template",
    "4. Access, Pathway & Relationships",
    "5. Review & Publish",
  ],
  campaign: [
    "1. Campaign Type & Template",
    "2. Strategy & Audience",
    "3. Build Deliverables",
    "4. Schedule, Channels & Relationships",
    "5. Review & Activate",
  ],
};

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  relationships: "Reusable relationships",
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

  const definition = selectedEntityTypeDefinition();
  const category = document.getElementById("contentCategoryId");
  if (!state.editingRecord && category && !category.value && definition?.defaultCategoryId) {
    setSelectValue("contentCategoryId", definition.defaultCategoryId);
  }

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

function relationshipPickerMarkup(kind, records, selectedIds) {
  const selected = new Set(selectedIds);
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

function renderCampaignTagFilter() {
  const select = document.getElementById("contentCampaignTagFilter");
  if (!select) return;
  const current = select.value;
  const tags = knownContentTags();
  select.innerHTML = [
    "<option value=\"\">Choose a condition tag</option>",
    ...tags.map((tag) => `<option value="${escapeHTML(tag)}">${escapeHTML(tag)}</option>`),
  ].join("");
  if (tags.includes(current)) select.value = current;
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
  sections.blueprint?.classList.toggle("hidden", !["plan", "campaign"].includes(recordType));
  sections.plan?.classList.toggle("hidden", !["plan", "campaign"].includes(recordType));

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

  pickerConfig.forEach(([kind, containerId, inputId, records]) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = relationshipPickerMarkup(kind, records, hiddenRelationshipIds(inputId));
  });

  const isCampaignPlan = recordType === "plan" &&
    normalizedType(document.getElementById("contentType")?.value) === "campaign";
  document.getElementById("contentCampaignPlanHelper")?.classList.toggle("hidden", !isCampaignPlan);
  if (isCampaignPlan) renderCampaignTagFilter();
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

function addCampaignMatches() {
  const tag = document.getElementById("contentCampaignTagFilter")?.value || "";
  const status = document.getElementById("contentCampaignMatchStatus");
  if (!tag) {
    if (status) status.textContent = "Choose a condition tag first.";
    return;
  }

  const { blueprints, items, plans } = selectCampaignMatches(state.records, tag);

  setHiddenRelationshipIds("contentLinkedBlueprintIds", [
    ...hiddenRelationshipIds("contentLinkedBlueprintIds"),
    ...blueprints.map((record) => record.id),
  ]);
  setHiddenRelationshipIds("contentLinkedItemIds", [
    ...hiddenRelationshipIds("contentLinkedItemIds"),
    ...items.map((record) => record.id),
  ]);
  setHiddenRelationshipIds("contentLinkedPlanIds", [
    ...hiddenRelationshipIds("contentLinkedPlanIds"),
    ...plans.map((record) => record.id),
  ]);
  if (!selectedTagsFromControls().some((selectedTag) => normalizedType(selectedTag) === normalizedType(tag))) {
    addTagRow(tag);
  }

  renderRelationshipPickers();
  if (status) {
    status.textContent = `Added ${blueprints.length} Blueprints, ${items.length} Items, ` +
      `and ${plans.length} related treatment Plans for ${tag}.`;
  }
  state.isDirty = true;
  renderBuilderSummaries();
}

function knownContentTags() {
  const allRecords = Object.values(state.records || {}).flatMap((records) => records || []);
  return uniqueValues([
    ...(state.options.tagOptions || []).map((tag) => tag.name || tag.id),
    ...allRecords.flatMap((record) => record.tags || []),
  ])
    .sort((left, right) => left.localeCompare(right));
}

function tagRowMarkup(value = "") {
  const knownTags = knownContentTags();
  const selectedValue = String(value || "").trim();
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

function categoryName(categoryId) {
  const category = (state.options.categoryOptions || [])
    .find((option) => option.id === categoryId);
  return category ? categoryDisplayName(category) : categoryId || "-";
}

function templateDefinitions(recordType, typeValue = "") {
  const definitions = state.options.templateDefinitions?.[recordType] || [];
  const normalizedValue = normalizedType(typeValue);
  return definitions.filter((template) =>
    template.active !== false &&
    (!normalizedValue || normalizedType(template.appliesTo) === normalizedValue),
  );
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
  const assetType = normalizedType(asset?.type);
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
  return document.getElementById("contentIsShopProduct")?.checked === true ||
    document.getElementById("contentCreatesProduct")?.checked === true;
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
  if (panel.id === "itemProductRelationshipFields") return isShopProductSelected();
  if (panel.id === "advancedContentFields") return recordType !== "item";
  if (panel.id === "contentRelationshipReview") return true;
  if (panel.id === "contentReviewPublishPanel") return true;
  if (panel.id === "contentDuplicateWarning") return state.duplicateWarningActive === true;
  return true;
}

function showBuilderStep(step = state.currentStep) {
  const nextStep = Math.max(1, Math.min(Number(step || 1), 5));
  state.currentStep = nextStep;

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
    button.addEventListener("click", () => {
      showBuilderStep(Number(button.dataset.builderStep || 1));
    });
  });

  document.getElementById("builderBackStepBtn")?.addEventListener("click", () => {
    showBuilderStep(state.currentStep - 1);
  });

  document.getElementById("builderNextStepBtn")?.addEventListener("click", () => {
    showBuilderStep(state.currentStep + 1);
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
  if (["asset", "assets", "item asset", "item assets"].includes(linkedTable)) {
    return state.records.assets || [];
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
      </div>
    </div>
  `;
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
        ${notes ? `<span class="mt-1 block text-xs text-gray-400">${escapeHTML(notes)}</span>` : ""}
      </label>
    `;
  }).join("");

  return `
    <section class="mt-4 rounded border border-gray-700 bg-gray-950/40 p-3">
      <h4 class="font-semibold text-white">Template fields</h4>
      <p class="mt-1 text-xs text-gray-400">These fields are specific to the selected template.</p>
      <div class="mt-3 grid gap-3">${controls}</div>
    </section>
  `;
}

function templateFieldValuesFromBuilder({ validate = false } = {}) {
  const values = {};
  const linkedKeys = new Set();
  document.querySelectorAll(".content-template-linked-field").forEach((field) => {
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

  document.querySelectorAll(".content-template-variable").forEach((input) => {
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

function captureTemplateGuidedValues() {
  return {
    intendedOutput: templateInput("contentIntendedOutput"),
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
  setInputValue("contentIntendedOutput", values.intendedOutput);
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
        <div><strong>Default category:</strong> ${escapeHTML(categoryName(defaults.categoryId))}</div>
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
        Add reusable Blueprints and Items through this variant's fields and the Relationships step.
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
          Template fields define the variant-specific structure. Relationships remain reusable and are not copied
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
      <div class="mt-3 grid gap-3">
        <label class="block">
          Intended output
          <input
            id="contentIntendedOutput"
            class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            placeholder="Exercise instruction, warmup, test, cue..."
          >
        </label>
      </div>
      ${fields.length ? renderTemplateCustomFields(template) : ""}
      <p class="mt-2 text-xs text-gray-400">Choose reusable Items in the Relationships step.</p>
    </div>
  `;
}

function renderCampaignTemplateFields(template) {
  return `
    <div>
      ${currentRecordType() === "plan" ? "<div id=\"planTemplateSelectorSlot\" class=\"mb-4\"></div>" : ""}
      <h3 class="font-semibold text-white">${escapeHTML(template?.name || "Campaign template")}</h3>
      <p class="mt-1 text-xs text-gray-300">
        Link existing items, blueprints, or plans, then use audience and goal to define the campaign.
      </p>
      <div class="mt-3 grid gap-3 md:grid-cols-2">
        <label class="block">
          Start date
          <input id="contentStartDate" type="date" class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
        </label>
        <label class="block">
          End date
          <input id="contentEndDate" type="date" class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white">
        </label>
      </div>
      ${renderTemplateCustomFields(template)}
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
    const type = normalizedType(document.getElementById("contentType")?.value);
    container.innerHTML = type === "campaign"
      ? renderCampaignTemplateFields(template)
      : renderPlanTemplateFields(template);
    positionTemplateField(recordType);
    renderPlanTemplateSelect(template?.id || "");
    return;
  }

  if (recordType === "blueprint") {
    container.innerHTML = renderBlueprintTemplateFields(template);
    positionTemplateField(recordType);
    return;
  }

  container.innerHTML = renderCampaignTemplateFields(template);
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
  const categoryId = document.getElementById("contentCategoryId");
  if (categoryId && defaults.categoryId) categoryId.value = defaults.categoryId;

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
    const itemKind = document.getElementById("contentItemKind");

    if (shopProduct) shopProduct.checked = defaults.isShopProduct === true;
    if (requiresShipping) requiresShipping.checked = defaults.requiresShipping === true;
    if (inventoryTracked) inventoryTracked.checked = defaults.inventoryTracked === true;
    if (soldByRecoveryTools) soldByRecoveryTools.checked = defaults.soldByRecoveryTools !== false;
    if (requiresCalendar) requiresCalendar.checked = defaults.requiresCalendar === true;
    if (requiresSessionTime) requiresSessionTime.checked = defaults.requiresSessionTime === true;
    if (tracksSeats) tracksSeats.checked = defaults.tracksSeats === true;
    if (unlocksAccess) unlocksAccess.checked = defaults.unlocksAccess === true;
    if (issuesCertificate) issuesCertificate.checked = defaults.issuesCertificate === true;
    setInputValue("contentSeatCapacity", defaults.seatCapacity ?? "");
    setInputValue("contentAccessType", defaults.accessType || "");
    setInputValue("contentDeliveryMode", defaults.deliveryMode || "");
    if (itemKind && defaults.itemKind) itemKind.value = defaults.itemKind;
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

  list.innerHTML = matches.map(renderRecordPill).join("");
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
  fillSelect(document.getElementById("contentStatus"), state.options.statuses || [], "draft");
  fillSelect(document.getElementById("contentVisibility"), state.options.visibilityValues || [], "private");
  fillSelect(document.getElementById("contentItemKind"), state.options.itemKinds || [], "Shop Product");
  fillCategorySelect(document.getElementById("contentCategoryId"));

  document.getElementById("itemSpecificFields")?.classList.toggle("hidden", recordType !== "item");
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

function publicationApprovalRequired() {
  return isShopProductSelected() ||
    document.getElementById("contentWebsiteVisible")?.checked === true;
}

function updateSaveWorkflow() {
  const actionButton = document.getElementById("saveContinueContentBtn");
  const note = document.getElementById("contentSaveWorkflowNote");
  const isProduct = isShopProductSelected();
  const websiteVisible = document.getElementById("contentWebsiteVisible")?.checked === true;
  const needsApproval = isProduct || websiteVisible;
  if (actionButton) {
    actionButton.textContent = needsApproval ? "Save and send for approval" : "Save and set active";
  }
  if (!note) return;

  const messages = [
    "Save keeps the current workflow state. Save and set active makes non-public content active immediately.",
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
  if (needsApproval) {
    messages.push(
      "The approval action saves this as Awaiting approval; " +
      "it does not publish the requested visibility yet.",
    );
  }
  note.innerHTML = messages.map((message) => `<p>${escapeHTML(message)}</p>`).join("");
}

function productRelationPayload() {
  if (!isShopProductSelected()) return null;

  return {
    existingProductId: document.getElementById("contentExistingProductId")?.value || "",
    productId: document.getElementById("contentProductId")?.value || "",
    linkRole: document.getElementById("contentProductLinkRole")?.value || "Represents",
    sku: document.getElementById("contentProductSku")?.value || "",
    productType: state.editingRecord?.productType || state.editingRecord?.firebaseType || "",
    shopStatus: document.getElementById("contentProductShopStatus")?.value || "draft",
    effectiveShopPrice: optionalNumberFromInput("contentProductPrice"),
    stock: optionalNumberFromInput("contentProductStock"),
    visible: document.getElementById("contentProductVisible")?.checked === true,
    featured: document.getElementById("contentProductFeatured")?.checked === true,
    archived: document.getElementById("contentProductArchived")?.checked === true,
    requiresShipping: document.getElementById("contentRequiresShipping")?.checked === true,
    inventoryTracked: document.getElementById("contentInventoryTracked")?.checked === true,
    activePriceId: state.editingRecord?.activePriceId || "",
    variants: parseProductVariants(document.getElementById("contentProductVariants")?.value),
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
  const visible = productRelation.visible === true;
  const inventoryTracked = productRelation.inventoryTracked === true;
  const variants = productRelation.variants || record?.variants || [];
  const recordType = currentRecordType();
  const linkedItemCount = hiddenRelationshipIds("contentLinkedItemIds").length;
  const linkedBlueprintCount = hiddenRelationshipIds("contentLinkedBlueprintIds").length;
  const linkedPlanCount = hiddenRelationshipIds("contentLinkedPlanIds").length;

  if (relationships) {
    relationships.innerHTML = recordType !== "item" ? [
      summaryCard("Reusable Items", `${linkedItemCount} selected`, linkedItemCount ? "ok" : "default"),
      summaryCard("Blueprint components", `${linkedBlueprintCount} selected`, linkedBlueprintCount ? "ok" : "default"),
      summaryCard("Related Plans", `${linkedPlanCount} linked`, linkedPlanCount ? "ok" : "default"),
      summaryCard("Tags", selectedTagsFromControls().join(", ") || "No tags"),
    ].join("") : isShopProduct ? [
      summaryCard("Linked product", productId || "No linked product", productId ? "ok" : "warning"),
      summaryCard("Price", moneyLabel(price), price ? "ok" : "warning"),
      summaryCard("Variants", variants.length ? `${variants.length} variants` : "No variants"),
      summaryCard(
        "Inventory",
        inventoryTracked ? "Tracked" : "Not tracked",
        inventoryTracked ? "ok" : "default",
      ),
      summaryCard(
        "Assets",
        record?.assets?.length ? `${record.assets.length} linked` : "No linked assets",
        record?.assets?.length ? "ok" : "warning",
      ),
      summaryCard("Relationship health", record?.relationshipHealth || "Not checked"),
    ].join("") : [
      summaryCard("Shop product", "No"),
      summaryCard("Product relationship", "Hidden because this item is not selected as a shop product", "ok"),
      summaryCard(
        "Assets",
        record?.assets?.length ? `${record.assets.length} linked` : "No linked assets",
        record?.assets?.length ? "ok" : "warning",
      ),
    ].join("");
  }

  if (review) {
    review.innerHTML = recordType !== "item" ? [
      summaryCard("Name", document.getElementById("contentName")?.value || record?.name || ""),
      summaryCard("Type", document.getElementById("contentType")?.value || record?.type || ""),
      summaryCard("Status", document.getElementById("contentStatus")?.value || record?.status || "draft"),
      summaryCard("Visibility", document.getElementById("contentVisibility")?.value || record?.visibility || "private"),
      summaryCard("Items", `${linkedItemCount}`),
      summaryCard("Blueprints / related Plans", `${linkedBlueprintCount} / ${linkedPlanCount}`),
    ].join("") : [
      summaryCard("Name", document.getElementById("contentName")?.value || record?.name || ""),
      summaryCard("Status", document.getElementById("contentStatus")?.value || record?.status || "draft"),
      summaryCard(
        "Shop status",
        isShopProduct
          ? productRelation.shopStatus || record?.productShopStatus || record?.shopStatus || "draft"
          : "N/A",
      ),
      summaryCard(
        "Marketplace",
        isShopProduct ? visible ? "Visible" : "Hidden" : "Not a shop product",
        isShopProduct && visible ? "ok" : "default",
      ),
      summaryCard(
        "Shipping",
        isShopProduct && productRelation.requiresShipping ? "Requires shipping" : "No shipping required",
      ),
      summaryCard(
        "Archived",
        isShopProduct && productRelation.archived ? "Archived" : "Not archived",
        isShopProduct && productRelation.archived ? "warning" : "ok",
      ),
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
    setSelectValue("contentStatus", requestedStatus === "awaiting-approval" ? "review" : requestedStatus);
  }
  if (params.get("visibility")) setSelectValue("contentVisibility", params.get("visibility"));
  if (params.get("category")) setSelectValue("contentCategoryId", params.get("category"));
  if (params.get("tag")) renderTagControls([params.get("tag")]);
  if (recordType === "item") {
    setCheckboxValue("contentIsShopProduct", params.get("product") === "1");
    setCheckboxValue("contentWebsiteVisible", params.get("websiteVisible") === "1");
    setCheckboxValue("contentProductFeatured", params.get("featured") === "1");
    setCheckboxValue("contentInventoryTracked", params.get("inventoryTracked") === "1");
    applyTemplateDrivenItemFields(selectedTemplate()?.defaults || {});
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
  setSelectValue("contentStatus", record.status);
  setSelectValue("contentVisibility", record.visibility || "private");

  setInputValue("contentName", record.name);
  setInputValue("contentId", record.id);
  setInputValue("contentShortDescription", record.shortDescription);
  setInputValue("contentLongDescription", record.longDescription);
  renderTagControls(record.tags || []);

  if (recordType === "item") {
    setSelectValue("contentItemKind", record.itemKind);
    setSelectValue("contentCategoryId", record.categoryId);
    setCheckboxValue("contentWebsiteVisible", record.websiteVisible || record.requestedWebsiteVisible);
    setCheckboxValue("contentIsShopProduct", record.isShopProduct);
    setCheckboxValue("contentSoldByRecoveryTools", record.soldByRecoveryTools !== false);
    setCheckboxValue("contentRequiresShipping", record.requiresShipping);
    setCheckboxValue("contentInventoryTracked", record.inventoryTracked);
    setCheckboxValue("contentRequiresCalendar", record.requiresCalendar);
    setCheckboxValue("contentRequiresSessionTime", record.requiresSessionTime);
    setCheckboxValue("contentTracksSeats", record.tracksSeats);
    setCheckboxValue("contentUnlocksAccess", record.unlocksAccess);
    setCheckboxValue("contentIssuesCertificate", record.issuesCertificate);
    setInputValue("contentSeatCapacity", record.seatCapacity || "");
    setInputValue("contentAccessType", record.accessType);
    setInputValue("contentDeliveryMode", record.deliveryMode);
    setInputValue("contentEventStartAt", record.eventStartAt);
    setInputValue("contentEventEndAt", record.eventEndAt);
    setInputValue("contentEventLocation", record.eventLocation);
    setInputValue("contentInstructor", record.instructor);
    setInputValue("contentCertificateName", record.certificateName);
    applyTemplateDrivenItemFields(selectedTemplate()?.defaults || {});
    setInputValue("contentProductId", record.productId || record.itemProductId || "");
    renderExistingProductOptions(record.productId || record.itemProductId || "");
    setSelectValue("contentProductLinkRole", record.productLinkRole || "Represents");
    setInputValue("contentProductSku", record.productSku);
    setSelectValue("contentProductShopStatus", record.productShopStatus || record.shopStatus || "draft");
    setInputValue("contentProductPrice", record.productEffectiveShopPrice || record.productPrice || "");
    setInputValue("contentProductStock", record.productStock ?? 0);
    setCheckboxValue(
      "contentProductVisible",
      record.productVisible || record.requestedProductVisible || record.isShopProduct,
    );
    setCheckboxValue("contentProductFeatured", record.productFeatured);
    setCheckboxValue("contentProductArchived", record.productArchived);
    setInputValue("contentProductVariants", serializeProductVariants(record.variants || []));
    updateProductRelationStatus(record);
    renderCurrentAssets(record);
  } else {
    setCheckboxValue("contentCreatesProduct", record.createsProduct || !!record.productId);
    setInputValue("contentLinkedItemIds", (record.linkedItemIds || []).join(", "));
    setInputValue("contentLinkedBlueprintIds", (record.linkedBlueprintIds || []).join(", "));
    setInputValue("contentLinkedPlanIds", (record.linkedPlanIds || []).join(", "));
    setInputValue("contentAudience", record.audience);
    setInputValue("contentGoal", record.goal);
    setInputValue("contentProductId", record.productId || "");
    renderExistingProductOptions(record.productId || "");
    setSelectValue("contentProductLinkRole", record.productLinkRole || "Represents");
    setInputValue("contentProductSku", record.productSku);
    setSelectValue("contentProductShopStatus", record.productShopStatus || record.shopStatus || "draft");
    setInputValue("contentProductPrice", record.productEffectiveShopPrice || record.productPrice || "");
    setInputValue("contentProductStock", record.productStock ?? 0);
    setCheckboxValue("contentProductVisible", record.productVisible || record.requestedProductVisible);
    setCheckboxValue("contentProductFeatured", record.productFeatured);
    setCheckboxValue("contentProductArchived", record.productArchived);
    setInputValue("contentProductVariants", serializeProductVariants(record.variants || []));
    updateProductRelationStatus(record);
  }

  renderRelationshipPickers();

  state.currentStep = 2;
  state.isDirty = false;
  updateEditBanner();
  renderBuilderSummaries(record);
  showBuilderStep(2);
  renderSimilarList();
}

function applyBuilderRoute() {
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
  const selectedType = normalizedType(document.getElementById("contentType")?.value);
  document.querySelectorAll(".builder-filter-btn").forEach((button) => {
    const filterType = button.dataset.builderType || "";
    const isActive = button.dataset.builderFilter === recordType &&
      (filterType
        ? normalizedType(filterType) === selectedType
        : !(recordType === "plan" && selectedType === "campaign"));
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
  const linkedTableOptions = ["", "Items", "Blueprints", "Plans", "Assets", "Tags", "Categories"];
  if (linkedTable && !linkedTableOptions.includes(linkedTable)) linkedTableOptions.push(linkedTable);
  const sortOrder = Number(field.sortOrder || 0) || 1;
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
          MinEntries
          <input
            class="template-field-min-entries mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            type="number"
            min="0"
            value="${field.minEntries ?? ""}"
          >
        </label>
        <label class="block">
          MaxEntries
          <input
            class="template-field-max-entries mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            type="number"
            min="0"
            value="${field.maxEntries ?? ""}"
            ${field.allowUnlimited ? "disabled" : ""}
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
      <div class="mt-3 flex flex-wrap gap-4">
        <label class="inline-flex items-center gap-2">
          <input class="template-field-required accent-[#407471]" type="checkbox" ${field.required ? "checked" : ""}>
          Required
        </label>
        <label class="inline-flex items-center gap-2">
          <input
            class="template-field-repeatable accent-[#407471]"
            type="checkbox"
            ${field.repeatable ? "checked" : ""}
          >
          Repeatable
        </label>
        <label class="inline-flex items-center gap-2">
          <input
            class="template-field-allow-unlimited accent-[#407471]"
            type="checkbox"
            ${field.allowUnlimited ? "checked" : ""}
          >
          AllowUnlimited
        </label>
      </div>
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
      const minEntries = minValue === "" ? null : Number(minValue);
      const maxEntries = maxValue === "" ? null : Number(maxValue);
      const allowUnlimited = row.querySelector(".template-field-allow-unlimited")?.checked === true;
      const sortOrder = Number(row.querySelector(".template-field-sort-order")?.value || 0);
      const idSlug = String(name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const id = row.querySelector(".template-field-id")?.value || `${variantId || templateId}-FIELD-${idSlug}`;
      if (!name || !key) throw new Error("Every template field needs a name and field key.");
      if (fieldType.startsWith("Linked ") && !linkedTable) {
        throw new Error(`Choose a LinkedTable for "${name}".`);
      }
      if (!Number.isInteger(sortOrder) || sortOrder < 1) {
        throw new Error(`SortOrder for "${name}" must be a positive whole number.`);
      }
      if (minEntries !== null && (!Number.isInteger(minEntries) || minEntries < 0)) {
        throw new Error(`MinEntries for "${name}" must be zero or a positive whole number.`);
      }
      if (maxEntries !== null && (!Number.isInteger(maxEntries) || maxEntries < 0)) {
        throw new Error(`MaxEntries for "${name}" must be zero or a positive whole number.`);
      }
      if (!allowUnlimited && minEntries !== null && maxEntries !== null && maxEntries < minEntries) {
        throw new Error(`MaxEntries cannot be less than MinEntries for "${name}".`);
      }
      return {
        id,
        key,
        name,
        fieldType,
        linkedTable,
        required: row.querySelector(".template-field-required")?.checked === true,
        repeatable: row.querySelector(".template-field-repeatable")?.checked === true,
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
    };
    const linkedTable = row.querySelector(".template-field-linked-table");
    if (linkedTable) linkedTable.value = linkedDefaults[event.target.value] || "";
  }
  if (event.target.classList.contains("template-field-allow-unlimited")) {
    const maxEntries = row.querySelector(".template-field-max-entries");
    if (maxEntries) {
      maxEntries.disabled = event.target.checked;
      if (event.target.checked) maxEntries.value = "";
    }
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
          <div class="flex items-start justify-between gap-3">
            <div>
              <h5 class="font-semibold text-white">Fields for this variant</h5>
              <p class="mt-1 text-xs text-gray-400">Each field is shown only when this variant is selected.</p>
            </div>
            <button type="button" class="add-template-field rounded border border-[#407471] px-3 py-2 text-xs text-white hover:bg-[#407471]/20">Add field</button>
          </div>
          <div class="template-field-rows mt-3 space-y-3">${fields.map(templateFieldRowMarkup).join("")}</div>
          <p class="template-field-empty-state mt-3 text-xs text-gray-500 ${fields.length ? "hidden" : ""}">No extra fields. The standard fields for this entity type will still be shown.</p>
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
  setSelectValue("templateCategoryId", defaults.categoryId);
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
  setInputValue("templateSeatCapacity", defaults.seatCapacity ?? "");
  setInputValue("templateAccessType", defaults.accessType || "");
  setInputValue("templateDeliveryMode", defaults.deliveryMode || "");

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
  setSelectValue("templateCategoryId", document.getElementById("contentCategoryId")?.value);
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
  fillCategorySelect(document.getElementById("templateCategoryId"), true);
  updateGeneratedTemplateId();
}

async function uploadContentAsset() {
  const files = [...(document.getElementById("contentAssetFile")?.files || [])];
  const title = document.getElementById("contentAssetTitle")?.value || "";

  return Promise.all(files.map(async (file, index) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const fileRef = ref(storage, `content-builder/assets/${Date.now()}-${index + 1}-${safeName}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    const type = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : "document";
    return {
      url,
      type,
      title: title || file.name,
      purpose: selectedTemplate()?.name || "Primary Asset",
    };
  }));
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

function originalTemplateAssetIds() {
  if (!state.editingRecord) return [];
  const values = templateFieldValuesForRecord(state.editingRecord);
  return uniqueValues(templateAssetLinksFromBuilder(values).map((link) => link.assetId));
}

async function formPayload(confirmDuplicate = false) {
  const templateFieldValues = templateFieldValuesFromBuilder({ validate: true });
  const recordType = document.getElementById("contentRecordType")?.value || "item";
  const templateId = document.getElementById("contentTemplate")?.value || "";
  if (["item", "blueprint", "plan"].includes(recordType) && !templateId) {
    throw new Error("Choose or create a template before building this record.");
  }
  validateTemplateDrivenItemFields();
  const uploadedAssets = state.editingRecord ? [] : await uploadContentAsset();
  const productRelation = productRelationPayload();
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
    itemKind: document.getElementById("contentItemKind")?.value || "",
    categoryId: document.getElementById("contentCategoryId")?.value || "",
    websiteVisible: document.getElementById("contentWebsiteVisible")?.checked === true,
    isShopProduct: document.getElementById("contentIsShopProduct")?.checked === true,
    createsProduct: isShopProductSelected(),
    soldByRecoveryTools: document.getElementById("contentSoldByRecoveryTools")?.checked !== false,
    requiresShipping: document.getElementById("contentRequiresShipping")?.checked === true,
    inventoryTracked: document.getElementById("contentInventoryTracked")?.checked === true,
    requiresCalendar: document.getElementById("contentRequiresCalendar")?.checked === true,
    requiresSessionTime: document.getElementById("contentRequiresSessionTime")?.checked === true,
    tracksSeats: document.getElementById("contentTracksSeats")?.checked === true,
    unlocksAccess: document.getElementById("contentUnlocksAccess")?.checked === true,
    requiresLocation: selectedTemplate()?.defaults?.requiresLocation === true,
    requiresInstructor: selectedTemplate()?.defaults?.requiresInstructor === true,
    issuesCertificate: document.getElementById("contentIssuesCertificate")?.checked === true,
    seatCapacity: Number(document.getElementById("contentSeatCapacity")?.value || 0) || null,
    accessType: document.getElementById("contentAccessType")?.value || "",
    deliveryMode: document.getElementById("contentDeliveryMode")?.value || "",
    eventStartAt: document.getElementById("contentEventStartAt")?.value || "",
    eventEndAt: document.getElementById("contentEventEndAt")?.value || "",
    eventLocation: document.getElementById("contentEventLocation")?.value || "",
    instructor: document.getElementById("contentInstructor")?.value || "",
    certificateName: document.getElementById("contentCertificateName")?.value || "",
    uploadedAssets,
    assetTitle: document.getElementById("contentAssetTitle")?.value || "",
    assetPurpose: selectedTemplate()?.name || "",
    linkedItemIds: [
      ...splitCsv(document.getElementById("contentLinkedItemIds")?.value),
      ...blueprintItemIds,
    ],
    linkedBlueprintIds: [...new Set(linkedBlueprintIds)],
    linkedPlanIds: splitCsv(document.getElementById("contentLinkedPlanIds")?.value),
    audience: document.getElementById("contentAudience")?.value || "",
    goal: document.getElementById("contentGoal")?.value || "",
    intendedOutput: templateInput("contentIntendedOutput"),
    durationMinutes: Number(templateInput("contentDurationMinutes") || 0) || null,
    sizeLabel: templateInput("contentSizeLabel"),
    startDate: templateInput("contentStartDate"),
    endDate: templateInput("contentEndDate"),
    sku: productRelation?.sku || "",
    productId: productRelation?.productId || "",
    price: productRelation?.effectiveShopPrice ?? null,
    stockQty: productRelation?.stock ?? null,
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
    hasAssetTemplateFields: selectedAssetTemplateFields().length > 0,
    templateAssetLinks: templateAssetLinksFromBuilder(templateFieldValues),
    originalTemplateAssetIds: originalTemplateAssetIds(),
    confirmDuplicate,
  };
}

function templatePayload() {
  const recordType = document.getElementById("templateRecordType")?.value || "item";
  const defaults = {
    categoryId: document.getElementById("templateCategoryId")?.value || "",
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
    defaults.seatCapacity = Number(document.getElementById("templateSeatCapacity")?.value || 0) || null;
    defaults.accessType = document.getElementById("templateAccessType")?.value || "";
    defaults.deliveryMode = document.getElementById("templateDeliveryMode")?.value || "";
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

async function savePayload(payload) {
  const saveButton = document.getElementById("saveContentBuilderBtn");
  saveButton?.setAttribute("disabled", "disabled");
  try {
    if (state.editingRecord) {
      await updateContentControlRecord({
        recordType: state.editingRecord.recordType,
        recordId: state.editingRecord.id,
        updates: payload,
      });
      showToast("Content record updated.", "success");
      state.isDirty = false;
      await loadData();
      return;
    }

    const res = await createContentBuilderRecord(payload);
    if (res.data?.duplicateWarning) {
      showDuplicateWarning(res.data.similar || [], payload);
      showToast("Similar record found. Review before saving.", "error");
      return;
    }

    showToast("Content record saved.", "success");
    document.getElementById("contentBuilderForm")?.reset();
    document.getElementById("contentSoldByRecoveryTools").checked = true;
    renderTagControls([]);
    state.isDirty = false;
    state.duplicateWarningActive = false;
    state.currentStep = 1;
    await loadData();
  } catch (err) {
    console.error("Failed to save content record:", err);
    showToast(err.message || "Failed to save content record.", "error");
  } finally {
    saveButton?.removeAttribute("disabled");
  }
}

function applySaveAction(payload, action = "save") {
  if (!publicationApprovalRequired()) {
    return action === "promote" ? { ...payload, status: "active" } : payload;
  }

  const requestedWebsiteVisible = payload.websiteVisible === true;
  const requestedProductVisible = payload.productRelation?.visible === true || payload.shopVisible === true;
  const isApprovalRequest = action === "promote";
  const editingActiveRecord = state.editingRecord?.status === "active";
  if (!isApprovalRequest && editingActiveRecord) return payload;

  return {
    ...payload,
    status: isApprovalRequest ? "review" : "draft",
    approvalStatus: isApprovalRequest ? "awaiting-approval" : "draft",
    publishRequested: isApprovalRequest,
    requestedWebsiteVisible,
    requestedProductVisible,
    websiteVisible: false,
    shopVisible: false,
    shopStatus: isApprovalRequest ? "review" : "draft",
    productRelation: payload.productRelation
      ? {
        ...payload.productRelation,
        visible: false,
        shopStatus: isApprovalRequest ? "review" : "draft",
      }
      : null,
  };
}

async function buildAndSavePayload(confirmDuplicate = false, action = "save") {
  try {
    const payload = await formPayload(confirmDuplicate);
    await savePayload(applySaveAction(payload, action));
  } catch (err) {
    console.error("Failed to prepare content record:", err);
    showToast(err.message || "Check the form values and try again.", "error");
  }
}

async function saveTemplate() {
  const saveButton = document.querySelector("#contentTemplateForm button[type='submit']");
  try {
    const previouslySelectedId = selectedTemplate()?.id || "";
    const payload = templatePayload();
    saveButton?.setAttribute("disabled", "disabled");
    if (saveButton) saveButton.textContent = "Saving template...";
    const response = await upsertContentBuilderTemplate(payload);
    const savedTemplate = response.data?.template;
    const definitions = response.data?.definitions || [];
    if (!savedTemplate || !definitions.length) {
      throw new Error("The template was saved without returned variant definitions.");
    }

    addSavedTemplatesToState(definitions);
    const selectedDefinition = definitions.find((definition) => definition.id === previouslySelectedId) ||
      definitions.find((definition) => definition.isDefault) ||
      definitions[0];
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
    showToast(err.message || "Failed to save template.", "error");
  } finally {
    saveButton?.removeAttribute("disabled");
    if (saveButton) saveButton.textContent = "Save template";
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
    updateTemplatesForType();
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
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !document.getElementById("contentTemplateToolSection")?.classList.contains("hidden")
    ) {
      closeTemplateCreator();
    }
  });
  document.getElementById("contentName")?.addEventListener("input", renderSimilarList);
  document.getElementById("addContentTagBtn")?.addEventListener("click", () => addTagRow());
  document.getElementById("contentTagRows")?.addEventListener("change", handleTagRowsChange);
  document.getElementById("contentTagRows")?.addEventListener("input", syncTagInput);
  document.getElementById("contentTagRows")?.addEventListener("click", handleTagRowsClick);
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
      state.isDirty = true;
      renderBuilderSummaries();
    }
  });
  document.getElementById("addCampaignMatchesBtn")?.addEventListener("click", addCampaignMatches);
  document.getElementById("contentIsShopProduct")?.addEventListener("change", () => {
    showBuilderStep(state.currentStep);
    renderBuilderSummaries();
    updateSaveWorkflow();
  });
  document.getElementById("contentCreatesProduct")?.addEventListener("change", () => {
    showBuilderStep(state.currentStep);
    renderBuilderSummaries();
    updateSaveWorkflow();
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
    setCheckboxValue("contentCreatesProduct", false);
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
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      applyTemplateDrivenItemFields();
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
    buildAndSavePayload(false, "promote");
  });

  document.getElementById("confirmDuplicateContentBtn")?.addEventListener("click", () => {
    const payload = state.pendingPayload;
    if (!payload) {
      buildAndSavePayload(true);
      return;
    }
    savePayload({ ...payload, confirmDuplicate: true });
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
