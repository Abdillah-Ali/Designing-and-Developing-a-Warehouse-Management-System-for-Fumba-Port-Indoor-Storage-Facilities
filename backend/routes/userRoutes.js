const express = require("express");
const {
  createUser,
  deactivateUser,
  deleteUser,
  getUser,
  getUserPendingTasks,
  getUsers,
  reassignUserPendingTasks,
  resetUserPassword,
  updateUserStatus,
  updateUser
} = require("../controllers/adminController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.route("/").get(getUsers).post(requireRole("System Admin"), createUser);
router.patch("/:id/status", requireRole("System Admin"), updateUserStatus);
router.patch("/:id/reset-password", requireRole("System Admin"), resetUserPassword);
router.patch("/:id/deactivate", requireRole("System Admin"), deactivateUser);
router.get("/:id/pending-tasks", requireRole("System Admin"), getUserPendingTasks);
router.post("/:id/reassign-tasks", requireRole("System Admin"), reassignUserPendingTasks);
router.route("/:id")
  .get(getUser)
  .put(requireRole("System Admin"), updateUser)
  .delete(requireRole("System Admin"), deleteUser);

module.exports = router;
