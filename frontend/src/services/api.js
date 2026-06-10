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

export const getCargo = (params = {}) => {
  const search = new URLSearchParams(params);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request(`/cargo${suffix}`);
};

export const getCargoById = (id) => request(`/cargo/${encodeURIComponent(id)}`);

export const createCargo = (payload) => request("/cargo", {
  method: "POST",
  body: payload
});

export const updateCargo = (id, payload) => request(`/cargo/${encodeURIComponent(id)}`, {
  method: "PUT",
  body: payload
});

export const deleteCargo = (id) => request(`/cargo/${encodeURIComponent(id)}`, {
  method: "DELETE"
});

export const getZones = () => request("/zones");
export const getRacks = (zoneId) => request(`/racks/${encodeURIComponent(zoneId)}`);
export const getLevels = (rackId) => request(`/levels/${encodeURIComponent(rackId)}`);
export const getBins = (levelId) => request(`/bins/${encodeURIComponent(levelId)}`);

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

// Profile endpoints
export const getProfile = () => request("/auth/profile");

export const updateProfile = (payload) => request("/auth/profile", {
  method: "PUT",
  body: payload
});

export const changePassword = (payload) => request("/auth/change-password", {
  method: "POST",
  body: payload
});

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

// Bin Rules
export const getBinRules = () => request("/bin-rules");

export const updateBinRule = (id, payload) => request(`/bin-rules/${encodeURIComponent(id)}`, {
  method: "PUT",
  body: payload
});
