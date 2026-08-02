const express = require("express");
const {
  getAvailable,
  getPublished,
  reset,
  update,
  validateConfiguration
} = require("../controllers/cargoRegistrationFormController");
const { requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", getPublished);
router.get("/available", requirePermission("system.cargo_registration_form.view"), getAvailable);
router.post("/validate", requirePermission("system.cargo_registration_form.manage"), validateConfiguration);
router.put("/", requirePermission("system.cargo_registration_form.manage"), update);
router.post("/reset", requirePermission("system.cargo_registration_form.manage"), reset);

module.exports = router;
