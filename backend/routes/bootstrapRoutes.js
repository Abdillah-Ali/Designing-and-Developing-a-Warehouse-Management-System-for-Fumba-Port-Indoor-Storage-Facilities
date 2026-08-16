const express = require("express");
const {
  createFirstAdmin,
  getBootstrapOptions,
  getSetupStatus
} = require("../controllers/bootstrapController");

const router = express.Router();
const { createRateLimiter } = require("../services/rateLimitService");
const bootstrapRateLimit = createRateLimiter({ scope: "bootstrap.create-admin", limit: 5, windowMs: 15 * 60_000, accountField: "username" });

router.get("/status", getSetupStatus);
router.get("/options", getBootstrapOptions);
router.post("/create-admin", bootstrapRateLimit, createFirstAdmin);

module.exports = router;
