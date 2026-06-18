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
const shiftRoutes = require("./routes/shiftRoutes");
const auditLogRoutes = require("./routes/auditLogRoutes");
const userSessionRoutes = require("./routes/userSessionRoutes");
const binRuleRoutes = require("./routes/binRuleRoutes");
const supervisorRoutes = require("./routes/supervisorRoutes");
const dispatchRoutes = require("./routes/dispatchRoutes");
const {
  errorHandler,
  notFoundHandler
} = require("./middleware/errorMiddleware");
const { requirePortalAccess } = require("./middleware/authMiddleware");

const app = express();

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

const allowedOrigins = Array.from(new Set([...configuredOrigins, ...localDevOrigins]));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin is not allowed by CORS."));
  },
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "15mb" }));

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

app.use("/api", requirePortalAccess);

app.use("/api/cargo", cargoRoutes);
app.use("/api/zones", zoneRoutes);
app.use("/api/racks", rackRoutes);
app.use("/api/levels", levelRoutes);
app.use("/api/bins", binRoutes);
app.use("/api/placement", placementRoutes);
app.use("/api/users", userRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/user-sessions", userSessionRoutes);
app.use("/api/bin-rules", binRuleRoutes);
app.use("/api/supervisor", supervisorRoutes);
app.use("/api/dispatch", dispatchRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
