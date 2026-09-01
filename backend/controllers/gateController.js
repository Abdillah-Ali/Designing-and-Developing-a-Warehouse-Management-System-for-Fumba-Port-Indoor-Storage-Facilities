const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const {
  notifyEmergencyReleaseCompleted,
  notifyGateReleaseBlocked
} = require("../services/notificationService");
const {
  amountFromCents,
  findCargoByPublicReference,
  generatePublicReference,
  getCargoFinancialSnapshot,
  getServerNow,
  updateCargoFinancialStatus
} = require("../services/financeService");
const { evaluateEligibility, activeDispatch } = require("../services/releaseEligibilityService");
const { executeTransition } = require("../services/cargoWorkflowEngine");

const cleanString = (value) => String(value ?? "").trim();

const withTransaction = async (handler) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const gateCargoSelect = `
  SELECT
    c.id AS cargo_record_id,
    c.cargo_id,
    c.barcode,
    c.consignee_name,
    c.company_name,
    c.cargo_type,
    c.cargo_description,
    c.registration_status,
    c.placement_status,
    c.customs_status,
    c.customs_status_key,
    c.financial_status,
    c.release_type,
    c.management_release_status,
    c.management_release_waived_amount,
    c.dispatch_status,
    c.gate_out_status,
    c.location,
    c.current_bin_id,
    c.weight,
    c.volume,
    c.charge_start_at,
    c.charge_end_at,
    c.released_at,
    c.created_at,
    dr.status AS dispatch_request_status,
    dr.reason AS dispatch_reason,
    dr.decision_notes AS dispatch_decision_notes,
    dr.created_at AS dispatch_requested_at,
    dr.decided_at AS dispatch_decided_at
  FROM cargo c
  LEFT JOIN LATERAL (
    SELECT *
    FROM dispatch_requests latest_dr
    WHERE latest_dr.cargo_id = c.id
    ORDER BY latest_dr.created_at DESC, latest_dr.id DESC
    LIMIT 1
  ) dr ON TRUE
`;

const toGateCargo = (row, eligibility = null) => ({
  cargo_reference: row.cargo_id,
  barcode: row.barcode,
  consignee_name: row.consignee_name,
  owner_information: row.company_name || row.consignee_name,
  cargo_type: row.cargo_type,
  cargo_description: row.cargo_description,
  approval_status: row.registration_status,
  placement_status: row.placement_status,
  customs_status: row.customs_status,
  financial_status: row.financial_status,
  release_type: row.management_release_status === "APPROVED" ? "MANAGEMENT RELEASE" : "NORMAL RELEASE",
  management_release_status: row.management_release_status || "NOT_REQUIRED",
  charge_treatment: row.management_release_status === "APPROVED" ? "No Charges / Waived" : "Normal warehouse charges",
  waived_amount: row.management_release_waived_amount || "0.00",
  dispatch_status: row.dispatch_status,
  gate_out_status: row.gate_out_status,
  location: row.location,
  dispatch_request_status: row.dispatch_request_status || "Not Requested",
  dispatch_reason: row.dispatch_reason,
  dispatch_requested_at: row.dispatch_requested_at,
  dispatch_decided_at: row.dispatch_decided_at,
  release_eligibility: eligibility
});

const getActiveDispatchRequest = async (executor, cargoId, { lock = false } = {}) => {
  const result = await executor.query(
    `SELECT *
     FROM dispatch_requests
     WHERE cargo_id = $1
       AND status = 'Approved'
       AND gate_released_at IS NULL
     ORDER BY decided_at DESC NULLS LAST, created_at DESC, id DESC
     LIMIT 1
     ${lock ? "FOR UPDATE" : ""}`,
    [cargoId]
  );
  return result.rows[0] || null;
};

