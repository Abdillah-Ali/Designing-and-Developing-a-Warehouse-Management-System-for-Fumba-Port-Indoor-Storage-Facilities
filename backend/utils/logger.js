const sanitizeValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Error) {
    return {
      name: value.name,
      category: value.code || value.statusCode || "error"
    };
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/password|token|secret|sql|query|params|credential/i.test(key))
        .map(([key, entry]) => [key, sanitizeValue(entry)])
    );
  }
  return value;
};

const logEvent = (level, event = {}) => {
  const payload = sanitizeValue({
    operation: event.operation || "backend_operation",
    cargo_reference: event.cargo_reference,
    notification_reference: event.notification_reference,
    result: event.result || (level === "error" ? "failure" : "success"),
    error_category: event.error_category,
    timestamp: new Date().toISOString()
  });

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
};

module.exports = {
  logEvent
};
