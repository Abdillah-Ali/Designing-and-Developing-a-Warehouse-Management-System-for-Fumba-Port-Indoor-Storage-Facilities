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
  if (status === "Maintenance") return "warning";
  if (status === "Approved" || status === "Issued") return "registered";
  if (status === "Placed" || status === "Relocated") return "success";
  if (status === "Blocked" || status === "Rejected" || status === "Cancelled" || status === "On Hold") return "destructive";
  if (status === "Correction Required" || status === "Documents Required" || status === "Partially Paid" || status === "Outstanding" || status === "Overdue") return "warning";
  if (status === "Dispatched" || status === "Released" || status === "Emergency Released") return "released";
  if (status === "Unplaced" || status === "Unbilled" || status === "Unpaid") return "pending";
  if (status === "Cleared" || status === "Paid" || status === "Fully Paid" || status === "Completed") return "success";
  if (status === "Inspection In Progress") return "info";
  if (status.includes("Pending")) return "pending";
  if (status === "Dispatch Pending") return "info";
  return "muted";
}

export {
  formatCount,
  formatDateTime,
  formatMeasure,
  getErrorMessage,
  statusTone
};