const buildEligibilityLegacy = async ({ executor = db, cargo, at = null }) => {
  const calculationTime = at || await getServerNow(executor);
  const dispatchRequest = await getActiveDispatchRequest(executor, cargo.id || cargo.cargo_record_id);
  const blocked = [];
  let financialSnapshot = null;
  let outstandingAmount = "0.00";

  try {
    financialSnapshot = await getCargoFinancialSnapshot({
      cargoId: cargo.id || cargo.cargo_record_id,
      at: calculationTime,
      executor
    });
    outstandingAmount = amountFromCents(financialSnapshot.outstanding_cents);
  } catch (error) {
    blocked.push({
      requirement: "payment",
      message: error.message || "Financial clearance could not be calculated."
    });
  }

  if (cargo.customs_status !== "Cleared") {
    blocked.push({
      requirement: "customs",
      message: "Cargo must be cleared by Customs before release."
    });
  }
  if (!financialSnapshot || financialSnapshot.outstanding_cents > 0n) {
    blocked.push({
      requirement: "payment",
      message: "Finance confirmation is required before release.",
      outstanding_amount: outstandingAmount
    });
  }
  if (!dispatchRequest) {
    blocked.push({
      requirement: "dispatch",
      message: "An active approved dispatch request is required."
    });
  }
  if (cargo.registration_status !== "Approved") {
    blocked.push({
      requirement: "supervisor_approval",
      message: "Supervisor registration approval is required."
    });
  }
  if (["Released", "Emergency Released"].includes(cargo.gate_out_status)) {
    blocked.push({
      requirement: "gate_out",
      message: "Cargo has already been released."
    });
  }

  return {
    eligible: blocked.length === 0,
    calculation_time: calculationTime,
    outstanding_amount: outstandingAmount,
    billable_days: financialSnapshot?.charge?.billable_days || 0,
    current_accrued_charge: financialSnapshot?.charge?.total_amount || "0.00",
    amount_paid: financialSnapshot?.amount_paid || "0.00",
    blocked_requirements: blocked,
    dispatch_reference: dispatchRequest ? "Approved Dispatch Request" : null
  };
};
const buildEligibility=async({executor=db,cargo,at=null})=>{
 const result=await evaluateEligibility({target:'normal_gate_release',cargo,executor,at});
 const aliases={financial_clearance:'payment',customs_clearance:'customs',dispatch_approval:'dispatch',registration_state:'supervisor_approval',management_release_authorization:'management_release',release_state:'gate_out'};
 const blocked=result.blocked_requirements.map(item=>({...item,requirement:aliases[item.evaluator_key]||item.evaluator_key}));
 return {...result,blocked_requirements:blocked,billable_days:0,current_accrued_charge:'0.00',amount_paid:'0.00',dispatch_reference:result.dispatch_request?'Approved Dispatch Request':null};
};

