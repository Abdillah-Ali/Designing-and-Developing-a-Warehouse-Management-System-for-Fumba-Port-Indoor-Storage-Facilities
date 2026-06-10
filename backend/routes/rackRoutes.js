const express = require("express");
const { getRacksByZone, createRack, updateRack, deleteRack } = require("../controllers/rackController");

const router = express.Router();

router.get("/:zoneId", getRacksByZone);
router.post("/", createRack);
router.put("/:id", updateRack);
router.delete("/:id", deleteRack);

module.exports = router;
