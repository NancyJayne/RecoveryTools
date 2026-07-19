function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function hasTag(record, tag) {
  const wanted = normalized(tag);
  return wanted && (record?.tags || []).some((value) => normalized(value) === wanted);
}

export function selectCampaignMatches(records = {}, tag = "") {
  const blueprintTypes = new Set(["marketing content", "client education", "therapist education"]);
  const itemTypes = new Set(["content", "course", "program", "anato-me", "faq"]);

  return {
    blueprints: (records.blueprints || [])
      .filter((record) => blueprintTypes.has(normalized(record.type)) && hasTag(record, tag)),
    items: (records.items || [])
      .filter((record) => itemTypes.has(normalized(record.type)) && hasTag(record, tag)),
    plans: (records.plans || [])
      .filter((record) => normalized(record.type) === "treatment plan" && hasTag(record, tag)),
  };
}
