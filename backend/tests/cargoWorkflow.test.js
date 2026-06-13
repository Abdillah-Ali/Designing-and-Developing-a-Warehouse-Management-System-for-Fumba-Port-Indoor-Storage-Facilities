const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCargoPayload, normalizeCargoPayload } = require("../services/validationService");
const {
  evaluateDuplicateMatch,
  getDuplicateLockKeys,
  normalizeIdentifier
} = require("../services/cargoDuplicateService");
const { generateCargoIdentifiers } = require("../utils/barcodeGenerator");

const validCargo = {
  consignee_name: "Fumba Trading",
  phone_number: "+255777123456",
  source_of_cargo: "Truck",
  vehicle_number: "T 123 ABC",
  cargo_type: "General Goods",
  packaging_type: "Pallets",
  quantity: 4,
  weight: 250,
  volume: 2,
  cargo_condition: "Good"
};

test("generated cargo identifiers follow the operational format", () => {
  assert.deepEqual(generateCargoIdentifiers(1, new Date("2026-06-11T00:00:00Z")), {
    cargo_id: "CARGO-2026-00001",
    barcode: "CARGO-2026-00001",
    reference_number: "FPWMS-2026-00001"
  });
});

test("normal cargo passes registration validation", () => {
  assert.deepEqual(validateCargoPayload(validCargo), []);
});

test("hazardous cargo requires a real hazard class", () => {
  const errors = validateCargoPayload({
    ...validCargo,
    cargo_type: "Hazardous Cargo",
    hazard_class: ""
  });

  assert.ok(errors.includes("Hazard class is required for hazardous cargo."));
});

test("damaged cargo requires inspection notes", () => {
  const errors = validateCargoPayload({
    ...validCargo,
    cargo_condition: "Damaged",
    inspection_notes: ""
  });

  assert.ok(errors.includes("Inspection notes are required when cargo condition is not Good."));
});

test("non-hazardous normalization clears hazard class", () => {
  const normalized = normalizeCargoPayload({
    ...validCargo,
    hazard_class: "Flammable"
  });

  assert.equal(normalized.hazard_class, null);
});

test("duplicate identifiers ignore spaces, punctuation, and letter case", () => {
  assert.equal(normalizeIdentifier(" tzdl-2026 / 0042 "), "TZDL20260042");

  const match = evaluateDuplicateMatch(
    {
      delivery_note_number: "TZDL-2026/0042",
      container_number: null,
      vehicle_number: "T 123 ABC",
      consignee_name: "Fumba Trading",
      cargo_type: "General Goods"
    },
    {
      delivery_note_number: "tzdl 2026 0042",
      vehicle_number: "T-123-ABC",
      consignee_name: "FUMBA TRADING",
      cargo_type: "General Goods"
    }
  );

  assert.equal(match.isDuplicate, true);
  assert.ok(match.matchingFields.includes("delivery_note_number"));
});

test("vehicle reuse is only blocked with the same consignee and cargo type", () => {
  const differentConsignee = evaluateDuplicateMatch(
    {
      vehicle_number: "T 123 ABC",
      consignee_name: "Fumba Trading",
      cargo_type: "General Goods"
    },
    {
      vehicle_number: "T 123 ABC",
      consignee_name: "Zanzibar Imports",
      cargo_type: "General Goods"
    }
  );
  const sameCargoContext = evaluateDuplicateMatch(
    {
      vehicle_number: "T 123 ABC",
      consignee_name: "Fumba Trading",
      cargo_type: "General Goods"
    },
    {
      vehicle_number: "T-123-ABC",
      consignee_name: " fumba   trading ",
      cargo_type: "general goods"
    }
  );

  assert.equal(differentConsignee.isDuplicate, false);
  assert.equal(sameCargoContext.isDuplicate, true);
});

test("duplicate checks generate stable transaction lock keys", () => {
  assert.deepEqual(
    getDuplicateLockKeys({
      delivery_note_number: "DN-100",
      container_number: "MSCU 1234567",
      vehicle_number: "T 123 ABC",
      consignee_name: "Fumba Trading",
      cargo_type: "General Goods"
    }),
    [
      "cargo:container:MSCU1234567",
      "cargo:delivery:DN100",
      "cargo:vehicle:T123ABC:fumba trading:general goods"
    ]
  );
});
