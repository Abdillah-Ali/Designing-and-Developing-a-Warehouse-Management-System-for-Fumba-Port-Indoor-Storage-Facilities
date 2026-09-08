const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isEmail, isPhone, isPositiveDecimal, cargoInputErrors, userInputErrors } = require("../utils/inputValidation");

test("browser and server validation rules stay identical", () => {
  const backend = fs.readFileSync(path.join(__dirname, "../utils/inputValidation.js"), "utf8");
  const frontend = fs.readFileSync(path.join(__dirname, "../../frontend/src/lib/input-validation.js"), "utf8");
  assert.equal(frontend, backend.replace("module.exports = {", "export {"));
});
test("email rejects malformed domains, dot errors, wrong types and oversized addresses", () => {
  for (const value of ["a@b..com", "a..b@example.com", ".a@example.com", "a.@example.com", "a@-example.com", "a@example-.com", "a@b", "a b@example.com", ["a@example.com"], "a".repeat(65) + "@example.com"]) assert.equal(isEmail(value), false, String(value));
  for (const value of ["name@example.com", " First.Last+port@sub.example.co.tz ", "o'neil@example.com"]) assert.equal(isEmail(value), true, value);
});
test("contact phones require actual digit counts and explicit international format", () => {
  for (const value of ["1------1", "12345678", "075123456", "07512345678", "+255123456789", "075ABC4567", "++255751234567", "1+255751234567", "+1234567890123456", true, ["0751234567"]]) assert.equal(isPhone(value), false, String(value));
  for (const value of ["0751234567", "0221234567", "+255751234567", "255751234567", "+255 751 234 567", "0751-234-567", "+442079460958"]) assert.equal(isPhone(value), true, value);
});
test("cargo decimals reject coercion, overflow, rounding to zero and excess precision", () => {
  for (const value of [true, [], [1], {}, "Infinity", Infinity, "1e3", "0x10", "0", -1, "0.001", "1.234", "10000000000", ""]) assert.equal(isPositiveDecimal(value), false, String(value));
  for (const value of [1, "0.01", "1.25", "9999999999.99"]) assert.equal(isPositiveDecimal(value), true);
});
test("cargo reports field-specific type, length, email and phone errors", () => {
  const errors = cargoInputErrors({ consignee_name: {}, company_name: "x".repeat(151), email: "a@b..com", phone_number: "1------1", weight: true });
  for (const field of ["consignee_name", "company_name", "email", "phone_number", "weight"]) assert.ok(errors.some((error) => error.field === field));
  assert.deepEqual(cargoInputErrors({ consignee_name: "Port Customer", phone_number: "0751234567", quantity: 1, weight: "0.01", volume: "1.20", email: "" }), []);
});
test("user validation preserves names and enforces password byte limits", () => {
  const payload = {full_name:"Asha O’Neil", username:"asha.oneil", email:"asha@example.com", phone_number:"0751234567", password:"Secure@123"};
  assert.deepEqual(userInputErrors(payload), []);
  assert.ok(userInputErrors({...payload, password:"Secure@123" + "é".repeat(32)}).some((error) => error.includes("72")));
  assert.ok(userInputErrors({...payload, full_name:"A\nB"}).length);
  const {password, ...existing} = payload;
  assert.deepEqual(userInputErrors(existing, {create:false}), []);
  assert.ok(userInputErrors(existing).length);
});
