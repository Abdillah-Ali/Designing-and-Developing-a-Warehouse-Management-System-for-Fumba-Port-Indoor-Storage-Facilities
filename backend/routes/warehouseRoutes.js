const express = require("express");
const {
  getWarehouses,
  createWarehouse,
  updateWarehouse,
  updateWarehouseStatus
} = require("../controllers/warehouseController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", getWarehouses);
router.post("/", requireRole("System Admin"), createWarehouse);
router.put("/:id", requireRole("System Admin"), updateWarehouse);
router.patch("/:id/status", requireRole("System Admin"), updateWarehouseStatus);

module.exports = router;
