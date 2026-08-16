const { buildError } = require("../utils/apiError");

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);

const inspectValue = (value, depth = 0, seen = new Set()) => {
  if (depth > 10) throw buildError("Request data is nested too deeply.", 400, undefined, "INPUT_DEPTH_EXCEEDED");
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  const keys = Object.keys(value);
  if (keys.length > 200) throw buildError("Request contains too many properties.", 400, undefined, "INPUT_PROPERTY_LIMIT");
  for (const key of keys) {
    if (forbiddenKeys.has(key)) throw buildError("Request contains a prohibited property.", 400, undefined, "INPUT_PROPERTY_PROHIBITED");
    inspectValue(value[key], depth + 1, seen);
  }
};

const validateRequestShape = (req, _res, next) => {
  try {
    for (const [key, value] of Object.entries(req.query || {})) {
      if (key.length > 100) throw buildError("Query parameter name is too long.", 400, undefined, "QUERY_INVALID");
      const values = Array.isArray(value) ? value : [value];
      if (values.length > 50 || values.some((item) => String(item).length > 1000)) {
        throw buildError("Query parameter is too large.", 400, undefined, "QUERY_INVALID");
      }
    }
    inspectValue(req.body);
    next();
  } catch (error) {
    next(error);
  }
};

const boundedText = (value, label, max, { required = false } = {}) => {
  const text = String(value ?? "").trim();
  if (required && !text) throw buildError(`${label} is required.`, 400);
  if (text.length > max) throw buildError(`${label} must not exceed ${max} characters.`, 400, undefined, "INPUT_LENGTH_EXCEEDED");
  return text;
};

module.exports = { boundedText, validateRequestShape };
