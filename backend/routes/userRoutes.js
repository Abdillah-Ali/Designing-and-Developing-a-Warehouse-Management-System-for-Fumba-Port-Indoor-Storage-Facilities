const express = require("express");
const {
  createScanner,
  createUser,
  deactivateUser,
  deleteUser,
  getUser,
  getUserPendingTasks,
  getSystemAdministratorCapacity,
  getUsers,
  reassignUserPendingTasks,
  resetUserPassword,
  updateUserStatus,
  updateUser
} = require("../controllers/adminController");
const { requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();

router.route("/").get(getUsers).post(requirePermission("system.users.manage"), createUser);
router.get("/administrator-capacity", requirePermission("system.users.view"), getSystemAdministratorCapacity);
router.post("/scanners", requirePermission("system.users.manage"), createScanner);
router.patch("/:id/status", requirePermission("system.users.manage"), updateUserStatus);
router.patch("/:id/reset-password", requirePermission("system.users.manage"), resetUserPassword);
router.patch("/:id/deactivate", requirePermission("system.users.manage"), deactivateUser);
router.get("/:id/pending-tasks", requirePermission("system.users.view"), getUserPendingTasks);
router.post("/:id/reassign-tasks", requirePermission("system.users.manage"), reassignUserPendingTasks);
router.route("/:id")
  .get(getUser)
  .put(requirePermission("system.users.manage"), updateUser)
  .delete(requirePermission("system.users.manage"), deleteUser);

module.exports = router;
