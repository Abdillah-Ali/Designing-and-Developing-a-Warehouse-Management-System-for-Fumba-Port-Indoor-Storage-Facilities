const padSequence = (value) => String(value).padStart(5, "0");

const generateCargoIdentifiers = (sequenceValue, date = new Date()) => {
  const year = date.getFullYear();
  const sequence = padSequence(sequenceValue);
  const cargoId = `CARGO-${year}-${sequence}`;

  return {
    cargo_id: cargoId,
    barcode: cargoId,
    reference_number: `FPWMS-${year}-${sequence}`
  };
};

module.exports = {
  generateCargoIdentifiers
};
