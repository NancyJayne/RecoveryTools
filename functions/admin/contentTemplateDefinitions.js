function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalType(value) {
  const normalized = cleanString(value).toLowerCase().replace(/\s+/g, " ");
  const aliases = {
    "exercise plan": "recovery plan",
    "marketing campaign plan": "campaign",
  };
  return aliases[normalized] || normalized;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstOption(value, fallback = "") {
  return cleanString(value).split("/").map((part) => part.trim()).filter(Boolean)[0] || fallback;
}

function markDefaultPerType(definitions) {
  const defaultTypes = new Set();
  definitions.forEach((definition) => {
    if (definition.isDefault === true) defaultTypes.add(definition.appliesTo);
  });
  definitions.forEach((definition) => {
    if (defaultTypes.has(definition.appliesTo)) return;
    definition.isDefault = true;
    defaultTypes.add(definition.appliesTo);
  });
  return definitions;
}

function normalizedField(doc) {
  const data = doc.data ? doc.data() : doc;
  return {
    id: doc.id || data.id || data.fieldId,
    key: cleanString(data.key),
    name: cleanString(data.name || data.fieldName),
    fieldType: cleanString(data.fieldType),
    linkedTable: cleanString(data.linkedTable),
    required: data.required === true,
    repeatable: data.repeatable === true,
    minEntries: numberOrNull(data.minEntries),
    maxEntries: numberOrNull(data.maxEntries),
    allowUnlimited: data.allowUnlimited === true,
    sortOrder: numberOrNull(data.sortOrder) ?? 0,
    notes: cleanString(data.notes),
  };
}

function sortedDefinitions(definitions) {
  return markDefaultPerType(definitions.filter(Boolean).sort((left, right) =>
    left.appliesTo.localeCompare(right.appliesTo) ||
    left.sortOrder - right.sortOrder ||
    left.name.localeCompare(right.name),
  ));
}

function inheritedValue(variant, template, key, fallback = "") {
  if (Object.prototype.hasOwnProperty.call(variant, key)) return variant[key];
  if (Object.prototype.hasOwnProperty.call(template, key)) return template[key];
  return fallback;
}

async function loadUnifiedTemplateDefinitions(db) {
  const [templatesSnapshot, variantsSnapshot, fieldsSnapshot] = await Promise.all([
    db.collection("contentTemplates").get(),
    db.collection("contentTemplateVariants").get(),
    db.collection("contentTemplateFields").get(),
  ]);
  if (templatesSnapshot.empty || variantsSnapshot.empty) return null;

  const templatesById = new Map(templatesSnapshot.docs.map((doc) => [
    doc.id,
    { id: doc.id, ...doc.data() },
  ]));
  const fieldsByVariantId = new Map();
  fieldsSnapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    const variantId = cleanString(data.variantId);
    if (!variantId) return;
    const rows = fieldsByVariantId.get(variantId) || [];
    rows.push(normalizedField(doc));
    fieldsByVariantId.set(variantId, rows);
  });

  const grouped = { item: [], blueprint: [], plan: [] };
  variantsSnapshot.docs.forEach((doc) => {
    const variant = { id: doc.id, ...doc.data() };
    const template = templatesById.get(cleanString(variant.templateId));
    const recordType = cleanString(template?.templateArea).toLowerCase();
    const appliesTo = canonicalType(template?.appliesTo);
    if (!grouped[recordType] || !template || template.active === false || variant.active === false || !appliesTo) {
      return;
    }

    const inventoryTracked = inheritedValue(variant, template, "inventoryTracked", false) === true;
    const fields = (fieldsByVariantId.get(doc.id) || [])
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
    grouped[recordType].push({
      id: doc.id,
      templateId: template.id,
      variantId: doc.id,
      templateName: cleanString(template.name) || template.id,
      name: cleanString(variant.name) || doc.id,
      recordType,
      appliesTo,
      isDefault: template.isDefault === true && variant.isDefault === true,
      source: "workbook",
      description: cleanString(variant.description || template.description),
      sortOrder: numberOrNull(variant.sortOrder) ?? 0,
      defaults: {
        templateId: template.id,
        [`${recordType}TemplateId`]: template.id,
        templateVariantId: doc.id,
        type: appliesTo,
        ownerType: firstOption(template.ownerType, "Recovery Tools"),
        approvalStatus: firstOption(template.approvalStatus, "Draft"),
        visibility: firstOption(template.visibility, "Private"),
        isShopProduct: inheritedValue(variant, template, "isShopProduct", false) === true,
        requiresShipping: inheritedValue(variant, template, "requiresShipping", false) === true,
        inventoryTracked,
        soldByRecoveryTools: inheritedValue(variant, template, "soldByRecoveryTools", true) !== false,
        unlocksAccess: inheritedValue(variant, template, "unlocksAccess", false) === true,
        accessType: cleanString(inheritedValue(variant, template, "accessType")),
        requiresCalendar: inheritedValue(variant, template, "requiresCalendar", false) === true,
        requiresSessionTime:
          inheritedValue(variant, template, "requiresSessionTime", false) === true,
        tracksSeats: inheritedValue(variant, template, "tracksSeats", false) === true,
        seatCapacity: numberOrNull(inheritedValue(variant, template, "seatCapacity", null)),
        deliveryMode: cleanString(inheritedValue(variant, template, "deliveryMode")),
        requiresLocation: inheritedValue(variant, template, "requiresLocation", false) === true,
        requiresInstructor: inheritedValue(variant, template, "requiresInstructor", false) === true,
        issuesCertificate: inheritedValue(variant, template, "issuesCertificate", false) === true,
        stockStatus: inventoryTracked ? "draft" : "not-tracked",
        durationMinutes: numberOrNull(inheritedValue(variant, template, "durationMinutes", null)),
        sizeLabel: cleanString(inheritedValue(variant, template, "sizeLabel")),
        fields,
      },
    });
  });

  return {
    item: sortedDefinitions(grouped.item),
    blueprint: sortedDefinitions(grouped.blueprint),
    plan: sortedDefinitions(grouped.plan),
  };
}

