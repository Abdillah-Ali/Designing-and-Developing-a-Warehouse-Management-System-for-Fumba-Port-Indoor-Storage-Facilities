export function getSystemReadinessPresentation(readiness) {
  if (!readiness) return null;
  if (readiness.overall === "configuration_required") {
    return { tone: "warning", title: "Configuration required", backendOnline: true };
  }
  if (readiness.overall === "blocked") {
    return { tone: "destructive", title: "Operations blocked", backendOnline: true };
  }
  return { tone: "success", title: "Operations ready", backendOnline: true };
}
