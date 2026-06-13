const express = require("express");
const { generateDefaultStructure } = require("../controllers/warehouseConfigurationController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.post(
  "/generate-default-structure",
  requireRole("System Admin"),
  generateDefaultStructure
);

module.exports = router;
