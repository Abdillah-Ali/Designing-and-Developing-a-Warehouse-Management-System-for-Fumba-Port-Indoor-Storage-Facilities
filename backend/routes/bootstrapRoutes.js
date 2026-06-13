const express = require("express");
const {
  createFirstAdmin,
  getBootstrapOptions
} = require("../controllers/bootstrapController");
const { requireAuthenticated } = require("../middleware/authMiddleware");

const router = express.Router();

// Safety gate: Disable bootstrap module if explicit permission is not granted in production
router.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_BOOTSTRAP !== 'true') {
    return res.status(404).json({ success: false, message: "Bootstrap module is disabled." });
  }
  next();
});

router.use(requireAuthenticated);
router.get("/options", getBootstrapOptions);
router.post("/create-admin", createFirstAdmin);

module.exports = router;
