import { getStoredAuthToken, setStoredAuthToken, clearStoredAuthToken } from "@/lib/portal-access";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

const request = async (path, options = {}) => {
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
      headers,
      body
    });
  } catch (error) {
    throw new Error("Service is temporarily unavailable.");
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.success === false) {
    if (response.status === 401) {
      clearStoredAuthToken();
    }

    const error = new Error(payload.message || "Request could not be completed.");
    error.errors = payload.errors;
    error.code = payload.code;
    error.details = payload.details;
    error.status = response.status;
    throw error;
  }

  return payload;
};

// Authentication endpoints
export const login = async (username, password) => {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });
  } catch (error) {
    throw new Error("Service is temporarily unavailable.");
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || "Login failed.");
  }

  if (payload.data?.token) {
    setStoredAuthToken(payload.data.token);
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

export const createFirstSystemAdmin = (payload) => request("/bootstrap/create-admin", {
  method: "POST",
  body: payload
});

export const getCargo = (params = {}) => {
  const search = new URLSearchParams(params);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request(`/cargo${suffix}`);
};

export const getCargoById = (id) => request(`/cargo/${encodeURIComponent(id)}`);
export const getMyCargoSubmissions = () => request("/cargo/my/submissions");

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

export const getZones = () => request("/zones");
export const getZoneById = (id) => request(`/zones/${encodeURIComponent(id)}`);
export const getRacks = (zoneId) => request(`/racks/by-zone/${encodeURIComponent(zoneId)}`);
export const getAllRacks = () => request("/racks");
export const getRackById = (id) => request(`/racks/${encodeURIComponent(id)}`);
export const getLevels = (rackId) => request(`/levels/by-rack/${encodeURIComponent(rackId)}`);
export const getAllLevels = () => request("/levels");
export const getLevelById = (id) => request(`/levels/${encodeURIComponent(id)}`);
export const getBins = (levelId) => request(`/bins/by-level/${encodeURIComponent(levelId)}`);
export const getAllBins = (params = {}) => {
  const search = new URLSearchParams(params);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request(`/bins${suffix}`);
};
export const getBinById = (id) => request(`/bins/${encodeURIComponent(id)}`);

export const getUsers = (params = {}) => {
  const search = new URLSearchParams(params);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request(`/users${suffix}`);
};

export const getUserById = (id) => request(`/users/${encodeURIComponent(id)}`);

export const createUser = (payload) => request("/users", {
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
export const getWarehouses = () => request("/warehouses");
export const getShifts = () => request("/shifts");

export const getAuditLogs = (params = {}) => {
  const search = new URLSearchParams(params);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request(`/audit-logs${suffix}`);
};

export const getUserSessions = (params = {}) => {
  const search = new URLSearchParams(params);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request(`/user-sessions${suffix}`);
};

export const validatePlacement = (payload) => request("/placement/validate", {
  method: "POST",
  body: payload
});

export const confirmPlacement = (payload) => request("/placement/confirm", {
  method: "POST",
  body: payload
});

export const getPlacementLogs = () => request("/placement/logs");
export const getPlacementFailures = () => request("/placement/failures");
export const requestPlacementOverride = (payload) => request("/placement/request-override", {
  method: "POST",
  body: payload
});

export const getSupervisorDashboard = () => request("/supervisor/dashboard");
export const getSupervisorReviewConfiguration = () => request("/supervisor/review-configuration");
export const getSupervisorApprovals = (params = {}) => {
  const search = new URLSearchParams(params);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request(`/supervisor/approvals${suffix}`);
};
export const getSupervisorApproval = (id) => request(`/supervisor/approvals/${encodeURIComponent(id)}`);
export const approveSupervisorApproval = (id, decisionNotes = "") => request(`/supervisor/approvals/${encodeURIComponent(id)}/approve`, {
  method: "POST",
  body: typeof decisionNotes === "string"
    ? { decision_notes: decisionNotes }
    : decisionNotes
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
  const search = new URLSearchParams(params);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request(`/dispatch/authorization-requests${suffix}`);
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

// Profile endpoints
export const getProfile = () => request("/auth/profile");

export const updateProfile = (payload) => request("/auth/profile", {
  method: "PUT",
  body: payload
});

export const changePassword = async (payload) => {
  const response = await request("/auth/change-password", {
    method: "POST",
    body: payload
  });

  if (response.data?.token) {
    setStoredAuthToken(response.data.token);
  }

  return response;
};

// Refresh token endpoint
export const refreshToken = (payload) => request("/auth/refresh", {
  method: "POST",
  body: payload
});

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

export const updateBinStatus = (id, status, reservedForCargoType = "") => request(`/bins/${encodeURIComponent(id)}/status`, {
  method: "PATCH",
  body: {
    status,
    reserved_for_cargo_type: reservedForCargoType
  }
});

export const generateDefaultWarehouseStructure = () => request(
  "/warehouse-configuration/generate-default-structure",
  { method: "POST" }
);

// Bin Rules
export const getBinRules = () => request("/bin-rules");

export const updateBinRule = (id, payload) => request(`/bin-rules/${encodeURIComponent(id)}`, {
  method: "PUT",
  body: payload
});