export async function loadItemTemplateDefinitions(db) {
  const [templatesSnapshot, variantsSnapshot] = await Promise.all([
    db.collection("itemTemplates").get(),
    db.collection("itemTemplateVariants").get(),
  ]);
  const templatesById = new Map(templatesSnapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
  return sortedDefinitions(variantsSnapshot.docs.map((doc) => {
    const variant = { id: doc.id, ...doc.data() };
    const template = templatesById.get(cleanString(variant.itemTemplateId));
    const appliesTo = canonicalType(template?.type);
    if (!template || template.active === false || variant.active === false || !appliesTo) return null;
    const inventoryTracked = variant.inventoryTracked === true;
    return {
      id: doc.id,
      templateId: template.id,
      variantId: doc.id,
      templateName: cleanString(template.name) || template.id,
      name: cleanString(variant.name) || doc.id,
      recordType: "item",
      appliesTo,
      isDefault: variant.isDefault === true,
      source: "workbook-legacy",
      description: cleanString(variant.description || template.description),
      sortOrder: numberOrNull(variant.sortOrder) ?? 0,
      defaults: {
        itemTemplateId: template.id,
        templateVariantId: doc.id,
        type: appliesTo,
        itemKind: cleanString(variant.itemKind),
        isShopProduct: variant.isShopProduct === true,
        requiresShipping: variant.requiresShipping === true,
        inventoryTracked,
        stockStatus: inventoryTracked ? "draft" : "not-tracked",
        soldByRecoveryTools: variant.soldByRecoveryTools !== false,
        unlocksAccess: variant.unlocksAccess === true,
        accessType: cleanString(variant.accessType),
        requiresCalendar: variant.requiresCalendar === true,
        requiresSessionTime: variant.requiresSessionTime === true,
        tracksSeats: variant.tracksSeats === true,
        deliveryMode: cleanString(variant.deliveryMode),
        fields: [],
      },
    };
  }));
}

export async function loadBlueprintTemplateDefinitions(db) {
  const [templatesSnapshot, variantsSnapshot, fieldsSnapshot] = await Promise.all([
    db.collection("blueprintTemplates").get(),
    db.collection("blueprintTemplateVariants").get(),
    db.collection("blueprintTemplateFields").get(),
  ]);
  const fieldsByTemplateId = new Map();
  fieldsSnapshot.docs.forEach((doc) => {
    const templateId = cleanString(doc.data()?.blueprintTemplateId);
    if (!templateId) return;
    const fields = fieldsByTemplateId.get(templateId) || [];
    fields.push(normalizedField(doc));
    fieldsByTemplateId.set(templateId, fields);
  });
  const templatesById = new Map(templatesSnapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
  return sortedDefinitions(variantsSnapshot.docs.map((doc) => {
    const variant = { id: doc.id, ...doc.data() };
    const template = templatesById.get(cleanString(variant.blueprintTemplateId));
    const appliesTo = canonicalType(template?.type);
    if (!template || template.active === false || variant.active === false || !appliesTo) return null;
    return {
      id: doc.id,
      templateId: template.id,
      variantId: doc.id,
      templateName: cleanString(template.name) || template.id,
      name: cleanString(variant.name) || doc.id,
      recordType: "blueprint",
      appliesTo,
      isDefault: variant.isDefault === true,
      source: "workbook-legacy",
      description: cleanString(variant.description || template.description),
      sortOrder: numberOrNull(variant.sortOrder) ?? 0,
      defaults: {
        blueprintTemplateId: template.id,
        templateVariantId: doc.id,
        type: appliesTo,
        ownerType: firstOption(template.ownerType, "Recovery Tools"),
        approvalStatus: firstOption(template.approvalStatus, "Draft"),
        visibility: firstOption(template.visibility, "Private"),
        fields: (fieldsByTemplateId.get(template.id) || [])
          .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)),
      },
    };
  }));
}

