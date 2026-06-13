const express = require("express");
const {
  createCargo,
  deleteCargo,
  getCargo,
  getCargoDocumentContent,
  getCargoDocuments,
  getCargoById,
  getMyCargoSubmissions,
  printCargoBarcode,
  resubmitCargo,
  updateCargoStatus,
  uploadCargoDocument,
  updateCargo
} = require("../controllers/cargoController");

const router = express.Router();

router.route("/").get(getCargo).post(createCargo);
router.get("/my/submissions", getMyCargoSubmissions);
router.get("/:id/documents", getCargoDocuments);
router.get("/:id/documents/:documentId/content", getCargoDocumentContent);
router.post("/:id/documents", uploadCargoDocument);
router.post("/:id/print-barcode", printCargoBarcode);
router.post("/:id/resubmit", resubmitCargo);
router.patch("/:id/status", updateCargoStatus);
router.route("/:id").get(getCargoById).put(updateCargo).delete(deleteCargo);

module.exports = router;
