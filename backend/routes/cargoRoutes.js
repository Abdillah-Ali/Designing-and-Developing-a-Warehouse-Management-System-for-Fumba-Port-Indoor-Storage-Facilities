const express = require("express");
const {
  createCargo,
  deleteCargo,
  getCargo,
  getCargoDocumentContent,
  getCargoDocuments,
  getCargoById,
  getMyBarcodePrintLogs,
  getMyCargoSubmissions,
  getMyUploadedDocuments,
  getMyPlacementHistory,
  getCargoPlacementActivity,
  printCargoBarcode,
  resubmitCargo,
  updateCargoStatus,
  uploadCargoDocument,
  updateCargo
} = require("../controllers/cargoController");

const router = express.Router();
const { createRateLimiter } = require("../services/rateLimitService");
const documentOperationLimit = createRateLimiter({ scope: "cargo.documents", limit: 30, windowMs: 60_000 });

router.route("/").get(getCargo).post(createCargo);
router.get("/my/submissions", getMyCargoSubmissions);
router.get("/my/placement-history", getMyPlacementHistory);
router.get("/my/documents", getMyUploadedDocuments);
router.get("/my/barcode-prints", getMyBarcodePrintLogs);
router.get("/:id/placement-activity", getCargoPlacementActivity);
router.get("/:id/documents", getCargoDocuments);
router.get("/:id/documents/:documentId/content", documentOperationLimit, getCargoDocumentContent);
router.post("/:id/documents", documentOperationLimit, uploadCargoDocument);
router.post("/:id/print-barcode", printCargoBarcode);
router.post("/:id/resubmit", resubmitCargo);
router.patch("/:id/status", updateCargoStatus);
router.route("/:id").get(getCargoById).put(updateCargo).delete(deleteCargo);

module.exports = router;
