export const cargoCorrectionGroups = [
  {
    key: "consignee",
    label: "Consignee Information",
    fields: [
      { key: "consignee_name", label: "Consignee Name" },
      { key: "company_name", label: "Company Name" },
      { key: "contact_person", label: "Contact Person" },
      { key: "phone_number", label: "Phone Number" },
      { key: "email", label: "Email" }
    ]
  },
  {
    key: "logistics",
    label: "Logistics Information",
    fields: [
      { key: "source_of_cargo", label: "Source of Cargo", type: "select", catalogKey: "cargo_source" },
      { key: "container_number", label: "Container Number" },
      { key: "vehicle_number", label: "Vehicle Number" },
      { key: "delivery_note_number", label: "Delivery Note Number" }
    ]
  },
  {
    key: "cargo",
    label: "Cargo Information",
    fields: [
      { key: "cargo_type", label: "Cargo Type", type: "select", catalogKey: "cargo_type" },
      { key: "packaging_type", label: "Packaging Type", type: "select", catalogKey: "packaging_type" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "weight", label: "Weight", type: "number" },
      { key: "volume", label: "Volume", type: "number" },
      { key: "cargo_description", label: "Cargo Description", type: "textarea" },
      { key: "cargo_condition", label: "Cargo Condition", type: "select", catalogKey: "cargo_condition" },
      { key: "inspection_notes", label: "Inspection Notes", type: "textarea" },
      { key: "hazard_class", label: "Hazard Class", type: "select", catalogKey: "hazard_class", optional: true }
    ]
  }
];

export const cargoCorrectionFields = cargoCorrectionGroups.flatMap((group) => group.fields);

export const cargoCorrectionFieldMap = Object.fromEntries(
  cargoCorrectionFields.map((field) => [field.key, field])
);

export function withAuthoritativeCargoOptions(groups, catalogs = {}) {
  return groups.map((group) => ({
    ...group,
    fields: group.fields.map((field) => field.catalogKey ? {
      ...field,
      options: (catalogs[field.catalogKey] || []).filter((option) => option.active !== false)
        .map((option) => ({ key: option.option_key, value: option.storage_value, label: option.display_label }))
    } : field)
  }));
}

export function normalizeCorrectionDisplayValue(value) {
  if (value === undefined || value === null || value === "") return "Empty";
  return String(value);
}

export function correctionValueChanged(field, original, updated) {
  if (["quantity", "weight", "volume"].includes(field)) {
    const originalNumber = Number(original);
    const updatedNumber = Number(updated);
    if (Number.isFinite(originalNumber) && Number.isFinite(updatedNumber)) {
      return originalNumber !== updatedNumber;
    }
  }
  return String(original ?? "").trim() !== String(updated ?? "").trim();
}
