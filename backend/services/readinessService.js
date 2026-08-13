const db = require("../config/db");
const { validateRegisteredSettings } = require("./configurationRegistryService");
const { validateCargoRegistrationConfiguration } = require("./cargoRegistrationFormService");
const { validateRbacConfiguration } = require("./rbacReadinessService");
const { getWorkflowReadiness } = require("./binRuleEngine");
const { getWorkflowReadiness: getCargoWorkflowReadiness } = require("./cargoWorkflowEngine");
const { validateFinanceConfiguration } = require("./financeReadinessService");

const READINESS_DOMAINS = Object.freeze([
  "authentication",
  "rbac",
  "cargo_registration",
  "cargo_workflow",
  "placement",
  "finance",
  "customs",
  "dispatch",
  "gate",
  "scanner",
  "notifications"
]);

const SETTING_DOMAINS = Object.freeze({
  auth_access_token_lifetime_ms: "authentication",
  auth_refresh_token_lifetime_ms: "authentication",
  auth_session_lifetime_ms: "authentication",
  maximum_active_system_administrators: "rbac",
  manual_placement_enabled: "placement",
  cargo_pending_review_escalation_enabled: "notifications",
  cargo_pending_review_escalation_hours: "notifications",
  cargo_pending_review_escalation_interval_ms: "notifications",
  cargo_pending_review_escalation_target_role: "notifications",
  cargo_pending_review_escalation_repeat_hours: "notifications"
});

const safeIssue = (entry, validationIssue) => ({
  code: validationIssue.code || "CONFIG_VALIDATION_FAILED",
  setting_key: entry.definition.setting_key,
  message: entry.definition.is_secret
    ? "A protected setting is missing or invalid."
    : validationIssue.message,
  impact: entry.definition.criticality === "critical_policy" ? "blocked" : "degraded",
  criticality: entry.definition.criticality
});

const getSystemReadiness = async (executor = db) => {
  const checkedAt = new Date().toISOString();
  const validations = await validateRegisteredSettings(executor);
  const domains = Object.fromEntries(READINESS_DOMAINS.map((domain) => [domain, {
    ready: true,
    status: "healthy",
    domain,
    issues: [],
    checked_at: checkedAt
  }]));

  for (const entry of validations) {
    if (entry.valid) continue;
    const domainName = SETTING_DOMAINS[entry.definition.setting_key];
    if (!domainName) continue;
    const domain = domains[domainName];
    domain.ready = false;
    domain.status = "blocked";
    domain.issues.push(...entry.issues.map((validationIssue) => safeIssue(entry, validationIssue)));
  }

  if (executor === db) {
    const authentication = domains.authentication;
    if (!(process.env.JWT_SECRET || process.env.AUTH_TOKEN_SECRET)) {
      authentication.ready = false;
      authentication.status = "blocked";
      authentication.issues.push({
        code: "AUTH_SIGNING_SECRET_MISSING",
        message: "The authentication signing secret is not configured.",
        impact: "blocked",
        criticality: "critical_policy"
      });
    }
    const persistence = await executor.query(
      "SELECT to_regclass('public.session_refresh_tokens') IS NOT NULL AS refresh_table_ready"
    );
    if (!persistence.rows[0]?.refresh_table_ready) {
      authentication.ready = false;
      authentication.status = "blocked";
      authentication.issues.push({
        code: "AUTH_REFRESH_PERSISTENCE_UNAVAILABLE",
        message: "Refresh-token persistence is unavailable.",
        impact: "blocked",
        criticality: "critical_policy"
      });
    }
    const cargoConfiguration = await validateCargoRegistrationConfiguration(executor);
    if (!cargoConfiguration.valid) {
      const cargoDomain = domains.cargo_registration;
      cargoDomain.ready = false;
      cargoDomain.status = "blocked";
      cargoDomain.issues.push(...cargoConfiguration.issues.map((issue) => ({ ...issue, criticality: "critical_policy" })));
    }
    const rbacConfiguration = await validateRbacConfiguration(executor);
    if (!rbacConfiguration.valid) {
      const rbacDomain = domains.rbac;
      rbacDomain.ready = false;
      rbacDomain.status = "blocked";
      rbacDomain.issues.push(...rbacConfiguration.issues);
    }
    const placementConfiguration = await getWorkflowReadiness("placement_confirmation", executor);
    if (!placementConfiguration.ready) {
      const placement = domains.placement;
      placement.ready = false;
      placement.status = "blocked";
      placement.issues.push({
        code: "BIN_RULE_ENGINE_NOT_READY",
        message: "Placement rule configuration is incomplete or invalid.",
        impact: "blocked",
        criticality: "critical_policy",
        details: placementConfiguration
      });
    }
    const cargoWorkflowConfiguration = await getCargoWorkflowReadiness(executor);
    if (!cargoWorkflowConfiguration.ready) {
      const workflow = domains.cargo_workflow;
      workflow.ready = false;
      workflow.status = "blocked";
      workflow.issues.push({ code: "CARGO_WORKFLOW_NOT_READY", message: "Cargo workflow policy is incomplete or invalid.", impact: "blocked", criticality: "critical_policy", details: cargoWorkflowConfiguration });
    }
    const financeConfiguration = await validateFinanceConfiguration(executor);
    if (!financeConfiguration.ready) {
      domains.finance.ready=false; domains.finance.status='blocked';
      domains.finance.issues.push(...financeConfiguration.issues.map((issue)=>({...issue,criticality:'critical_policy'})));
    }
  }

  const issues = Object.values(domains).flatMap((domain) => domain.issues);
  const hasCritical = issues.some((entry) => entry.criticality === "critical_policy");
  return {
    ready: issues.length === 0,
    overall: hasCritical ? "blocked" : issues.length ? "degraded" : "healthy",
    domains,
    issues,
    checked_at: checkedAt
  };
};

const getDomainReadiness = async (domain, executor = db) => {
  if (!READINESS_DOMAINS.includes(domain)) {
    return { ready: false, status: "blocked", domain, issues: [{ code: "READINESS_DOMAIN_UNKNOWN", message: "The readiness domain is not registered.", impact: "blocked" }], checked_at: new Date().toISOString() };
  }
  return (await getSystemReadiness(executor)).domains[domain];
};

module.exports = { READINESS_DOMAINS, SETTING_DOMAINS, getDomainReadiness, getSystemReadiness };
