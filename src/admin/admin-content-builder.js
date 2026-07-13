import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { functions, storage } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";

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
    templateDefinitions: {},
    statuses: [],
  },
  records: {
    items: [],
    blueprints: [],
    plans: [],
    campaigns: [],
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
    "1. Type & Template",
    "2. Plan Details",
    "3. Build Plan",
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

function knownContentTags() {
  const allRecords = Object.values(state.records || {}).flatMap((records) => records || []);
  return uniqueValues(allRecords.flatMap((record) => record.tags || []))
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

function fillSelectObjects(select, records, fallback = "") {
  if (!select) return;
  const current = select.value;
  const options = records?.length ? records : fallback ? [{ id: fallback, name: fallback }] : [];
  select.innerHTML = options
    .map((record) => `<option value="${escapeHTML(record.id)}">${escapeHTML(record.name)}</option>`)
    .join("");
  if (options.some((record) => record.id === current)) select.value = current;
}

function fillCategorySelect(select) {
  if (!select) return;
  const current = select.value;
  const options = state.options.categoryOptions || [];
  select.innerHTML = options
    .map((record) => {
      const label = `${record.name} (${record.id})`;
      return `<option value="${escapeHTML(record.id)}">${escapeHTML(label)}</option>`;
    })
    .join("");
  if (options.some((record) => record.id === current)) select.value = current;
}

function templateDefinitions(recordType, typeValue = "") {
  const definitions = state.options.templateDefinitions?.[recordType] || [];
  return definitions.filter((template) => !typeValue || template.appliesTo === typeValue);
}

function selectedTemplate() {
  const recordType = document.getElementById("contentRecordType")?.value || "item";
  const templateId = document.getElementById("contentTemplate")?.value || "";
  return (state.options.templateDefinitions?.[recordType] || [])
    .find((template) => template.id === templateId);
}

function currentRecordType() {
  return document.getElementById("contentRecordType")?.value || "item";
}

function isShopProductSelected() {
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
  if (panel.id === "itemSpecificFields") return recordType === "item";
  if (panel.id === "itemProductRelationshipFields") {
    return recordType === "item" && isShopProductSelected();
  }
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

function renderBlueprintOptions() {
  const blueprints = state.records.blueprints || [];
  if (!blueprints.length) return "";
  return `
    <div class="mt-2 rounded border border-gray-700 bg-gray-950/40 p-2 text-xs text-gray-300">
      <div class="mb-1 font-semibold text-gray-200">Available blueprint IDs</div>
      <div class="max-h-28 space-y-1 overflow-auto">
        ${blueprints.map((record) => `
          <div class="break-all">${escapeHTML(record.id)} - ${escapeHTML(record.name)}</div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderItemProductTemplateFields(template) {
  const defaults = template?.defaults || {};
  const isShopProduct = defaults.isShopProduct === true;
  const requiresShipping = defaults.requiresShipping === true;
  const inventoryTracked = defaults.inventoryTracked === true;

  return `
    <div>
      <h3 class="font-semibold text-white">${escapeHTML(template?.name || "Item template")}</h3>
      <p class="mt-1 text-xs text-gray-300">
        Fill the item identity first, then complete the product, pricing, asset, and inventory fields below.
      </p>
      <div class="mt-3 grid gap-2 text-xs text-gray-300 sm:grid-cols-2">
        <div><strong>Shop product:</strong> ${isShopProduct ? "Yes" : "No"}</div>
        <div><strong>Requires shipping:</strong> ${requiresShipping ? "Yes" : "No"}</div>
        <div><strong>Inventory tracked:</strong> ${inventoryTracked ? "Yes" : "No"}</div>
        <div><strong>Default category:</strong> ${escapeHTML(defaults.categoryId || "-")}</div>
      </div>
    </div>
  `;
}

function renderExercisePlanTemplateFields(template) {
  const defaults = template?.defaults || {};
  return `
    <div>
      <h3 class="font-semibold text-white">${escapeHTML(template?.name || "Exercise plan template")}</h3>
      <p class="mt-1 text-xs text-gray-300">
        Group the plan by blueprint IDs. Use comma separated IDs for each section.
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
        <label class="block">
          Warmup blueprint IDs
          <input
            id="contentWarmupBlueprintIds"
            class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            placeholder="BLUEPRINT-WARMUP-1, BLUEPRINT-WARMUP-2"
          >
        </label>
        <label class="block">
          Main exercise blueprint IDs
          <input
            id="contentMainBlueprintIds"
            class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            placeholder="BLUEPRINT-MAIN-1, BLUEPRINT-MAIN-2"
          >
        </label>
        <label class="block">
          Cooldown blueprint IDs
          <input
            id="contentCooldownBlueprintIds"
            class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            placeholder="BLUEPRINT-COOLDOWN-1"
          >
        </label>
      </div>
      ${renderBlueprintOptions()}
    </div>
  `;
}

function renderBlueprintTemplateFields(template) {
  return `
    <div>
      <h3 class="font-semibold text-white">${escapeHTML(template?.name || "Blueprint template")}</h3>
      <p class="mt-1 text-xs text-gray-300">
        Use this for reusable exercise, recovery, test, or education blocks that plans can link to later.
      </p>
      <div class="mt-3 grid gap-3 md:grid-cols-2">
        <label class="block">
          Intended output
          <input
            id="contentIntendedOutput"
            class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            placeholder="Exercise instruction, warmup, test, cue..."
          >
        </label>
        <label class="block">
          Related item IDs
          <input
            id="contentBlueprintItemIds"
            class="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white"
            placeholder="ITEM-EXAMPLE"
          >
        </label>
      </div>
    </div>
  `;
}

function renderCampaignTemplateFields(template) {
  return `
    <div>
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
    </div>
  `;
}

function renderTemplateGuidedFields() {
  const container = document.getElementById("templateGuidedFields");
  if (!container) return;

  const recordType = document.getElementById("contentRecordType")?.value || "item";
  const template = selectedTemplate();
  if (!template) {
    container.textContent = "Select a template to show the relevant fields.";
    return;
  }

  if (recordType === "item") {
    container.innerHTML = renderItemProductTemplateFields(template);
    return;
  }

  if (recordType === "plan") {
    container.innerHTML = renderExercisePlanTemplateFields(template);
    return;
  }

  if (recordType === "blueprint") {
    container.innerHTML = renderBlueprintTemplateFields(template);
    return;
  }

  container.innerHTML = renderCampaignTemplateFields(template);
}

function applyTemplateDefaults() {
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
    const itemKind = document.getElementById("contentItemKind");
    const categoryId = document.getElementById("contentCategoryId");

    if (shopProduct) shopProduct.checked = defaults.isShopProduct === true;
    if (requiresShipping) requiresShipping.checked = defaults.requiresShipping === true;
    if (inventoryTracked) inventoryTracked.checked = defaults.inventoryTracked === true;
    if (soldByRecoveryTools) soldByRecoveryTools.checked = defaults.soldByRecoveryTools !== false;
    if (requiresCalendar) requiresCalendar.checked = defaults.requiresCalendar === true;
    if (requiresSessionTime) requiresSessionTime.checked = defaults.requiresSessionTime === true;
    if (tracksSeats) tracksSeats.checked = defaults.tracksSeats === true;
    if (itemKind && defaults.itemKind) itemKind.value = defaults.itemKind;
    if (categoryId && defaults.categoryId) categoryId.value = defaults.categoryId;
  }
  renderTemplateGuidedFields();
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
  if (!cleanQuery) return [];

  return records
    .filter((record) => {
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

function renderReferenceGroup(title, records) {
  const visibleRecords = records.slice(0, 12);
  const content = visibleRecords.length
    ? visibleRecords.map(renderRecordPill).join("")
    : "<p class=\"text-xs text-gray-500\">No records yet.</p>";

  return `
    <div>
      <h4 class="mb-2 text-sm font-semibold text-white">${escapeHTML(title)} (${records.length})</h4>
      <div class="space-y-2">
        ${content}
      </div>
    </div>
  `;
}

function renderReferenceLists() {
  const container = document.getElementById("contentReferenceLists");
  if (!container) return;
  container.innerHTML = [
    renderReferenceGroup("Items", state.records.items || []),
    renderReferenceGroup("Blueprints", state.records.blueprints || []),
    renderReferenceGroup("Plans", state.records.plans || []),
  ].join("");
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
}

function updateEditBanner() {
  const banner = document.getElementById("contentBuilderEditBanner");
  const title = document.getElementById("contentBuilderEditTitle");
  const meta = document.getElementById("contentBuilderEditMeta");
  const saveButton = document.getElementById("saveContentBuilderBtn");
  const saveContinueButton = document.getElementById("saveContinueContentBtn");
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
  if (saveButton) saveButton.textContent = record ? "Save changes" : "Save draft";
  if (saveContinueButton) {
    saveContinueButton.textContent = record ? "Save changes and continue" : "Save and continue";
  }
  if (idInput) {
    idInput.readOnly = !!record;
    idInput.classList.toggle("opacity-70", !!record);
  }
  if (recordTypeSelect) {
    recordTypeSelect.disabled = !!record;
    recordTypeSelect.classList.toggle("opacity-70", !!record);
  }
}

function productRelationPayload() {
  const recordType = document.getElementById("contentRecordType")?.value || "item";
  if (recordType !== "item") return null;
  if (!isShopProductSelected()) return null;

  return {
    productId: document.getElementById("contentProductId")?.value || "",
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

function updateProductRelationStatus(record) {
  const status = document.getElementById("contentProductRelationStatus");
  if (!status) return;
  const productId = record?.productId || record?.itemProductId || "";
  status.textContent = productId ? `Linked: ${productId}` : "No linked product";
  status.classList.toggle("bg-green-900/60", !!productId);
  status.classList.toggle("text-green-200", !!productId);
  status.classList.toggle("bg-gray-800", !productId);
  status.classList.toggle("text-gray-300", !productId);
}

function renderCurrentAssets(record) {
  const list = document.getElementById("contentCurrentAssetsList");
  if (!list) return;
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

  if (relationships) {
    relationships.innerHTML = isShopProduct ? [
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
    review.innerHTML = [
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

function clearEditMode() {
  state.editingRecord = null;
  document.getElementById("contentBuilderForm")?.reset();
  document.getElementById("contentSoldByRecoveryTools").checked = true;
  renderTagControls([]);
  state.currentStep = 1;
  state.isDirty = false;
  updateEditBanner();
  updateFormForRecordType();
  history.pushState({}, "", "/admin/builder");
}

function populateBuilderFromRecord(record) {
  const recordType = singularRecordType(record.recordType);
  state.editingRecord = { ...record, recordType };

  setSelectValue("contentRecordType", recordType);
  updateFormForRecordType();
  setSelectValue("contentType", record.type || record.itemType);
  updateTemplatesForType();
  setSelectValue("contentTemplate", record.templateId || record.template);
  setSelectValue("contentStatus", record.status);

  setInputValue("contentName", record.name);
  setInputValue("contentId", record.id);
  setInputValue("contentShortDescription", record.shortDescription);
  setInputValue("contentLongDescription", record.longDescription);
  renderTagControls(record.tags || []);

  if (recordType === "item") {
    setSelectValue("contentItemKind", record.itemKind);
    setSelectValue("contentCategoryId", record.categoryId);
    setCheckboxValue("contentWebsiteVisible", record.websiteVisible);
    setCheckboxValue("contentIsShopProduct", record.isShopProduct);
    setCheckboxValue("contentSoldByRecoveryTools", record.soldByRecoveryTools !== false);
    setCheckboxValue("contentRequiresShipping", record.requiresShipping);
    setCheckboxValue("contentInventoryTracked", record.inventoryTracked);
    setCheckboxValue("contentRequiresCalendar", record.requiresCalendar);
    setCheckboxValue("contentRequiresSessionTime", record.requiresSessionTime);
    setCheckboxValue("contentTracksSeats", record.tracksSeats);
    setInputValue("contentSeatCapacity", record.seatCapacity || "");
    setInputValue("contentProductId", record.productId || record.itemProductId || "");
    setInputValue("contentProductSku", record.productSku);
    setSelectValue("contentProductShopStatus", record.productShopStatus || record.shopStatus || "draft");
    setInputValue("contentProductPrice", record.productEffectiveShopPrice || record.productPrice || "");
    setInputValue("contentProductStock", record.productStock ?? 0);
    setCheckboxValue("contentProductVisible", record.productVisible || record.isShopProduct);
    setCheckboxValue("contentProductFeatured", record.productFeatured);
    setCheckboxValue("contentProductArchived", record.productArchived);
    setInputValue("contentProductVariants", serializeProductVariants(record.variants || []));
    updateProductRelationStatus(record);
    renderCurrentAssets(record);
  } else {
    setInputValue("contentLinkedItemIds", (record.linkedItemIds || []).join(", "));
    setInputValue("contentLinkedBlueprintIds", (record.linkedBlueprintIds || []).join(", "));
    setInputValue("contentLinkedPlanIds", (record.linkedPlanIds || []).join(", "));
    setInputValue("contentAudience", record.audience);
    setInputValue("contentGoal", record.goal);
  }

  state.currentStep = 2;
  state.isDirty = false;
  updateEditBanner();
  renderBuilderSummaries(record);
  showBuilderStep(2);
  renderSimilarList();
}

function applyBuilderRoute() {
  const params = new URLSearchParams(window.location.search);
  const recordId = params.get("id") || "";
  const recordType = params.get("type") || "";
  if (!recordId || !recordType) return;

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
    });
  });
}

function setupTemplateToolToggle() {
  const button = document.getElementById("toggleTemplateToolBtn");
  const section = document.getElementById("contentTemplateToolSection");
  if (!button || !section || button.dataset.bound === "true") return;
  button.dataset.bound = "true";
  button.addEventListener("click", () => {
    const willOpen = section.classList.contains("hidden");
    section.classList.toggle("hidden", !willOpen);
    button.textContent = willOpen ? "Close" : "Open";
  });
}

function updateTemplatesForType() {
  const recordType = document.getElementById("contentRecordType")?.value || "item";
  const typeValue = document.getElementById("contentType")?.value || "";
  const templates = templateDefinitions(recordType, typeValue);
  const defaultTemplate = templates.find((template) => template.isDefault) || templates[0];

  fillSelectObjects(
    document.getElementById("contentTemplate"),
    templates,
    defaultTemplate?.id || recordType,
  );
  if (defaultTemplate) {
    document.getElementById("contentTemplate").value = defaultTemplate.id;
  }
  applyTemplateDefaults();
}

function updateTemplateManagerTypeOptions() {
  const recordType = document.getElementById("templateRecordType")?.value || "item";
  fillSelect(
    document.getElementById("templateAppliesTo"),
    state.options[typeOptionsKey(recordType)] || [],
    recordType,
  );
  document.getElementById("itemTemplateDefaults")?.classList.toggle("hidden", recordType !== "item");
  document.getElementById("planTemplateDefaults")?.classList.toggle("hidden", recordType !== "plan");
  document.getElementById("sessionTemplateDefaults")?.classList.toggle(
    "hidden",
    !(recordType === "item" && document.getElementById("templateAppliesTo")?.value === "Session"),
  );
  fillSelect(document.getElementById("templateItemKind"), state.options.itemKinds || [], "Shop Product");
  fillCategorySelect(document.getElementById("templateCategoryId"));
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

async function formPayload(confirmDuplicate = false) {
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
    recordType: document.getElementById("contentRecordType")?.value || "item",
    status: document.getElementById("contentStatus")?.value || "draft",
    name: document.getElementById("contentName")?.value || "",
    type: document.getElementById("contentType")?.value || "",
    template: document.getElementById("contentTemplate")?.value || "",
    id: document.getElementById("contentId")?.value || "",
    shortDescription: document.getElementById("contentShortDescription")?.value || "",
    longDescription: document.getElementById("contentLongDescription")?.value || "",
    notes: document.getElementById("contentLongDescription")?.value || "",
    tags: selectedTagsFromControls(),
    itemKind: document.getElementById("contentItemKind")?.value || "",
    categoryId: document.getElementById("contentCategoryId")?.value || "",
    websiteVisible: document.getElementById("contentWebsiteVisible")?.checked === true,
    isShopProduct: document.getElementById("contentIsShopProduct")?.checked === true,
    soldByRecoveryTools: document.getElementById("contentSoldByRecoveryTools")?.checked !== false,
    requiresShipping: document.getElementById("contentRequiresShipping")?.checked === true,
    inventoryTracked: document.getElementById("contentInventoryTracked")?.checked === true,
    requiresCalendar: document.getElementById("contentRequiresCalendar")?.checked === true,
    requiresSessionTime: document.getElementById("contentRequiresSessionTime")?.checked === true,
    tracksSeats: document.getElementById("contentTracksSeats")?.checked === true,
    seatCapacity: Number(document.getElementById("contentSeatCapacity")?.value || 0) || null,
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
    price: productRelation?.effectiveShopPrice ?? null,
    stockQty: productRelation?.stock ?? null,
    variants: productRelation?.variants || [],
    productRelation,
    templateContent: {
      warmupBlueprintIds,
      mainBlueprintIds,
      cooldownBlueprintIds,
      blueprintItemIds,
    },
    confirmDuplicate,
  };
}

function templatePayload() {
  const recordType = document.getElementById("templateRecordType")?.value || "item";
  const defaults = {};

  if (recordType === "item") {
    defaults.itemKind = document.getElementById("templateItemKind")?.value || "";
    defaults.categoryId = document.getElementById("templateCategoryId")?.value || "";
    defaults.requiresShipping = document.getElementById("templateRequiresShipping")?.checked === true;
    defaults.inventoryTracked = document.getElementById("templateInventoryTracked")?.checked === true;
    defaults.isShopProduct = document.getElementById("templateIsShopProduct")?.checked === true;
    defaults.stockStatus = defaults.inventoryTracked ? "draft" : "not-tracked";
    defaults.requiresCalendar = document.getElementById("templateRequiresCalendar")?.checked === true;
    defaults.requiresSessionTime = defaults.requiresCalendar;
    defaults.tracksSeats = document.getElementById("templateTracksSeats")?.checked === true;
  }

  if (recordType === "plan") {
    const duration = Number(document.getElementById("templateDurationMinutes")?.value || 0);
    defaults.durationMinutes = Number.isFinite(duration) && duration > 0 ? duration : null;
    defaults.sizeLabel = document.getElementById("templateSizeLabel")?.value || "";
  }

  return {
    recordType,
    appliesTo: document.getElementById("templateAppliesTo")?.value || "",
    name: document.getElementById("templateName")?.value || "",
    isDefault: document.getElementById("templateIsDefault")?.checked === true,
    defaults,
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
  const references = document.getElementById("contentReferenceLists");
  if (references) references.textContent = "Loading...";

  const res = await getContentBuilderData();
  state = {
    ...state,
    options: res.data?.options || state.options,
    records: res.data?.records || state.records,
    pendingPayload: null,
  };

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
  renderReferenceLists();
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

async function saveTemplate() {
  try {
    await upsertContentBuilderTemplate(templatePayload());
    showToast("Template saved.", "success");
    document.getElementById("contentTemplateForm")?.reset();
    await loadData();
  } catch (err) {
    console.error("Failed to save content template:", err);
    showToast(err.message || "Failed to save template.", "error");
  }
}

export async function setupContentBuilder() {
  const section = document.getElementById("adminContentBuilderSection");
  if (!section || section.dataset.initialized === "true") return;
  section.dataset.initialized = "true";

  setupBuilderStepControls();
  document.getElementById("contentRecordType")?.addEventListener("change", updateFormForRecordType);
  document.getElementById("newContentBuilderRecordBtn")?.addEventListener("click", clearEditMode);
  setupBuilderFilters();
  setupTemplateToolToggle();
  document.getElementById("contentType")?.addEventListener("change", () => {
    updateTemplatesForType();
    renderSimilarList();
  });
  document.getElementById("contentTemplate")?.addEventListener("change", applyTemplateDefaults);
  document.getElementById("contentName")?.addEventListener("input", renderSimilarList);
  document.getElementById("addContentTagBtn")?.addEventListener("click", () => addTagRow());
  document.getElementById("contentTagRows")?.addEventListener("change", handleTagRowsChange);
  document.getElementById("contentTagRows")?.addEventListener("input", syncTagInput);
  document.getElementById("contentTagRows")?.addEventListener("click", handleTagRowsClick);
  document.getElementById("contentIsShopProduct")?.addEventListener("change", () => {
    showBuilderStep(state.currentStep);
    renderBuilderSummaries();
  });
  document.getElementById("templateRecordType")?.addEventListener("change", updateTemplateManagerTypeOptions);
  document.getElementById("templateAppliesTo")?.addEventListener("change", updateTemplateManagerTypeOptions);
  document.getElementById("refreshContentBuilderBtn")?.addEventListener("click", () => {
    loadData().catch((err) => {
      console.error("Failed to refresh content builder:", err);
      showToast("Failed to refresh content builder.", "error");
    });
  });

  document.getElementById("contentBuilderForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    formPayload(false).then(savePayload);
  });

  document.getElementById("saveContinueContentBtn")?.addEventListener("click", () => {
    formPayload(false).then(savePayload);
  });

  document.getElementById("confirmDuplicateContentBtn")?.addEventListener("click", () => {
    const payload = state.pendingPayload;
    if (!payload) {
      formPayload(true).then(savePayload);
      return;
    }
    savePayload({ ...payload, confirmDuplicate: true });
  });
  document.getElementById("contentTemplateForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveTemplate();
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