const getDashboard = async (req, res, next) => {
  try {
    const [counts, releasedToday, emergencies] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE c.release_readiness_status = 'READY_FOR_RELEASE' AND c.gate_out_status = 'Not Released')::int AS awaiting_gate_release,
           COUNT(*) FILTER (WHERE c.release_readiness_status = 'READY_FOR_RELEASE' AND c.gate_out_status = 'Not Released')::int AS ready_for_release,
           COUNT(*) FILTER (WHERE c.customs_status <> 'Cleared' AND c.gate_out_status = 'Not Released')::int AS blocked_by_customs,
           COUNT(*) FILTER (WHERE c.financial_status <> 'Fully Paid' AND c.management_release_status<>'APPROVED' AND c.gate_out_status = 'Not Released')::int AS blocked_by_payment,
           COUNT(*) FILTER (WHERE c.registration_status <> 'Approved' AND c.gate_out_status = 'Not Released')::int AS blocked_by_supervisor,
           COUNT(*) FILTER (WHERE c.release_type='MANAGEMENT' AND c.management_release_status<>'APPROVED' AND c.gate_out_status='Not Released')::int AS blocked_by_management
         FROM cargo c
         WHERE c.is_deleted = FALSE`
      ),
      db.query(
        `SELECT COUNT(*)::int AS released_today
         FROM gate_out_records
         WHERE released_at >= CURRENT_DATE
           AND released_at < CURRENT_DATE + INTERVAL '1 day'`
      ),
      db.query(
        `SELECT COUNT(*)::int AS emergency_release_requests
         FROM emergency_release_requests
         WHERE status = 'Pending'`
      )
    ]);
    res.json({
      success: true,
      data: {
        metrics: {
          ...counts.rows[0],
          released_today: releasedToday.rows[0]?.released_today || 0,
          emergency_release_requests: emergencies.rows[0]?.emergency_release_requests || 0
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

const getReleaseQueue = async (req, res, next) => {
  try {
    const values = [];
    const clauses = ["c.is_deleted = FALSE", "c.gate_out_status = 'Not Released'"];
    if (req.query.search) {
      values.push(`%${req.query.search}%`);
      clauses.push(`(
        c.cargo_id ILIKE $${values.length}
        OR c.barcode ILIKE $${values.length}
        OR c.consignee_name ILIKE $${values.length}
        OR c.company_name ILIKE $${values.length}
      )`);
    }
    const result = await db.query(
      `${gateCargoSelect}
       WHERE ${clauses.join(" AND ")}
       ORDER BY CASE WHEN dr.status = 'Approved' THEN 0 ELSE 1 END,
                c.updated_at DESC,
                c.id DESC
       LIMIT 100`,
      values
    );
    const rows = [];
    for (const row of result.rows) {
      const eligibility = await buildEligibility({
        executor: db,
        cargo: { ...row, id: row.cargo_record_id }
      });
      rows.push(toGateCargo(row, eligibility));
    }
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    next(error);
  }
};

const getEligibility = async (req, res, next) => {
  try {
    const cargo = await findCargoByPublicReference(db, req.params.cargoReference);
    if (!cargo) throw buildError("Cargo record not found.", 404);
    const eligibility = await buildEligibility({ executor: db, cargo });
    res.json({
      success: true,
      data: {
        cargo_reference: cargo.cargo_id,
        barcode: cargo.barcode,
        customs_status: cargo.customs_status,
        financial_status: cargo.financial_status,
        release_type: cargo.release_type,
        management_release_status: cargo.management_release_status,
        charge_treatment: cargo.management_release_status === "APPROVED" ? "No Charges / Waived" : "Normal or provisional warehouse charges",
        supervisor_dispatch_approval: "Not required (automatic readiness workflow)",
        gate_out_status: cargo.gate_out_status,
        location: cargo.location,
        ...eligibility
      }
    });
  } catch (error) {
    next(error);
  }
};

const releaseBinIfNeeded = async (client, cargo) => {
  if (!cargo.current_bin_id) return null;
  const binResult = await client.query("SELECT * FROM bins WHERE id = $1 FOR UPDATE", [cargo.current_bin_id]);
  if (binResult.rowCount === 0) return null;
  const bin = binResult.rows[0];
  await client.query(
    `UPDATE bins
     SET current_weight = GREATEST(0, current_weight - $1),
         current_volume = GREATEST(0, current_volume - $2),
         status = CASE
           WHEN status IN ('Blocked','Restricted','Maintenance','Damaged','Inactive') THEN status
           WHEN GREATEST(0, current_weight - $1) = 0
            AND GREATEST(0, current_volume - $2) = 0 THEN 'Available'
           ELSE 'Occupied'
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [Number(cargo.weight || 0), Number(cargo.volume || 0), bin.id]
  );
  await client.query(
    "UPDATE cargo_locations SET is_current = FALSE, released_at = CURRENT_TIMESTAMP WHERE cargo_id = $1 AND is_current = TRUE",
    [cargo.id]
  );
  return bin;
};