function slotAsField(doc) {
  const slot = { id: doc.id, ...doc.data() };
  const details = [
    slot.allowedBlueprintType ? `Blueprint type: ${slot.allowedBlueprintType}` : "",
    slot.allowedBlueprintTemplateId ? `Template: ${slot.allowedBlueprintTemplateId}` : "",
    cleanString(slot.notes),
  ].filter(Boolean).join("; ");
  return {
    id: slot.id,
    name: [cleanString(slot.sectionName), cleanString(slot.slotName)].filter(Boolean).join(" - ") || slot.id,
    fieldType: "Linked Blueprint List",
    linkedTable: "Blueprints",
    required: slot.required === true,
    repeatable: slot.allowUnlimited === true || numberOrNull(slot.maxBlueprints) !== 1,
    minEntries: numberOrNull(slot.minBlueprints),
    maxEntries: numberOrNull(slot.maxBlueprints),
    allowUnlimited: slot.allowUnlimited === true,
    sortOrder: numberOrNull(slot.sortOrder) ?? 0,
    notes: details,
  };
}

export async function loadPlanTemplateDefinitions(db) {
  const [templatesSnapshot, variantsSnapshot, slotsSnapshot] = await Promise.all([
    db.collection("planTemplates").get(),
    db.collection("planTemplateVariants").get(),
    db.collection("planTemplateSlots").get(),
  ]);
  const templatesById = new Map(templatesSnapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
  const fieldsByVariantId = new Map();
  slotsSnapshot.docs.forEach((doc) => {
    if (doc.data()?.active === false) return;
    const variantId = cleanString(doc.data()?.variantId);
    if (!variantId) return;
    const rows = fieldsByVariantId.get(variantId) || [];
    rows.push(slotAsField(doc));
    fieldsByVariantId.set(variantId, rows);
  });
  return sortedDefinitions(variantsSnapshot.docs.map((doc) => {
    const variant = { id: doc.id, ...doc.data() };
    const template = templatesById.get(cleanString(variant.planTemplateId));
    const appliesTo = canonicalType(template?.type);
    if (!template || template.active === false || variant.active === false || !appliesTo) return null;
    return {
      id: doc.id,
      templateId: template.id,
      variantId: doc.id,
      templateName: cleanString(template.name) || template.id,
      name: cleanString(variant.name) || doc.id,
      recordType: "plan",
      appliesTo,
      isDefault: variant.isDefault === true,
      source: "workbook-legacy",
      description: cleanString(variant.description || template.description),
      sortOrder: numberOrNull(variant.sortOrder) ?? 0,
      defaults: {
        planTemplateId: template.id,
        templateVariantId: doc.id,
        type: appliesTo,
        durationMinutes: numberOrNull(variant.durationMinutes),
        sizeLabel: cleanString(variant.sizeLabel),
        fields: (fieldsByVariantId.get(doc.id) || [])
          .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)),
      },
    };
  }));
}

export async function loadContentTemplateDefinitions(db) {
  const unified = await loadUnifiedTemplateDefinitions(db);
  if (unified) return unified;
  const [item, blueprint, plan] = await Promise.all([
    loadItemTemplateDefinitions(db),
    loadBlueprintTemplateDefinitions(db),
    loadPlanTemplateDefinitions(db),
  ]);
  return { item, blueprint, plan };
}
