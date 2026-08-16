const express = require("express");
const { login, logout, getProfile, updateProfile, changePassword, refreshToken } = require("../controllers/adminController");
const { getMe, getMyPermissions } = require("../controllers/permissionController");
const { optionalAuthContext, requireAuthenticated, requireNonScanner } = require("../middleware/authMiddleware");
const { createRateLimiter } = require("../services/rateLimitService");

const router = express.Router();
const WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 2 * 60 * 1000);
const MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX || 3);
const loginRateLimit = createRateLimiter({ scope: "auth.login", limit: MAX_ATTEMPTS, windowMs: WINDOW_MS, accountField: "username", clearOnSuccess: true });
const refreshRateLimit = createRateLimiter({ scope: "auth.refresh", limit: Number(process.env.REFRESH_RATE_LIMIT_MAX || 30), windowMs: 60_000 });

// Login endpoint (no auth required)
router.post("/login", loginRateLimit, optionalAuthContext, login);

// Logout endpoint (auth required)
router.post("/logout", requireAuthenticated, logout);

// Profile endpoints (auth required)
router.get("/me", requireAuthenticated, getMe);
router.get("/me/permissions", requireAuthenticated, getMyPermissions);
router.get("/profile", requireAuthenticated, requireNonScanner, getProfile);
router.patch("/profile", requireAuthenticated, requireNonScanner, updateProfile);
router.put("/profile", requireAuthenticated, requireNonScanner, updateProfile);
router.patch("/profile/change-password", requireAuthenticated, requireNonScanner, changePassword);
router.post("/change-password", requireAuthenticated, requireNonScanner, changePassword);

router.post("/refresh", refreshRateLimit, refreshToken);

module.exports = router;
