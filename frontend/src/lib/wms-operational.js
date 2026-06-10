function getErrorMessage(error) {
  if (error?.errors?.length) return error.errors.join(" ");
  return error?.message || "Data is unavailable.";
}

function formatDateTime(value) {
  if (!value) return "Not recorded";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";

  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function formatMeasure(value, unit) {
  if (value === undefined || value === null || value === "") return "No data";
  const number = Number(value);
  if (!Number.isFinite(number)) return "No data";
  return `${number.toLocaleString()} ${unit}`;
}

function formatCount(value) {
  if (value === undefined || value === null || value === "") return "No data";
  const number = Number(value);
  if (!Number.isFinite(number)) return "No data";
  return number.toLocaleString();
}

function statusTone(status) {
  if (!status) return "muted";
  if (status === "active") return "success";
  if (status === "inactive") return "muted";
  if (status === "suspended") return "destructive";
  if (status === "Available" || status === "Occupied") return "success";
  if (status === "Reserved") return "pending";
  if (status === "Registered") return "registered";
  if (status === "Stored") return "success";
  if (status === "Blocked") return "destructive";
  if (status === "Released") return "released";
  if (status.includes("Pending")) return "pending";
  if (status === "Ready for Dispatch") return "info";
  return "muted";
}

export {
  formatCount,
  formatDateTime,
  formatMeasure,
  getErrorMessage,
  statusTone
};
