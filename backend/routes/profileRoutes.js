const express = require("express");
const {
  changePassword,
  getProfile,
  updateProfile
} = require("../controllers/adminController");
const { requireAuthenticated, requireNonScanner } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuthenticated, requireNonScanner);
router.get("/", getProfile);
router.patch("/", updateProfile);
router.put("/", updateProfile);
router.patch("/change-password", changePassword);
router.post("/change-password", changePassword);

module.exports = router;
