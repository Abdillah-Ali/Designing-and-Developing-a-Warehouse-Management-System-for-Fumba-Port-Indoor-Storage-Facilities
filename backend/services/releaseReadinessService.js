const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { createNotificationsForAudience } = require("./notificationService");

const placementIsValid = (cargo) => ["Placed", "Relocated"].includes(cargo.placement_status) && Boolean(cargo.current_bin_id || cargo.bin_id || cargo.location);

const evaluate = (cargo) => {
  if (cargo.gate_out_status && cargo.gate_out_status !== "Not Released") return { status: "RELEASED", blockers: [] };
  const blockers = [];
  if (cargo.registration_status !== "Approved") blockers.push({ code: "WAITING_REGISTRATION", message: "Registration approval is required." });
  if (!placementIsValid(cargo)) blockers.push({ code: "WAITING_PLACEMENT", message: "A valid current placement is required." });
  if (cargo.customs_status !== "Cleared") blockers.push({ code: "WAITING_CUSTOMS", message: "Customs clearance is required." });
  const managementCleared = cargo.release_type === "MANAGEMENT" && cargo.management_release_status === "APPROVED";
  if (cargo.financial_status !== "Fully Paid" && !managementCleared) blockers.push({ code: "WAITING_PAYMENT", message: "Verified payment or an approved Management Release is required." });
  return { status: blockers.length ? blockers[0].code : "READY_FOR_RELEASE", blockers };
};

const recalculateReleaseReadiness = async ({ cargoId, executor = db, actorId = null, trigger = "SYSTEM" }) => {
  const result = await executor.query("SELECT * FROM cargo WHERE id=$1 AND is_deleted=FALSE LIMIT 1 FOR UPDATE", [cargoId]);
  const cargo = result.rows[0];
  if (!cargo) return null;
  const previous = cargo.release_readiness_status || "BLOCKED";
  const readiness = evaluate(cargo);
  await executor.query(
    `UPDATE cargo SET release_readiness_status=$1::varchar,release_readiness_blockers=$2::jsonb,
       ready_for_release_at=CASE WHEN $1::varchar='READY_FOR_RELEASE'::varchar THEN COALESCE(ready_for_release_at,CURRENT_TIMESTAMP) ELSE NULL END,
       updated_at=CURRENT_TIMESTAMP WHERE id=$3::integer`,
    [readiness.status, JSON.stringify(readiness.blockers), cargo.id]
  );
  if (previous !== readiness.status) {
    await writeAuditLog({ user_id: actorId, action: readiness.status === "READY_FOR_RELEASE" ? "CARGO_READY_FOR_RELEASE" : "RECALCULATE_RELEASE_READINESS", module: "Release Readiness", description: `Cargo ${cargo.cargo_id} readiness changed from ${previous} to ${readiness.status}.`, metadata: { system_actor: !actorId, trigger, before: previous, after: readiness.status, blockers: readiness.blockers }, executor });
    if (readiness.status === "READY_FOR_RELEASE") {
      await createNotificationsForAudience({ notification_type: "gate_release_update", title: "Cargo Ready for Release", message: `${cargo.cargo_id} has satisfied registration, placement, Customs, and financial controls.`, related_module: "Release Readiness", related_entity_type: "cargo", related_entity_id: cargo.id, priority: "high", created_by: actorId, metadata: { deep_link: "/staff?section=cargo-to-release", trigger } }, { roleName: "Warehouse Staff", warehouseId: cargo.warehouse_id }, executor);
    }
  }
  return { cargo_reference: cargo.cargo_id, ...readiness };
};

const listReadyCargo = async ({ executor = db, warehouseId = null }) => {
  const values=[]; const where=["c.is_deleted=FALSE", "c.gate_out_status='Not Released'", "c.release_readiness_status='READY_FOR_RELEASE'"];
  if (warehouseId) { values.push(warehouseId); where.push(`c.warehouse_id=$${values.length}`); }
  return (await executor.query(`SELECT c.cargo_id AS cargo_reference,c.consignee_name,c.location AS current_bin,c.customs_status,c.financial_status,c.management_release_status,c.release_readiness_status,c.ready_for_release_at,c.release_readiness_blockers,i.public_invoice_number AS invoice_reference,i.payment_reference,i.payment_status FROM cargo c LEFT JOIN LATERAL (SELECT * FROM invoices x WHERE x.cargo_id=c.id AND x.status<>'Cancelled' ORDER BY x.created_at DESC LIMIT 1) i ON TRUE WHERE ${where.join(" AND ")} ORDER BY c.ready_for_release_at`,values)).rows;
};

module.exports = { evaluate, recalculateReleaseReadiness, listReadyCargo };
