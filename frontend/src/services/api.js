import { getStoredAuthToken, setStoredAuthToken, setStoredPermissions, clearStoredAuthToken } from "@/lib/portal-access";

const getDefaultApiBaseUrl = () => {
  if (typeof window === "undefined") {
    return "http://localhost:5000/api";
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${window.location.hostname}:5000/api`;
};

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || getDefaultApiBaseUrl();
const SERVER_CONNECTION_ERROR = "Unable to connect to the server. Please try again later.";
const LOGIN_ERROR_MESSAGES = Object.freeze({
  AUTHENTICATION_UNAVAILABLE: "Authentication service is currently unavailable.",
  DATABASE_UNAVAILABLE: "Unable to access system services. Please contact the administrator.",
  INVALID_CREDENTIALS: "Invalid username or password.",
  UNEXPECTED: "An unexpected error occurred. Please try again."
});
let refreshPromise = null;

const refreshAccessToken = async () => {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false || !payload.token) {
        throw buildApiError("Your session has expired. Please sign in again.", { status: response.status, code: payload.code });
      }
      setStoredAuthToken(payload.token);
      return payload.token;
    }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
};

const buildApiError = (message, details = {}) => {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
};

const getLoginErrorMessage = (response, payload = {}) => {
  if (response.status === 401) {
    return LOGIN_ERROR_MESSAGES.INVALID_CREDENTIALS;
  }

  if (response.status === 429 && payload.message) {
    return payload.message;
  }

  if (response.status === 503) {
    return payload.message === LOGIN_ERROR_MESSAGES.DATABASE_UNAVAILABLE
      ? LOGIN_ERROR_MESSAGES.DATABASE_UNAVAILABLE
      : LOGIN_ERROR_MESSAGES.AUTHENTICATION_UNAVAILABLE;
  }

  if (response.status === 502 || response.status === 504) {
    return LOGIN_ERROR_MESSAGES.AUTHENTICATION_UNAVAILABLE;
  }

  if (response.status >= 500) {
    return LOGIN_ERROR_MESSAGES.UNEXPECTED;
  }

  return payload.message || LOGIN_ERROR_MESSAGES.UNEXPECTED;
};

const request = async (path, options = {}, retried = false) => {
  const headers = new Headers(options.headers || {});
  let body = options.body;

  if (body && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  // Get JWT token and send it in Authorization header
  const token = getStoredAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: "include",
      headers,
      body
    });
  } catch (error) {
    throw new Error(SERVER_CONNECTION_ERROR);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.success === false) {
    if (response.status === 401 && !retried && path !== "/auth/refresh" && getStoredAuthToken()) {
      try {
        await refreshAccessToken();
        return request(path, options, true);
      } catch {
        clearStoredAuthToken();
        throw buildApiError("Your session has expired. Please sign in again.", { status: 401, code: "AUTH_SESSION_EXPIRED" });
      }
    }
    if (response.status === 401) clearStoredAuthToken();

    throw buildApiError(payload.message || "Request could not be completed.", {
      errors: payload.errors,
      code: payload.code,
      details: payload.details,
      status: response.status
    });
  }

  return payload;
};

const buildQuerySuffix = (params = {}) => {
  const search = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null) {
          search.append(key, String(item));
        }
      });
      return;
    }
    search.set(key, String(value));
  });

  const query = search.toString();
  return query ? `?${query}` : "";
};

// Authentication endpoints
export const login = async (username, password) => {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });
  } catch (error) {
    throw new Error(SERVER_CONNECTION_ERROR);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.success === false) {
    throw buildApiError(getLoginErrorMessage(response, payload), {
      errors: payload.errors,
      code: payload.code,
      details: payload.details,
      status: response.status
    });
  }

  if (payload.data?.token) {
    setStoredAuthToken(payload.data.token);
    setStoredPermissions(payload.data.permissions || []);
  }

  return payload;
};

export const logout = async () => {
  try {
    await request("/auth/logout", { method: "POST" });
  } catch (error) {
    // Continue with logout even if API call fails
  } finally {
    // Clear token from storage
    clearStoredAuthToken();
  }
};

export const getBootstrapOptions = () => request("/bootstrap/options");
export const getSetupStatus = () => request("/bootstrap/status");

export const createFirstSystemAdmin = (payload) => request("/bootstrap/create-admin", {
  method: "POST",
  body: payload
});

export const getCargo = (params = {}) => {
  return request(`/cargo${buildQuerySuffix(params)}`);
};

export const getCargoById = (id) => request(`/cargo/${encodeURIComponent(id)}`);
export const getMyCargoSubmissions = () => request("/cargo/my/submissions");
export const getMyPlacementHistory = () => request("/cargo/my/placement-history");
export const getMyUploadedDocuments = () => request("/cargo/my/documents");
export const getMyBarcodePrintLogs = () => request("/cargo/my/barcode-prints");

export const createCargo = (payload) => request("/cargo", {
  method: "POST",
  body: payload
});

export const updateCargo = (id, payload) => request(`/cargo/${encodeURIComponent(id)}`, {
  method: "PUT",
  body: payload
});

export const updateCargoStatus = (id, payload) => request(`/cargo/${encodeURIComponent(id)}/status`, {
  method: "PATCH",
  body: payload
});

export const resubmitCargo = (id, remarks = "") => request(`/cargo/${encodeURIComponent(id)}/resubmit`, {
  method: "POST",
  body: { remarks }
});

export const getCargoDocuments = (id) => request(`/cargo/${encodeURIComponent(id)}/documents`);
export const getCargoDocumentContent = (id, documentId) => request(
  `/cargo/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/content`
);

export const uploadCargoDocument = (id, payload) => request(`/cargo/${encodeURIComponent(id)}/documents`, {
  method: "POST",
  body: payload
});

export const printCargoBarcode = (id) => request(`/cargo/${encodeURIComponent(id)}/print-barcode`, {
  method: "POST"
});

export const deleteCargo = (id, reason = "") => request(`/cargo/${encodeURIComponent(id)}`, {
  method: "DELETE",
  body: { reason }
});

export const getZones = (params = {}) => {
  return request(`/zones${buildQuerySuffix(params)}`);
};
export const getZoneById = (id) => request(`/zones/${encodeURIComponent(id)}`);
export const getRacks = (zoneId) => request(`/racks/by-zone/${encodeURIComponent(zoneId)}`);
export const getAllRacks = () => request("/racks");
export const getRackById = (id) => request(`/racks/${encodeURIComponent(id)}`);
export const getLevels = (rackId) => request(`/levels/by-rack/${encodeURIComponent(rackId)}`);
export const getAllLevels = () => request("/levels");
export const getLevelById = (id) => request(`/levels/${encodeURIComponent(id)}`);
export const getBins = (levelId) => request(`/bins/by-level/${encodeURIComponent(levelId)}`);
export const getAllBins = (params = {}) => {
  return request(`/bins${buildQuerySuffix(params)}`);
};
export const getBinById = (id) => request(`/bins/${encodeURIComponent(id)}`);
export const printBinBarcode = (id) => request(`/bins/${encodeURIComponent(id)}/print-barcode`, {
  method: "POST"
});

export const getUsers = (params = {}) => {
  return request(`/users${buildQuerySuffix(params)}`);
};
export const getSystemAdministratorCapacity = () => request("/users/administrator-capacity");

export const getCargoRegistrationForm = () => request("/cargo-registration-form");
export const getAvailableCargoRegistrationFields = () => request("/cargo-registration-form/available");
export const validateCargoRegistrationForm = (fields) => request("/cargo-registration-form/validate", {
  method: "POST",
  body: { fields }
});
export const updateCargoRegistrationForm = (fields) => request("/cargo-registration-form", {
  method: "PUT",
  body: { fields }
});
export const resetCargoRegistrationForm = () => request("/cargo-registration-form/reset", {
  method: "POST"
});

export const getUserById = (id) => request(`/users/${encodeURIComponent(id)}`);
export const getUserPendingTasks = (id) => request(`/users/${encodeURIComponent(id)}/pending-tasks`);
export const reassignUserPendingTasks = (id, payload) => request(`/users/${encodeURIComponent(id)}/reassign-tasks`, {
  method: "POST",
  body: payload
});

export const createUser = (payload) => request("/users", {
  method: "POST",
  body: payload
});

export const createScanner = (payload) => request("/users/scanners", {
  method: "POST",
  body: payload
});

export const updateUser = (id, payload) => request(`/users/${encodeURIComponent(id)}`, {
  method: "PUT",
  body: payload
});

export const deleteUser = (id) => request(`/users/${encodeURIComponent(id)}`, {
  method: "DELETE"
});

export const updateUserStatus = (id, status) => request(`/users/${encodeURIComponent(id)}/status`, {
  method: "PATCH",
  body: { status }
});

export const resetUserPassword = (id, password) => request(`/users/${encodeURIComponent(id)}/reset-password`, {
  method: "PATCH",
  body: { password }
});

export const deactivateUser = (id) => request(`/users/${encodeURIComponent(id)}/deactivate`, {
  method: "PATCH"
});

export const getRoles = () => request("/roles");
export const getMe = () => request("/auth/me");
export const getMyPermissions = () => request("/auth/me/permissions");
export const getAdminRoles = () => request("/admin/roles");
export const getAdminPermissions = () => request("/admin/permissions");
export const getAdminRolePermissions = (roleReference) => request(`/admin/roles/${encodeURIComponent(roleReference)}/permissions`);
export const updateAdminRolePermissions = (roleReference, permissionKeys) => request(
  `/admin/roles/${encodeURIComponent(roleReference)}/permissions`,
  {
    method: "PUT",
    body: { permission_keys: permissionKeys }
  }
);
export const getNotificationEscalationSettings = () => request("/admin/notification-escalation");
export const updateNotificationEscalationSettings = (payload) => request("/admin/notification-escalation", {
  method: "PUT",
  body: payload
});
export const getWarehouses = (params = {}) => request(`/warehouses${buildQuerySuffix(params)}`);
export const getWarehouseAssignments = (params = {}) => request(`/warehouses/assignments${buildQuerySuffix(params)}`);
export const getWarehouseAssignmentHistory = () => request("/warehouses/assignment-history");
export const assignUserToWarehouse = (warehouseReference, payload) => request(
  `/warehouses/${encodeURIComponent(warehouseReference)}/assignments`,
  { method: "POST", body: payload }
);
export const removeUserFromWarehouse = (warehouseReference, username, reason = "") => request(
  `/warehouses/${encodeURIComponent(warehouseReference)}/assignments/${encodeURIComponent(username)}`,
  { method: "DELETE", body: { reason } }
);
export const getShifts = (params = {}) => request(`/shifts${buildQuerySuffix(params)}`);
export const getShift = (reference) => request(`/shifts/${encodeURIComponent(reference)}`);
export const createShift = (payload) => request("/shifts", { method: "POST", body: payload });
export const updateShift = (reference, payload) => request(`/shifts/${encodeURIComponent(reference)}`, {
  method: "PUT",
  body: payload
});
export const updateShiftStatus = (reference, status) => request(`/shifts/${encodeURIComponent(reference)}/status`, {
  method: "PATCH",
  body: { status }
});
export const getShiftUsers = (reference) => request(`/shifts/${encodeURIComponent(reference)}/users`);
export const assignUserToShift = (reference, payload) => request(`/shifts/${encodeURIComponent(reference)}/assignments`, {
  method: "POST",
  body: payload
});
export const removeUserFromShift = (reference, username, reason = "") => request(
  `/shifts/${encodeURIComponent(reference)}/assignments/${encodeURIComponent(username)}`,
  { method: "DELETE", body: { reason } }
);
export const getShiftAssignmentHistory = () => request("/shifts/assignment-history");

export const getAuditLogs = (params = {}) => {
  return request(`/audit-logs${buildQuerySuffix(params)}`);
};

export const getUserSessions = (params = {}) => {
  return request(`/user-sessions${buildQuerySuffix(params)}`);
};

export const validatePlacement = (payload, options = {}) => request("/placement/validate", {
  ...options,
  method: "POST",
  body: payload
});

export const confirmPlacement = (payload) => request("/placement/confirm", {
  method: "POST",
  body: payload
});

export const getPlacementSettings = () => request("/placement/settings");
export const updatePlacementSettings = (manualPlacementEnabled) => request("/placement/settings", {
  method: "PUT",
  body: { manual_placement_enabled: manualPlacementEnabled }
});
export const getPlacementLogs = () => request("/placement/logs");
export const getPlacementFailures = () => request("/placement/failures");
export const getPlacementActivity = (params = {}) => {
  return request(`/placement/activity${buildQuerySuffix(params)}`);
};
export const getPlacementActivitySummary = (params = {}) => {
  return request(`/placement/activity/summary${buildQuerySuffix(params)}`);
};
export const getCargoPlacementActivity = (id, params = {}) => {
  return request(`/cargo/${encodeURIComponent(id)}/placement-activity${buildQuerySuffix(params)}`);
};
export const requestPlacementOverride = (payload) => request("/placement/request-override", {
  method: "POST",
  body: payload
});

export const getActiveScanSession = () => request("/scanner/sessions/active");
export const refreshScanSession = () => request("/scanner/sessions/refresh", {
  method: "POST"
});
export const createPlacementScanSession = (payload) => request("/scanner/sessions/placement", {
  method: "POST",
  body: payload
});
export const cancelScanSession = (sessionId) => request(`/scanner/sessions/${encodeURIComponent(sessionId)}/cancel`, {
  method: "POST"
});

export const getSupervisorDashboard = () => request("/supervisor/dashboard");
export const getSupervisorReviewHistory = () => request("/supervisor/my/review-history");
export const getSupervisorReviewConfiguration = () => request("/supervisor/review-configuration");
export const getSupervisorApprovals = (params = {}) => {
  return request(`/supervisor/approvals${buildQuerySuffix(params)}`);
};
export const getSupervisorApproval = (id) => request(`/supervisor/approvals/${encodeURIComponent(id)}`);
export const approveSupervisorApproval = (id, decisionNotes = "") => request(`/supervisor/approvals/${encodeURIComponent(id)}/approve`, {
  method: "POST",
  body: typeof decisionNotes === "string"
    ? { decision_notes: decisionNotes }
    : decisionNotes
});
export const emergencyApproveSupervisorApproval = (id, payload = {}) => request(`/supervisor/approvals/${encodeURIComponent(id)}/emergency-approve`, {
  method: "POST",
  body: payload
});
export const rejectSupervisorApproval = (id, decisionNotes = "") => request(`/supervisor/approvals/${encodeURIComponent(id)}/reject`, {
  method: "POST",
  body: typeof decisionNotes === "string"
    ? { decision_notes: decisionNotes }
    : decisionNotes
});
export const requestSupervisorCorrection = (id, payload) => request(`/supervisor/approvals/${encodeURIComponent(id)}/request-correction`, {
  method: "POST",
  body: typeof payload === "string"
    ? { correction_notes: payload, correction_fields: [] }
    : payload
});
export const getSupervisorStaffActivity = () => request("/supervisor/staff-activity");
export const getSupervisorPlacementMonitoring = () => request("/supervisor/placement-monitoring");
export const getSupervisorPlacementSummary = () => request("/supervisor/placement-summary");

export const requestDispatchAuthorization = (payload) => request("/dispatch/request-authorization", {
  method: "POST",
  body: payload
});
export const getDispatchAuthorizationRequests = (params = {}) => {
  return request(`/dispatch/authorization-requests${buildQuerySuffix(params)}`);
};
export const approveDispatchAuthorization = (id, decisionNotes = "") => request(`/dispatch/authorization-requests/${encodeURIComponent(id)}/approve`, {
  method: "POST",
  body: typeof decisionNotes === "string"
    ? { decision_notes: decisionNotes }
    : decisionNotes
});
export const rejectDispatchAuthorization = (id, decisionNotes = "") => request(`/dispatch/authorization-requests/${encodeURIComponent(id)}/reject`, {
  method: "POST",
  body: typeof decisionNotes === "string"
    ? { decision_notes: decisionNotes }
    : decisionNotes
});

// Notification endpoints
export const getNotifications = (params = {}) => {
  return request(`/notifications${buildQuerySuffix(params)}`);
};

export const getUnreadNotificationCount = () => request("/notifications/unread-count");

export const getNotificationSummary = () => request("/notifications/summary");

export const markNotificationRead = (id) => request(`/notifications/${encodeURIComponent(id)}/read`, {
  method: "PATCH"
});

export const markAllNotificationsRead = () => request("/notifications/read-all", {
  method: "PATCH"
});

export const archiveNotification = (id) => request(`/notifications/${encodeURIComponent(id)}/archive`, {
  method: "PATCH"
});

export const restoreNotification = (id) => request(`/notifications/${encodeURIComponent(id)}/restore`, {
  method: "PATCH"
});

export const createSystemAnnouncement = (payload) => request("/notifications/system-announcement", {
  method: "POST",
  body: payload
});

// Profile endpoints
export const getProfile = () => request("/profile");

export const updateProfile = (payload) => request("/profile", {
  method: "PATCH",
  body: payload
});

export const changePassword = async (payload) => {
  const response = await request("/profile/change-password", {
    method: "PATCH",
    body: payload
  });

  if (response.data?.token) {
    setStoredAuthToken(response.data.token);
  }

  return response;
};

// Refresh token endpoint
export const refreshToken = () => refreshAccessToken();

// Zone CRUD
export const createZone = (payload) => request("/zones", {
  method: "POST",
  body: payload
});

export const updateZone = (id, payload) => request(`/zones/${encodeURIComponent(id)}`, {
  method: "PUT",
  body: payload
});

export const deleteZone = (id) => request(`/zones/${encodeURIComponent(id)}`, {
  method: "DELETE"
});

export const updateZoneStatus = (id, status) => request(`/zones/${encodeURIComponent(id)}/status`, {
  method: "PATCH",
  body: { status }
});

// Rack CRUD
export const createRack = (payload) => request("/racks", {
  method: "POST",
  body: payload
});

export const updateRack = (id, payload) => request(`/racks/${encodeURIComponent(id)}`, {
  method: "PUT",
  body: payload
});

export const deleteRack = (id) => request(`/racks/${encodeURIComponent(id)}`, {
  method: "DELETE"
});

export const updateRackStatus = (id, status) => request(`/racks/${encodeURIComponent(id)}/status`, {
  method: "PATCH",
  body: { status }
});

// Level CRUD
export const createLevel = (payload) => request("/levels", {
  method: "POST",
  body: payload
});

export const updateLevel = (id, payload) => request(`/levels/${encodeURIComponent(id)}`, {
  method: "PUT",
  body: payload
});

export const deleteLevel = (id) => request(`/levels/${encodeURIComponent(id)}`, {
  method: "DELETE"
});

export const updateLevelStatus = (id, status) => request(`/levels/${encodeURIComponent(id)}/status`, {
  method: "PATCH",
  body: { status }
});

// Bin CRUD
export const createBin = (payload) => request("/bins", {
  method: "POST",
  body: payload
});

export const updateBin = (id, payload) => request(`/bins/${encodeURIComponent(id)}`, {
  method: "PUT",
  body: payload
});

export const deleteBin = (id) => request(`/bins/${encodeURIComponent(id)}`, {
  method: "DELETE"
});

export const updateBinStatus = (id, status, options = {}) => request(`/bins/${encodeURIComponent(id)}/status`, {
  method: "PATCH",
  body: {
    status,
    reserved_for_cargo_type: options.reserved_for_cargo_type || "",
    reason: options.reason || "",
    override_with_cargo: options.override_with_cargo === true
  }
});

export const createWarehouse = (payload) => request("/warehouses", {
  method: "POST",
  body: payload
});

export const updateWarehouse = (id, payload) => request(`/warehouses/${encodeURIComponent(id)}`, {
  method: "PUT",
  body: payload
});

export const updateWarehouseStatus = (id, status) => request(`/warehouses/${encodeURIComponent(id)}/status`, {
  method: "PATCH",
  body: { status }
});

export const deleteWarehouse = (id) => request(`/warehouses/${encodeURIComponent(id)}`, { method: "DELETE" });

export const getCapacityConfigurations = (params = {}) => {
  return request(`/capacity-configurations${buildQuerySuffix(params)}`);
};

export const updateCapacityConfiguration = (entityType, entityId, payload) => request(
  `/capacity-configurations/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
  { method: "PUT", body: payload }
);

export const recommendBin = (cargoId) => request(`/bins/recommend/${encodeURIComponent(cargoId)}`);

// Bin Rules
export const getBinRules = () => request("/bin-rules");
export const getBinRuleEvaluators = () => request("/bin-rules/evaluators");
export const getBinRuleReadiness = (workflow = "placement_confirmation") => request(`/bin-rules/readiness?workflow=${encodeURIComponent(workflow)}`);
export const getBinRuleCategories = () => request("/bin-rules/categories");
export const createBinRuleCategory = (payload) => request("/bin-rules/categories", { method: "POST", body: payload });
export const updateBinRuleCategory = (reference, payload) => request(`/bin-rules/categories/${encodeURIComponent(reference)}`, { method: "PUT", body: payload });
export const deleteBinRuleCategory = (reference) => request(`/bin-rules/categories/${encodeURIComponent(reference)}`, { method: "DELETE" });
export const createBinRule = (payload) => request("/bin-rules", { method: "POST", body: payload });
export const deleteBinRule = (reference) => request(`/bin-rules/${encodeURIComponent(reference)}`, { method: "DELETE" });
export const getBinRuleHistory = (reference) => request(`/bin-rules/${encodeURIComponent(reference)}/history`);

export const updateBinRule = (reference, payload) => request(`/bin-rules/${encodeURIComponent(reference)}`, {
  method: "PUT",
  body: payload
});

// Finance endpoints
export const getFinanceDashboard = (params = {}) => request(`/finance/dashboard${buildQuerySuffix(params)}`);
export const getFinanceCargoCharges = (params = {}) => request(`/finance/cargo-charges${buildQuerySuffix(params)}`);
export const getFinanceInvoices = (params = {}) => request(`/finance/invoices${buildQuerySuffix(params)}`);
export const getFinanceInvoice = (invoiceNumber) => request(`/finance/invoices/${encodeURIComponent(invoiceNumber)}`);
export const generateFinanceDraftInvoice = (payload) => request("/finance/invoices/draft", {
  method: "POST",
  body: payload
});
export const issueFinanceInvoice = (invoiceNumber) => request(`/finance/invoices/${encodeURIComponent(invoiceNumber)}/issue`, {
  method: "POST"
});
export const cancelFinanceInvoice = (invoiceNumber, reason) => request(`/finance/invoices/${encodeURIComponent(invoiceNumber)}/cancel`, {
  method: "POST",
  body: { reason }
});
export const getFinancePayments = (params = {}) => request(`/finance/payments${buildQuerySuffix(params)}`);
export const recordFinancePayment = (payload) => request("/finance/payments", {
  method: "POST",
  body: payload
});
export const confirmFinancePayment = (reference) => request(`/finance/payments/${encodeURIComponent(reference)}/confirm`, { method: "POST" });
export const getFinanceTariffs = (params = {}) => request(`/finance/tariffs${buildQuerySuffix(params)}`);
export const createFinanceTariff = (payload) => request("/finance/tariffs", {
  method: "POST",
  body: payload
});
export const updateFinanceTariff = (reference, payload) => request(`/finance/tariffs/${encodeURIComponent(reference)}`, {
  method: "PUT",
  body: payload
});
export const activateFinanceTariff = (reference) => request(`/finance/tariffs/${encodeURIComponent(reference)}/activate`, {
  method: "POST",
  body: { confirm: true }
});
export const deactivateFinanceTariff = (reference) => request(`/finance/tariffs/${encodeURIComponent(reference)}/deactivate`, {
  method: "POST"
});
export const getFinanceReports = (params = {}) => request(`/finance/reports${buildQuerySuffix(params)}`);

// Customs endpoints
export const getCustomsDashboard = () => request("/customs/dashboard");
export const getCustomsQueue = (params = {}) => request(`/customs/queue${buildQuerySuffix(params)}`);
export const getCustomsRecords = (params = {}) => request(`/customs/records${buildQuerySuffix(params)}`);
export const getCustomsCleared = (params = {}) => request(`/customs/cleared${buildQuerySuffix(params)}`);
export const getCustomsHolds = (params = {}) => request(`/customs/holds${buildQuerySuffix(params)}`);
export const getCustomsCargo = (cargoReference) => request(`/customs/cargo/${encodeURIComponent(cargoReference)}`);
export const getCustomsHistory = (cargoReference) => request(`/customs/cargo/${encodeURIComponent(cargoReference)}/history`);
export const startCustomsInspection = (cargoReference, payload = {}) => request(`/customs/cargo/${encodeURIComponent(cargoReference)}/start`, {
  method: "POST",
  body: payload
});
export const updateCustomsStatus = (cargoReference, payload) => request(`/customs/cargo/${encodeURIComponent(cargoReference)}/status`, {
  method: "POST",
  body: payload
});

// Gate endpoints
export const getGateDashboard = () => request("/gate/dashboard");
export const getManagementDashboard = () => request("/management/dashboard");
export const getManagementReports = () => request("/management/reports");
export const getGateReleaseQueue = (params = {}) => request(`/gate/release-queue${buildQuerySuffix(params)}`);
export const getGateRecords = () => request("/gate/records");
export const getGateEligibility = (cargoReference) => request(`/gate/cargo/${encodeURIComponent(cargoReference)}/eligibility`);
export const confirmGateOut = (cargoReference, payload) => request(`/gate/cargo/${encodeURIComponent(cargoReference)}/gate-out`, {
  method: "POST",
  body: payload
});
export const getEmergencyReleaseRequests = () => request("/gate/emergency-requests");
export const requestEmergencyRelease = (payload) => request("/gate/emergency-requests", {
  method: "POST",
  body: payload
});
export const approveEmergencyRelease = (reference, decisionNotes = "") => request(`/gate/emergency-requests/${encodeURIComponent(reference)}/approve`, {
  method: "POST",
  body: { decision_notes: decisionNotes }
});
export const rejectEmergencyRelease = (reference, decisionNotes = "") => request(`/gate/emergency-requests/${encodeURIComponent(reference)}/reject`, {
  method: "POST",
  body: { decision_notes: decisionNotes }
});
