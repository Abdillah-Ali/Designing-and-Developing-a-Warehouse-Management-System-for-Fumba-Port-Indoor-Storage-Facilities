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
const { requirePermission } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getBins);
router.post("/", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, createBin);
router.get("/by-level/:levelId", getBinsByLevel);
router.get("/recommend/:cargoId", recommendBin);
router.patch("/:id/status", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, updateBinStatus);
router.post("/:id/print-barcode", printBinBarcode);
router.get("/:id", getBinById);
router.put("/:id", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, updateBin);
router.delete("/:id", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, deleteBin);

module.exports = router;
