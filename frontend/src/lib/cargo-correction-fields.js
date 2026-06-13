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
      { key: "source_of_cargo", label: "Source of Cargo", type: "select", options: ["Container", "Truck", "Ship Transfer", "Manual Delivery", "Customs Hold Release", "Other"] },
      { key: "container_number", label: "Container Number" },
      { key: "vehicle_number", label: "Vehicle Number" },
      { key: "delivery_note_number", label: "Delivery Note Number" }
    ]
  },
  {
    key: "cargo",
    label: "Cargo Information",
    fields: [
      { key: "cargo_type", label: "Cargo Type", type: "select", options: ["General Goods", "Electronics", "Machinery", "Food Products", "Construction Materials", "Fragile Goods", "Hazardous Cargo", "Mixed Cargo"] },
      { key: "packaging_type", label: "Packaging Type", type: "select", options: ["Boxes", "Cartons", "Pallets", "Crates", "Bags", "Drums", "Loose Cargo", "Containerized", "Other"] },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "weight", label: "Weight", type: "number" },
      { key: "volume", label: "Volume", type: "number" },
      { key: "cargo_description", label: "Cargo Description", type: "textarea" },
      { key: "cargo_condition", label: "Cargo Condition", type: "select", options: ["Good", "Damaged", "Wet", "Leaking", "Broken Packaging", "Requires Inspection"] },
      { key: "inspection_notes", label: "Inspection Notes", type: "textarea" },
      { key: "hazard_class", label: "Hazard Class", type: "select", options: ["", "Flammable", "Corrosive", "Explosive", "Toxic", "Oxidizing", "Compressed Gas", "Radioactive", "Other Hazardous"] }
    ]
  }
];

export const cargoCorrectionFields = cargoCorrectionGroups.flatMap((group) => group.fields);

export const cargoCorrectionFieldMap = Object.fromEntries(
  cargoCorrectionFields.map((field) => [field.key, field])
);

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
