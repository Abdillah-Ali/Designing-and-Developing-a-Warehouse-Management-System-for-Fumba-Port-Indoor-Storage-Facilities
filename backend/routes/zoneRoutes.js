const express = require("express");
const { getZones, createZone, updateZone, deleteZone } = require("../controllers/zoneController");

const router = express.Router();

router.get("/", getZones);
router.post("/", createZone);
router.put("/:id", updateZone);
router.delete("/:id", deleteZone);

module.exports = router;
