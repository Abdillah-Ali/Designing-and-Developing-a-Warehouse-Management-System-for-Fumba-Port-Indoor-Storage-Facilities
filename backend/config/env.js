const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config();

const isTest = process.env.NODE_ENV === "test";

const requiredRuntimeVariables = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "JWT_SECRET"
];

const weakSecretValues = new Set([
  "replace-with-a-long-random-secret",
  "fumba_port_secret",
  "fumba-port-development-token-secret",
  "secret",
  "password",
  "changeme"
]);

const readEnv = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return value;
};

const validateEnvironment = ({ includeDatabase = true } = {}) => {
  if (isTest && process.env.ALLOW_TEST_ENV_DEFAULTS === "true") {
    process.env.JWT_SECRET ||= "test-only-jwt-secret-that-is-not-used-in-production";
    process.env.DB_HOST ||= "localhost";
    process.env.DB_PORT ||= "5432";
    process.env.DB_NAME ||= "fumbaport_wms_test";
    process.env.DB_USER ||= "postgres";
    process.env.DB_PASSWORD ||= "test-only-password";
  }

  const required = includeDatabase
    ? requiredRuntimeVariables
    : requiredRuntimeVariables.filter((name) => !name.startsWith("DB_"));
  const missing = required.filter((name) => !String(process.env[name] || "").trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const jwtSecret = String(process.env.JWT_SECRET || "");
  if (jwtSecret.length < 32 || weakSecretValues.has(jwtSecret)) {
    throw new Error("JWT_SECRET must be a strong secret of at least 32 characters.");
  }

  return true;
};

module.exports = {
  readEnv,
  validateEnvironment
};
