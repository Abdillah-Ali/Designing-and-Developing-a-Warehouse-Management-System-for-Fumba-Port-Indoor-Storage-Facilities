// Keep the browser copy in sync; inputValidation.test.js verifies parity.
const EMAIL_MESSAGE = "Enter a valid email address, such as name@example.com (maximum 150 characters).";
const PHONE_MESSAGE = "Enter a Tanzanian number such as 0751234567 or +255751234567. For other countries, include + and the country code (8–15 digits).";
const isEmail = (value) => {
  if (typeof value !== "string") return false;
  const email = value.trim();
  if (email.length > 150 || email.split("@").length !== 2) return false;
  const [local, domain] = email.split("@");
  if (!local || local.length > 64 || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)
      || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
    && /^[A-Za-z]{2,63}$/.test(labels[labels.length - 1]);
};
const isPhone = (value) => {
  if (typeof value !== "string") return false;
  const phone = value.trim();
  if (phone.length > 40 || !/^\+?\d+(?:[ -]\d+)*$/.test(phone)) return false;
  const compact = phone.replace(/[ -]/g, "");
  if (compact.startsWith("+255")) return /^\+255[267]\d{8}$/.test(compact);
  if (compact.startsWith("255")) return /^255[267]\d{8}$/.test(compact);
  if (compact.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(compact);
  return /^0[267]\d{8}$/.test(compact);
};
const textLimits = Object.freeze({consignee_name:150, company_name:150, contact_person:150,
  phone_number:40, email:150, source_of_cargo:80, container_number:80, vehicle_number:80,
  cargo_description:5000, cargo_type:100, packaging_type:80, cargo_condition:80, hazard_class:80,
  inspection_notes:5000, delivery_note_number:120});
const isPositiveDecimal = (value) => (typeof value === "string" || typeof value === "number")
  && /^\d+(?:\.\d{1,2})?$/.test(String(value).trim())
  && Number(value) > 0 && Number(value) <= 9999999999.99;
const cargoInputErrors = (payload) => {
  const errors = [];
  for (const [key, max] of Object.entries(textLimits)) {
    const value = payload[key];
    const label = key.replace(/_/g, " ");
    if (value == null || value === "") continue;
    if (typeof value !== "string" || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value)) errors.push({field:key,message:`${label} must contain valid text.`});
    else if (value.trim().length > max) errors.push({field:key,message:`${label} must not exceed ${max} characters.`});
  }
  if (payload.email != null && payload.email !== "" && !isEmail(payload.email)) errors.push({field:"email",message:EMAIL_MESSAGE});
  if (payload.phone_number != null && payload.phone_number !== "" && !isPhone(payload.phone_number)) errors.push({field:"phone_number",message:PHONE_MESSAGE});
  for (const key of ["quantity", "weight", "volume"]) {
    if (payload[key] != null && payload[key] !== "" && !isPositiveDecimal(payload[key])) errors.push({field:key,message:`${key} must be greater than zero, no more than 9,999,999,999.99, and have at most two decimal places.`});
  }
  return errors;
};
const userInputErrors = (payload, {create = true} = {}) => {
  const errors = [];
  if (typeof payload.full_name !== "string" || payload.full_name.trim().length < 2 || payload.full_name.trim().length > 150 || /[\x00-\x1F\x7F]/.test(payload.full_name)) errors.push("Full name must be 2–150 characters without control characters.");
  if (typeof payload.username !== "string" || !/^[A-Za-z0-9._-]{3,50}$/.test(payload.username.trim())) errors.push("Username must be 3–50 characters using letters, numbers, dots, underscores, or hyphens.");
  if (!isEmail(payload.email)) errors.push(EMAIL_MESSAGE);
  if (!isPhone(payload.phone_number)) errors.push(PHONE_MESSAGE);
  if (create || payload.password !== undefined && payload.password !== "") {
    if (typeof payload.password !== "string" || new TextEncoder().encode(payload.password).length > 72 || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(payload.password)) errors.push("Password must have at least 8 characters, uppercase, lowercase, number, and special character, and use at most 72 UTF-8 bytes.");
  }
  return errors;
};
module.exports = {EMAIL_MESSAGE, PHONE_MESSAGE, isEmail, isPhone, textLimits, isPositiveDecimal, cargoInputErrors, userInputErrors};
