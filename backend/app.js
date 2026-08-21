const express = require("express");
const cors = require("cors");
const db = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const bootstrapRoutes = require("./routes/bootstrapRoutes");
const cargoRoutes = require("./routes/cargoRoutes");
const zoneRoutes = require("./routes/zoneRoutes");
const rackRoutes = require("./routes/rackRoutes");
const levelRoutes = require("./routes/levelRoutes");
const binRoutes = require("./routes/binRoutes");
const placementRoutes = require("./routes/placementRoutes");
const userRoutes = require("./routes/userRoutes");
const roleRoutes = require("./routes/roleRoutes");
const warehouseRoutes = require("./routes/warehouseRoutes");
const capacityConfigurationRoutes = require("./routes/capacityConfigurationRoutes");
const shiftRoutes = require("./routes/shiftRoutes");
const auditLogRoutes = require("./routes/auditLogRoutes");
const userSessionRoutes = require("./routes/userSessionRoutes");
const binRuleRoutes = require("./routes/binRuleRoutes");
const supervisorRoutes = require("./routes/supervisorRoutes");
const dispatchRoutes = require("./routes/dispatchRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const profileRoutes = require("./routes/profileRoutes");
const scannerRoutes = require("./routes/scannerRoutes");
const financeRoutes = require("./routes/financeRoutes");
const customsRoutes = require("./routes/customsRoutes");
const gateRoutes = require("./routes/gateRoutes");
const adminRoutes = require("./routes/adminRoutes");
const managementRoutes = require("./routes/managementRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const releaseReadinessRoutes = require("./routes/releaseReadinessRoutes");
const { webhook: paymentWebhook } = require("./controllers/paymentController");
const cargoRegistrationFormRoutes = require("./routes/cargoRegistrationFormRoutes");
const {
  errorHandler,
  notFoundHandler
} = require("./middleware/errorMiddleware");
const { requirePortalAccess } = require("./middleware/authMiddleware");
const { requireOperationalShift } = require("./services/shiftAccessService");
const { securityHeaders } = require("./middleware/securityHeaders");
const { validateRequestShape } = require("./middleware/requestValidation");
const { minimizeJsonResponses } = require("./middleware/responseMinimization");

const app = express();
app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

const localDevOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:5175",
  "http://127.0.0.1:5175",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
];

const configuredOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set(process.env.NODE_ENV === "production" ? configuredOrigins : [...configuredOrigins, ...localDevOrigins]));
const localFrontendPorts = new Set(["3000", "3001", "4173", "5173", "5174", "5175"]);

const isPrivateNetworkDevOrigin = (origin) => {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  try {
    const { hostname, port, protocol } = new URL(origin);
    const isPrivateHostname =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);

    return protocol === "http:" && localFrontendPorts.has(port) && isPrivateHostname;
  } catch {
    return false;
  }
};

app.use(securityHeaders);
app.use(minimizeJsonResponses);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || isPrivateNetworkDevOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(Object.assign(new Error("Origin is not allowed by CORS."), { statusCode: 403, errorCode: "CORS_ORIGIN_DENIED" }));
  },
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));
app.use((req, res, next) => {
  if (process.env.NODE_ENV === "production" && !req.secure) {
    return res.status(400).json({ success: false, code: "HTTPS_REQUIRED", message: "HTTPS is required in production." });
  }
  next();
});
// Flutterwave v4 signs the exact request bytes. Keep this route isolated from global JSON parsing.
app.post("/api/payments/webhook", express.raw({ type: "application/json", limit: "1mb" }), paymentWebhook);
app.use(express.json({ limit: "15mb" }));
app.use(validateRequestShape);

app.get("/api/health", async (req, res, next) => {
  try {
    await db.query("SELECT 1");

    res.json({
      success: true,
      message: "Fumba Port WMS API is running",
      data: {
        database_status: "connected",
        postgresql_status: "connected"
      }
    });
  } catch (error) {
    error.statusCode = 503;
    next(error);
  }
});

// Auth routes (no portal access check needed)
app.use("/api/auth", authRoutes);
app.use("/api/bootstrap", bootstrapRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/scanner", scannerRoutes);
app.use("/api", requirePortalAccess);
app.use("/api", requireOperationalShift);

app.use("/api/cargo", cargoRoutes);
app.use("/api/zones", zoneRoutes);
app.use("/api/racks", rackRoutes);
app.use("/api/levels", levelRoutes);
app.use("/api/bins", binRoutes);
app.use("/api/placement", placementRoutes);
app.use("/api/users", userRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/capacity-configurations", capacityConfigurationRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/user-sessions", userSessionRoutes);
app.use("/api/bin-rules", binRuleRoutes);
app.use("/api/supervisor", supervisorRoutes);
app.use("/api/dispatch", dispatchRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/customs", customsRoutes);
app.use("/api/gate", gateRoutes);
app.use("/api/management", managementRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/release-readiness", releaseReadinessRoutes);
app.use("/api/cargo-registration-form", cargoRegistrationFormRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
