const express = require("express");
const { login, logout, getProfile, updateProfile, changePassword, refreshToken } = require("../controllers/adminController");
const { optionalAuthContext, requireAuthenticated } = require("../middleware/authMiddleware");

const router = express.Router();
const loginAttempts = new Map();
const WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX || 8);

const loginRateLimit = (req, res, next) => {
  const key = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const record = loginAttempts.get(key) || { count: 0, resetAt: now + WINDOW_MS };

  if (record.resetAt <= now) {
    record.count = 0;
    record.resetAt = now + WINDOW_MS;
  }

  record.count += 1;
  loginAttempts.set(key, record);

  res.on("finish", () => {
    if (res.statusCode < 400) {
      loginAttempts.delete(key);
    }
  });

  if (record.count > MAX_ATTEMPTS) {
    res.status(429).json({
      success: false,
      message: "Too many sign-in attempts. Please try again later."
    });
    return;
  }

  next();
};

// Login endpoint (no auth required)
router.post("/login", loginRateLimit, optionalAuthContext, login);

// Logout endpoint (auth required)
router.post("/logout", requireAuthenticated, logout);

// Profile endpoints (auth required)
router.get("/profile", requireAuthenticated, getProfile);
router.put("/profile", requireAuthenticated, updateProfile);
router.post("/change-password", requireAuthenticated, changePassword);

router.post("/refresh", refreshToken);

module.exports = router;
