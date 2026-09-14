function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function status(value) {
  return clean(value || "active").toLowerCase();
}

function stringsIn(value, found = []) {
  if (Array.isArray(value)) value.forEach((entry) => stringsIn(entry, found));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => stringsIn(entry, found));
  else if (typeof value === "string" && value.trim()) found.push(value.trim());
  return found;
}

export function resolveWorkshopOperations({
  productId,
  productVariantId,
  accessGrants = [],
  variantLinks = [],
  plans = new Map(),
  blueprints = new Map(),
}) {
  const planGrant = accessGrants.find((grant) =>
    status(grant.status) === "active" && clean(grant.productId) === clean(productId) &&
    (!clean(grant.productVariantId) || clean(grant.productVariantId) === clean(productVariantId)) &&
    status(grant.accessEntityType || grant.accessType) === "plan");
  const planId = clean(planGrant?.accessEntityId || planGrant?.accessId);
  const planVariantId = clean(planGrant?.accessEntityVariantId);
  const plan = plans.get(planId);
  if (plan) {
    const variants = Array.isArray(plan.entityVariants) ? plan.entityVariants : [];
    const planVariant = variants.find((variant) => clean(variant.entityVariantId) === planVariantId) ||
      variants.find((variant) => variant.isDefault === true) || variants[0] || null;
    const references = stringsIn({
      linkedBlueprintIds: plan.linkedBlueprintIds,
      templateFieldValues: plan.templateFieldValues,
      linkedBlueprints: plan.linkedBlueprints,
      variant: planVariant,
    });
    const blueprint = references.map((id) => blueprints.get(id)).find((candidate) =>
      candidate && status(candidate.type || candidate.blueprintType) === "workshop operations");
    if (blueprint) {
      const blueprintVariants = Array.isArray(blueprint.entityVariants) ? blueprint.entityVariants : [];
      const blueprintVariant = blueprintVariants.find((variant) =>
        references.includes(clean(variant.entityVariantId))) ||
        blueprintVariants.find((variant) => variant.isDefault === true) || blueprintVariants[0] || null;
      return {
        blueprint,
        blueprintVariantId: clean(blueprintVariant?.entityVariantId),
        planId,
        planVariantId: clean(planVariant?.entityVariantId),
        source: "workshop-plan",
      };
    }
  }

  // Compatibility for Workshop Operations links created before Plan-owned
  // resolution was introduced. New records should attach the Blueprint to the Plan.
  const legacy = variantLinks.find((link) =>
    status(link.status) === "active" && status(link.linkRole) === "operatedwith" &&
    clean(link.productId) === clean(productId) &&
    (!clean(link.productVariantId) || clean(link.productVariantId) === clean(productVariantId)));
  const blueprint = blueprints.get(clean(legacy?.entityId));
  if (!blueprint || status(blueprint.type || blueprint.blueprintType) !== "workshop operations") return null;
  return {
    blueprint,
    blueprintVariantId: clean(legacy.entityVariantId),
    planId: "",
    planVariantId: "",
    source: "legacy-product-link",
  };
}
