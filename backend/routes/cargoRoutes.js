const express = require("express");
const {
  createCargo,
  deleteCargo,
  getCargo,
  getCargoById,
  updateCargo
} = require("../controllers/cargoController");

const router = express.Router();

router.route("/").get(getCargo).post(createCargo);
router.route("/:id").get(getCargoById).put(updateCargo).delete(deleteCargo);

module.exports = router;
