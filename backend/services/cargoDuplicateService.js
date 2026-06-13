const DUPLICATE_FIELD_LABELS = Object.freeze({
  delivery_note_number: "Delivery Note Number",
  container_number: "Container Number",
  vehicle_number: "Vehicle Number",
  consignee_name: "Consignee Name",
  cargo_type: "Cargo Type"
});

const normalizeIdentifier = (value) => String(value || "")
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, "");

const normalizeText = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/\s+/g, " ");

const normalizedCargoIdentity = (cargo = {}) => ({
  delivery_note_number: normalizeIdentifier(cargo.delivery_note_number),
  container_number: normalizeIdentifier(cargo.container_number),
  vehicle_number: normalizeIdentifier(cargo.vehicle_number),
  consignee_name: normalizeText(cargo.consignee_name),
  cargo_type: normalizeText(cargo.cargo_type)
});

const evaluateDuplicateMatch = (candidate, payload) => {
  const existing = normalizedCargoIdentity(candidate);
  const incoming = normalizedCargoIdentity(payload);
  const matchingFields = Object.keys(DUPLICATE_FIELD_LABELS).filter(
    (field) => incoming[field] && existing[field] === incoming[field]
  );

  const hasStrongIdentifier = matchingFields.includes("delivery_note_number")
    || matchingFields.includes("container_number");
  const hasVehicleContext = [
    "vehicle_number",
    "consignee_name",
    "cargo_type"
  ].every((field) => matchingFields.includes(field));

  return {
    isDuplicate: hasStrongIdentifier || hasVehicleContext,
    matchingFields
  };
};

const getDuplicateLockKeys = (payload) => {
  const identity = normalizedCargoIdentity(payload);
  const keys = [];

  if (identity.delivery_note_number) {
    keys.push(`cargo:delivery:${identity.delivery_note_number}`);
  }
  if (identity.container_number) {
    keys.push(`cargo:container:${identity.container_number}`);
  }
  if (identity.vehicle_number && identity.consignee_name && identity.cargo_type) {
    keys.push(
      `cargo:vehicle:${identity.vehicle_number}:${identity.consignee_name}:${identity.cargo_type}`
    );
  }

  return [...new Set(keys)].sort();
};

const findPossibleDuplicateCargo = async (executor, payload, { lock = false } = {}) => {
  if (lock) {
    for (const key of getDuplicateLockKeys(payload)) {
      await executor.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    }
  }

  const identity = normalizedCargoIdentity(payload);
  const result = await executor.query(
    `SELECT
       id,
       cargo_id,
       barcode,
       delivery_note_number,
       container_number,
       vehicle_number,
       consignee_name,
       cargo_type,
       registration_status,
       placement_status,
       created_at
     FROM cargo
     WHERE is_deleted = FALSE
       AND registration_status IN ('Pending Review', 'Correction Required', 'Approved')
       AND placement_status <> 'Dispatched'
       AND (
         ($1 <> '' AND UPPER(REGEXP_REPLACE(BTRIM(delivery_note_number), '[^[:alnum:]]', '', 'g')) = $1)
         OR ($2 <> '' AND UPPER(REGEXP_REPLACE(BTRIM(container_number), '[^[:alnum:]]', '', 'g')) = $2)
         OR (
           $3 <> ''
           AND $4 <> ''
           AND $5 <> ''
           AND UPPER(REGEXP_REPLACE(BTRIM(vehicle_number), '[^[:alnum:]]', '', 'g')) = $3
           AND LOWER(REGEXP_REPLACE(BTRIM(consignee_name), '[[:space:]]+', ' ', 'g')) = $4
           AND LOWER(REGEXP_REPLACE(BTRIM(cargo_type), '[[:space:]]+', ' ', 'g')) = $5
         )
       )
     ORDER BY created_at DESC, id DESC
     LIMIT 10`,
    [
      identity.delivery_note_number,
      identity.container_number,
      identity.vehicle_number,
      identity.consignee_name,
      identity.cargo_type
    ]
  );

  return result.rows
    .map((candidate) => {
      const match = evaluateDuplicateMatch(candidate, payload);
      if (!match.isDuplicate) return null;
      return {
        ...candidate,
        matching_fields: match.matchingFields,
        matching_field_labels: match.matchingFields.map(
          (field) => DUPLICATE_FIELD_LABELS[field]
        )
      };
    })
    .filter(Boolean);
};

module.exports = {
  DUPLICATE_FIELD_LABELS,
  evaluateDuplicateMatch,
  findPossibleDuplicateCargo,
  getDuplicateLockKeys,
  normalizeIdentifier,
  normalizeText
};