const confirmGateOut = async (req, res, next) => {
  let blockedReleaseNotification = null;
  let blockedManagementReleaseAttempt = null;

  try {
    const data = await withTransaction(async (client) => {
      const vehicleNumber = cleanString(req.body.vehicle_number);
      const driverName = cleanString(req.body.driver_name);
      const gateNotes = cleanString(req.body.gate_notes);
      if (!vehicleNumber || !driverName) {
        throw buildError("Vehicle number and driver name are required.", 400);
      }
      const cargo = await findCargoByPublicReference(client, req.params.cargoReference, { lock: true });
      if (!cargo) throw buildError("Cargo record not found.", 404);
      if (["Released", "Emergency Released"].includes(cargo.gate_out_status)) {
        throw buildError("Cargo has already been released.", 409);
      }
      const releaseAt = await getServerNow(client);
      const dispatchRequest = await activeDispatch(client, cargo.id, true);
      const eligibility = await buildEligibility({ executor: client, cargo, at: releaseAt });
      let releaseType = cargo.management_release_status === "APPROVED" ? "Management" : "Normal";
      let emergencyRequest = null;

      if (!eligibility.eligible) {
        const managementBlock=eligibility.blocked_requirements.find((item)=>item.requirement==="management_release");
        const emergencyReference = cleanString(req.body.emergency_request_reference);
        if (!emergencyReference) {
          if (eligibility.blocked_requirements.some((item) => item.requirement === "payment")) {
            blockedReleaseNotification = {
              cargo: { id: cargo.id, cargo_id: cargo.cargo_id },
              outstandingAmount: eligibility.outstanding_amount,
              blockedRequirements: eligibility.blocked_requirements,
              actorId: req.auth?.userId || null
            };
          }
          if(managementBlock) blockedManagementReleaseAttempt={cargo:{id:cargo.id,cargo_id:cargo.cargo_id},block:managementBlock,actorId:req.auth?.userId||null};
          throw buildError(
            managementBlock?.message || (eligibility.blocked_requirements.find((item) => item.requirement === "payment")?.outstanding_amount
              ? `Gate-out blocked. Outstanding amount: ${eligibility.outstanding_amount}. Finance confirmation is required.`
              : "Gate-out blocked because one or more release requirements are not satisfied."),
            409,
            eligibility.blocked_requirements,
            managementBlock?.reason_code
          );
        }
        const emergencyEligibility=await evaluateEligibility({target:'emergency_gate_release',cargo,executor:client,at:releaseAt,emergencyReference,lock:true});
        if (!emergencyEligibility.eligible) {
          const emergencyManagementBlock=emergencyEligibility.blocked_requirements.find((item)=>item.evaluator_key==='management_release_authorization');
          if(emergencyManagementBlock) blockedManagementReleaseAttempt={cargo:{id:cargo.id,cargo_id:cargo.cargo_id},block:{...emergencyManagementBlock,requirement:'management_release'},actorId:req.auth?.userId||null};
          throw buildError(emergencyManagementBlock?.message||"Approved emergency release request was not found for this cargo.",emergencyManagementBlock?409:404,emergencyEligibility.blocked_requirements,emergencyManagementBlock?.reason_code);
        }
        emergencyRequest = emergencyEligibility.emergency_authorization;
        releaseType = "Emergency";
      }

      const gateReference = await generatePublicReference("GTO", client, "gate_out_records", "public_reference");
      const bin = await releaseBinIfNeeded(client, cargo);
      await executeTransition({workflowKey:'cargo_placement',transitionKey:'finalize_gate_release',cargoId:cargo.id,actor:req.auth,input:{confirmed:true},executor:client,lockedCargo:cargo});
      const gateResult = await client.query(
        `INSERT INTO gate_out_records (
           public_reference, cargo_id, dispatch_request_id, release_type,
           vehicle_number, driver_name, gate_notes, released_at, released_by,
           outstanding_amount_snapshot, eligibility_snapshot,eligibility_policy_key,eligibility_policy_revision,emergency_request_id
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)
         RETURNING *`,
        [
          gateReference,
          cargo.id,
          dispatchRequest?.id || emergencyRequest?.dispatch_request_id || null,
          releaseType,
          vehicleNumber,
          driverName,
          gateNotes || null,
          releaseAt,
          req.auth?.userId || null,
          eligibility.outstanding_amount,
          JSON.stringify(eligibility),eligibility.policy_key,eligibility.revision,emergencyRequest?.id||null
        ]
      );
      await client.query(
        `UPDATE cargo
         SET current_bin_id = NULL,
             location = 'Collected by Customer (Gate Out)',
             charge_end_at = $1,
             released_at = $1,
             dispatch_status = $2::varchar,
             gate_out_status = $3::varchar,
             financial_status = CASE
               WHEN $4::numeric > 0 AND $3::varchar = 'Emergency Released'::varchar THEN 'Released With Balance'::varchar
               WHEN $4::numeric > 0 THEN financial_status
               ELSE 'Fully Paid'
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [
          releaseAt,
          releaseType === "Emergency" ? "Emergency Released" : "Released",
          releaseType === "Emergency" ? "Emergency Released" : "Released",
          eligibility.outstanding_amount,
          cargo.id
        ]
      );
      if (dispatchRequest) {
        await client.query(
          `UPDATE dispatch_requests
           SET gate_released_at = $1,
               gate_released_by = $2,
               release_notes = $3
           WHERE id = $4`,
          [releaseAt, req.auth?.userId || null, gateNotes || null, dispatchRequest.id]
        );
      }
      if (emergencyRequest) {
        await client.query(
          `UPDATE emergency_release_requests
           SET status = 'Completed',
               gate_confirmed_by = $1,
               gate_confirmed_at = $2,
               consumed_at = $2,
               consumed_by = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [req.auth?.userId || null, releaseAt, emergencyRequest.id]
        );
      } else {
        await updateCargoFinancialStatus({ cargoId: cargo.id, at: releaseAt, executor: client });
      }
      await client.query(
        `INSERT INTO cargo_movements (
           cargo_id, from_bin_id, to_bin_id, from_location, to_location,
           moved_by, moved_by_user_id, warehouse_id_at_action, movement_type, action
         )
         VALUES ($1,$2,NULL,$3,'Gate Out',$4,$5,$6,$7,$7)`,
        [
          cargo.id,
          cargo.current_bin_id || null,
          cargo.location || null,
          req.auth?.username || "Gate Officer",
          req.auth?.userId || null,
          cargo.warehouse_id || null,
          releaseType === "Emergency" ? "Emergency Released" : "Released"
        ]
      );
      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          action: releaseType === "Emergency" ? "CONFIRM_EMERGENCY_GATE_OUT" : releaseType === "Management" ? "CONFIRM_MANAGEMENT_RELEASE_GATE_OUT" : "CONFIRM_GATE_OUT",
          module: "Dispatch and Gate",
          description: `Confirmed ${releaseType.toLowerCase()} gate-out for cargo ${cargo.cargo_id}.`,
          metadata: {
            entity_reference: gateReference,
            cargo_reference: cargo.cargo_id,
            release_type: releaseType,
            outstanding_amount: eligibility.outstanding_amount,
            bin_barcode: bin?.barcode || null
          }
        },
        client
      );
      if (releaseType === "Emergency" && eligibility.outstanding_amount !== "0.00") {
        await notifyEmergencyReleaseCompleted(
          {
            cargo,
            outstandingAmount: eligibility.outstanding_amount,
            actorId: req.auth?.userId || null
          },
          client
        );
      }
      const { resolveNotificationStrategy } = require("../services/notificationAuthorityService");
      await resolveNotificationStrategy("gate_released", { subjectReference: cargo.cargo_id, executor: client });
      return {
        gate_out_reference: gateResult.rows[0].public_reference,
        cargo_reference: cargo.cargo_id,
        release_type: releaseType,
        released_at: gateResult.rows[0].released_at,
        vehicle_number: gateResult.rows[0].vehicle_number,
        driver_name: gateResult.rows[0].driver_name,
        outstanding_amount: eligibility.outstanding_amount
      };
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    if(blockedManagementReleaseAttempt){
      try{await writeAuditLog({user_id:blockedManagementReleaseAttempt.actorId,action:"BLOCK_MANAGEMENT_RELEASE_GATE_OUT",module:"Dispatch and Gate",description:`Blocked Gate-Out for cargo ${blockedManagementReleaseAttempt.cargo.cargo_id}: ${blockedManagementReleaseAttempt.block.message}`,metadata:{cargo_reference:blockedManagementReleaseAttempt.cargo.cargo_id,reason_code:blockedManagementReleaseAttempt.block.reason_code,management_release_requirement:true}},db)}catch(auditError){console.error("Failed to audit blocked Management Release Gate-Out:",auditError.message)}
    }
    if (blockedReleaseNotification) {
      try {
        await notifyGateReleaseBlocked(blockedReleaseNotification);
      } catch (notificationError) {
        console.error("Failed to create gate release blocked notification:", notificationError.message);
      }
    }
    next(error);
  }
};

