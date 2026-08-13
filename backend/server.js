const http = require("http");
const app = require("./app");
const { validateEnvironment } = require("./config/env");
const { testConnection } = require("./config/db");
const { initSocketServer } = require("./realtime/socketServer");
const { startNotificationSchedulers } = require("./services/notificationScheduler");
const { getSystemReadiness } = require("./services/readinessService");

const PORT = Number(process.env.PORT || 5000);

const startServer = async () => {
  try {
    validateEnvironment();
    await testConnection();
    const readiness = await getSystemReadiness();
    const affectedDomains = Object.values(readiness.domains)
      .filter((domain) => !domain.ready)
      .map((domain) => domain.domain);
    console.log(JSON.stringify({
      operation: "configuration_readiness_check",
      result: readiness.overall,
      affected_domains: affectedDomains,
      issue_codes: readiness.issues.map((issue) => issue.code),
      timestamp: readiness.checked_at
    }));
    const server = http.createServer(app);
    initSocketServer(server);
    await startNotificationSchedulers();

    server.listen(PORT, () => {
      console.log(JSON.stringify({
        operation: "backend_startup",
        result: "success",
        timestamp: new Date().toISOString()
      }));
    });
  } catch (error) {
    console.error(JSON.stringify({
      operation: "backend_startup",
      result: "failure",
      error_category: error.code || error.name || "startup_error",
      timestamp: new Date().toISOString()
    }));
    process.exit(1);
  }
};

startServer();
