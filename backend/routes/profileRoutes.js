const express = require("express");
const {
  changePassword,
  getProfile,
  updateProfile
} = require("../controllers/adminController");
const { requireAuthenticated } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireAuthenticated, getProfile);
router.patch("/", requireAuthenticated, updateProfile);
router.put("/", requireAuthenticated, updateProfile);
router.patch("/change-password", requireAuthenticated, changePassword);
router.post("/change-password", requireAuthenticated, changePassword);

module.exports = router;
