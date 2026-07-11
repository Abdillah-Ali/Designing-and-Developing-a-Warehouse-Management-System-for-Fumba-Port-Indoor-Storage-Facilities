const express = require("express");
const {
  getBins,
  getBinById,
  getBinsByLevel,
  printBinBarcode,
  createBin,
  updateBin,
  updateBinStatus,
  deleteBin,
  recommendBin
} = require("../controllers/binController");
const { requireRole } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getBins);
router.post("/", requireRole("System Admin"), auditConfigurationAttempt, createBin);
router.get("/by-level/:levelId", getBinsByLevel);
router.get("/recommend/:cargoId", recommendBin);
router.patch("/:id/status", requireRole("System Admin"), auditConfigurationAttempt, updateBinStatus);
router.post("/:id/print-barcode", printBinBarcode);
router.get("/:id", getBinById);
router.put("/:id", requireRole("System Admin"), auditConfigurationAttempt, updateBin);
router.delete("/:id", requireRole("System Admin"), auditConfigurationAttempt, deleteBin);

module.exports = router;