const getRecords = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
         gor.public_reference,
         c.cargo_id AS cargo_reference,
         c.barcode,
         gor.release_type,
         gor.vehicle_number,
         gor.driver_name,
         gor.gate_notes,
         gor.released_at,
         gor.outstanding_amount_snapshot,
         officer.full_name AS released_by_name,
         officer.username AS released_by_reference
       FROM gate_out_records gor
       JOIN cargo c ON c.id = gor.cargo_id
       LEFT JOIN users officer ON officer.id = gor.released_by
       ORDER BY gor.released_at DESC, gor.id DESC
       LIMIT 100`
    );
    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows.map((row) => ({
        gate_out_reference: row.public_reference,
        cargo_reference: row.cargo_reference,
        barcode: row.barcode,
        release_type: row.release_type,
        vehicle_number: row.vehicle_number,
        driver_name: row.driver_name,
        gate_notes: row.gate_notes,
        released_at: row.released_at,
        outstanding_amount: row.outstanding_amount_snapshot,
        released_by_name: row.released_by_name || row.released_by_reference || "Gate Officer"
      }))
    });
  } catch (error) {
    next(error);
  }
};

const requestEmergencyRelease = async (req, res, next) => {
  try {
    const data = await withTransaction(async (client) => {
      const cargoReference = cleanString(req.body.cargo_reference);
      const justification = cleanString(req.body.justification);
      if (!cargoReference || !justification) {
        throw buildError("Cargo reference and emergency justification are required.", 400);
      }
      const cargo = await findCargoByPublicReference(client, cargoReference, { lock: true });
      if (!cargo) throw buildError("Cargo record not found.", 404);
      const eligibility = await buildEligibility({ executor: client, cargo });
      if (eligibility.eligible) {
        throw buildError("Emergency release is not required because this cargo is eligible for normal release.", 409);
      }
      const existing = await client.query(
        `SELECT public_reference
         FROM emergency_release_requests
         WHERE cargo_id = $1
           AND status IN ('Pending', 'Approved')
         LIMIT 1`,
        [cargo.id]
      );
      if (existing.rowCount > 0) {
        throw buildError("An emergency release request is already pending or approved for this cargo.", 409);
      }
      const dispatchRequest = await getActiveDispatchRequest(client, cargo.id);
      const publicReference = await generatePublicReference("EMR", client, "emergency_release_requests", "public_reference");
      const result = await client.query(
        `INSERT INTO emergency_release_requests (
           public_reference, cargo_id, dispatch_request_id, requested_by,
           justification, blocked_requirements
         )
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         RETURNING *`,
        [
          publicReference,
          cargo.id,
          dispatchRequest?.id || null,
          req.auth?.userId || null,
          justification,
          JSON.stringify(eligibility.blocked_requirements)
        ]
      );
      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          action: "REQUEST_EMERGENCY_RELEASE",
          module: "Dispatch and Gate",
          description: `Requested emergency release for cargo ${cargo.cargo_id}.`,
          metadata: {
            entity_reference: publicReference,
            cargo_reference: cargo.cargo_id,
            reason: justification,
            blocked_requirements: eligibility.blocked_requirements
          }
        },
        client
      );
      return {
        emergency_release_reference: result.rows[0].public_reference,
        cargo_reference: cargo.cargo_id,
        status: result.rows[0].status,
        justification: result.rows[0].justification,
        blocked_requirements: eligibility.blocked_requirements,
        created_at: result.rows[0].created_at
      };
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const listEmergencyRequests = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
         err.public_reference,
         c.cargo_id AS cargo_reference,
         c.barcode,
         c.customs_status,
         c.financial_status,
         err.justification,
         err.blocked_requirements,
         err.status,
         err.decision_notes,
         err.approved_at,
         err.rejected_at,
         err.gate_confirmed_at,
         requester.full_name AS requested_by_name,
         approver.full_name AS approved_by_name,
         err.created_at
       FROM emergency_release_requests err
       JOIN cargo c ON c.id = err.cargo_id
       LEFT JOIN users requester ON requester.id = err.requested_by
       LEFT JOIN users approver ON approver.id = err.approved_by
       ORDER BY CASE WHEN err.status = 'Pending' THEN 0 WHEN err.status = 'Approved' THEN 1 ELSE 2 END,
                err.created_at DESC,
                err.id DESC
       LIMIT 100`
    );
    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows.map((row) => ({
        emergency_release_reference: row.public_reference,
        cargo_reference: row.cargo_reference,
        barcode: row.barcode,
        customs_status: row.customs_status,
        financial_status: row.financial_status,
        justification: row.justification,
        blocked_requirements: row.blocked_requirements || [],
        status: row.status,
        decision_notes: row.decision_notes,
        requested_by_name: row.requested_by_name,
        approved_by_name: row.approved_by_name,
        approved_at: row.approved_at,
        rejected_at: row.rejected_at,
        gate_confirmed_at: row.gate_confirmed_at,
        created_at: row.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
};

const decideEmergencyRequest = async (req, res, next, decision) => {
  try {
    const data = await withTransaction(async (client) => {
      const notes = cleanString(req.body.decision_notes);
      if (decision === "Rejected" && !notes) {
        throw buildError("Decision notes are required when rejecting an emergency release.", 400);
      }
      const requestResult = await client.query(
        `SELECT err.*, c.cargo_id
         FROM emergency_release_requests err
         JOIN cargo c ON c.id = err.cargo_id
         WHERE err.public_reference = $1
         LIMIT 1
         FOR UPDATE OF err`,
        [req.params.reference]
      );
      if (requestResult.rowCount === 0) throw buildError("Emergency release request not found.", 404);
      const request = requestResult.rows[0];
      if (request.status !== "Pending") {
        throw buildError(`Emergency release request is already ${request.status.toLowerCase()}.`, 409);
      }
      const result = await client.query(
        `UPDATE emergency_release_requests
           SET status = $1::varchar,
             decision_notes = $2,
             approved_by = CASE WHEN $1::varchar = 'Approved'::varchar THEN $3 ELSE approved_by END,
             approved_at = CASE WHEN $1::varchar = 'Approved'::varchar THEN CURRENT_TIMESTAMP ELSE approved_at END,
             rejected_by = CASE WHEN $1::varchar = 'Rejected'::varchar THEN $3 ELSE rejected_by END,
             rejected_at = CASE WHEN $1::varchar = 'Rejected'::varchar THEN CURRENT_TIMESTAMP ELSE rejected_at END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING *`,
        [decision, notes || null, req.auth?.userId || null, request.id]
      );
      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          action: decision === "Approved" ? "APPROVE_EMERGENCY_RELEASE" : "REJECT_EMERGENCY_RELEASE",
          module: "Dispatch and Gate",
          description: `${decision} emergency release request ${request.public_reference} for cargo ${request.cargo_id}.`,
          metadata: {
            entity_reference: request.public_reference,
            cargo_reference: request.cargo_id,
            before: { status: request.status },
            after: { status: decision },
            reason: notes || null
          }
        },
        client
      );
      return {
        emergency_release_reference: result.rows[0].public_reference,
        cargo_reference: request.cargo_id,
        status: result.rows[0].status,
        decision_notes: result.rows[0].decision_notes,
        approved_at: result.rows[0].approved_at,
        rejected_at: result.rows[0].rejected_at
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const approveEmergencyRequest = (req, res, next) => decideEmergencyRequest(req, res, next, "Approved");
const rejectEmergencyRequest = (req, res, next) => decideEmergencyRequest(req, res, next, "Rejected");

module.exports = {
  approveEmergencyRequest,
  confirmGateOut,
  getDashboard,
  getEligibility,
  getRecords,
  getReleaseQueue,
  listEmergencyRequests,
  rejectEmergencyRequest,
  requestEmergencyRelease
};
