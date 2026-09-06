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
const {
  compareFpfg,
  paginate,
  queueState,
  validatePresenceChange
} = require("../services/gateQueueService");

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
    c.management_release_decided_at,
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
    c.fully_paid_at,
    c.collection_status,
    c.customer_presence_status,
    c.customer_present_at,
    c.presence_recorded_by,
    c.collector_details,
    c.collection_status_reason,
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
  fully_paid_at: row.fully_paid_at,
  latest_fully_paid_at: row.latest_fully_paid_at || row.fully_paid_at || row.management_release_decided_at,
  collection_status: row.collection_status,
  presence_status: row.customer_presence_status,
  customer_present_at: row.customer_present_at,
  collector_details: row.collector_details || {},
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

const buildAuthoritativeGateQueue = async ({ executor = db, at = null } = {}) => {
  const calculationTime = at || await getServerNow(executor);
  const result = await executor.query(
    `${gateCargoSelect}
     WHERE c.is_deleted=FALSE AND c.gate_out_status='Not Released'
     ORDER BY COALESCE(c.fully_paid_at,c.management_release_decided_at) ASC NULLS LAST,
              c.created_at ASC,c.cargo_id ASC`
  );
  const rows = [];
  for (const source of result.rows) {
    let eligibility;
    try {
      eligibility = await buildEligibility({executor,cargo:{...source,id:source.cargo_record_id},at:calculationTime});
    } catch (error) {
      eligibility={eligible:false,outstanding_amount:'0.00',blocked_requirements:[{requirement:'release',message:error.message}]};
    }
    const current=(await executor.query(`SELECT financial_status,fully_paid_at,collection_status,
      customer_presence_status,customer_present_at,presence_recorded_by,collector_details,
      collection_status_reason,management_release_decided_at FROM cargo WHERE id=$1`,[source.cargo_record_id])).rows[0]||{};
    const invoice=(await executor.query(`SELECT COALESCE(SUM(penalties),0) penalties,
      COALESCE(SUM(outstanding_balance),0) outstanding FROM invoices
      WHERE cargo_id=$1 AND status NOT IN ('Cancelled','Draft')`,[source.cargo_record_id])).rows[0]||{};
    const latestPaid=current.fully_paid_at || (source.management_release_status==='APPROVED' ? current.management_release_decided_at : null);
    const financialCleared=(source.management_release_status==='APPROVED' || Number(invoice.outstanding)===0) && Boolean(latestPaid);
    const operationalBlocks=(eligibility.blocked_requirements||[]).filter(item=>item.requirement!=='payment');
    if (!['Placed','Relocated'].includes(source.placement_status)) operationalBlocks.push({requirement:'warehouse_processing',message:'Required warehouse release processing is incomplete.'});
    const operationallyEligible=operationalBlocks.length===0;
    const present=current.customer_presence_status==='PRESENT_READY';
    const row={...toGateCargo({...source,...current,latest_fully_paid_at:latestPaid},{...eligibility,eligible:operationallyEligible&&financialCleared,blocked_requirements:[...(eligibility.blocked_requirements||[]),...(!latestPaid?[{requirement:'payment',message:'A verified latest full-settlement timestamp is required.'}]:[])]}),
      _cargo_record_id:source.cargo_record_id,latest_fully_paid_at:latestPaid,registration_time:source.created_at,
      payment_status:financialCleared?'Fully Paid':current.financial_status,
      penalty_status:Number(invoice.penalties)>0?(Number(invoice.outstanding)>0?'Unpaid':'Paid'):'None',
      penalty_amount:String(invoice.penalties||'0.00'),outstanding_balance:String(invoice.outstanding||'0.00'),
      financially_cleared:financialCleared,operationally_eligible:operationallyEligible,
      customer_present:present,allowed_to_gate_out:false,queue_position:null,blocked_reason:null};
    rows.push(row);
  }
  rows.sort(compareFpfg);
  let eligiblePosition=0;
  const presentEligible=[];
  for (const row of rows) {
    if(row.financially_cleared&&row.operationally_eligible) row.queue_position=++eligiblePosition;
    if(row.financially_cleared&&row.operationally_eligible&&row.customer_present) presentEligible.push(row);
  }
  const firstPresent=presentEligible[0]||null;
  for (const row of rows) {
    row.allowed_to_gate_out=Boolean(firstPresent&&row.cargo_reference===firstPresent.cargo_reference);
    row.queue_state=queueState({operationallyEligible:row.operationally_eligible,financiallyCleared:row.financially_cleared,present:row.customer_present,firstPresent:row.allowed_to_gate_out});
    row.blocked_reason=row.allowed_to_gate_out?null:row.queue_state;
    row.collection_status=!row.financially_cleared?'FINANCIALLY_BLOCKED':!row.operationally_eligible?'RELEASE_CONDITION_BLOCKED':row.customer_present?'PRESENT_READY':row.presence_status;
    await executor.query('UPDATE cargo SET collection_status=$2 WHERE id=$1 AND collection_status IS DISTINCT FROM $2',[row._cargo_record_id,row.collection_status]);
  }
  return {rows,calculationTime,firstPresent};
};

const getReleaseQueue = async (req, res, next) => {
  try {
    const queue=await buildAuthoritativeGateQueue({executor:db});
    const search=cleanString(req.query.search).toLowerCase();
    const filtered=search?queue.rows.filter(row=>[row.cargo_reference,row.barcode,row.consignee_name,row.owner_information].some(value=>String(value||'').toLowerCase().includes(search))):queue.rows;
    const page=paginate(filtered,req.query.page,req.query.page_size||req.query.limit);
    const data=page.rows.map(({_cargo_record_id,registration_time,...row})=>row);
    res.json({success:true,count:data.length,data,pagination:{page:page.page,page_size:page.page_size,total:page.total,total_pages:page.total_pages},current_allowed_cargo:queue.firstPresent?.cargo_reference||null,calculation_time:queue.calculationTime});
  } catch (error) { next(error); }
};

const updateCustomerPresence = async (req,res,next) => {
  try {
    const data=await withTransaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtext('gate_fpfg_normal_release'))");
      const cargo=await findCargoByPublicReference(client,req.params.cargoReference,{lock:true});
      if(!cargo) throw buildError('Cargo record not found.',404);
      if(cargo.gate_out_status!=='Not Released') throw buildError('Customer presence cannot change after Gate-Out.',409);
      const newStatus=cleanString(req.body.status).toUpperCase();
      const reason=cleanString(req.body.reason);
      validatePresenceChange({oldStatus:cargo.customer_presence_status,newStatus,reason});
      const collectorDetails={collector_name:cleanString(req.body.collector_name)||null,identity_type:cleanString(req.body.identity_type)||null,identity_number:cleanString(req.body.identity_number)||null,authorization_reference:cleanString(req.body.authorization_reference)||null};
      const updated=(await client.query(`UPDATE cargo SET customer_presence_status=$1::varchar,
        customer_present_at=CASE WHEN $1::varchar='PRESENT_READY'::varchar THEN clock_timestamp() ELSE NULL END,
        presence_recorded_by=$2,collector_details=$3::jsonb,collection_status_reason=$4,
        updated_at=CURRENT_TIMESTAMP WHERE id=$5 RETURNING *`,[newStatus,req.auth?.userId||null,JSON.stringify(collectorDetails),reason||null,cargo.id])).rows[0];
      await client.query(`INSERT INTO cargo_collection_status_history
        (cargo_id,cargo_reference,old_status,new_status,reason,collector_details,changed_by)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,[cargo.id,cargo.cargo_id,cargo.customer_presence_status,newStatus,reason||null,JSON.stringify(collectorDetails),req.auth?.userId||null]);
      await writeAuditLog({user_id:req.auth?.userId||null,action:newStatus==='PRESENT_READY'?'MARK_CUSTOMER_PRESENT':'CHANGE_CUSTOMER_PRESENCE',module:'Dispatch and Gate',description:`Changed customer presence for cargo ${cargo.cargo_id} from ${cargo.customer_presence_status} to ${newStatus}.`,metadata:{cargo_reference:cargo.cargo_id,before:{presence_status:cargo.customer_presence_status},after:{presence_status:newStatus},reason:reason||null,collector_details:collectorDetails}},client);
      return {cargo_reference:cargo.cargo_id,presence_status:updated.customer_presence_status,customer_present_at:updated.customer_present_at,collector_details:updated.collector_details,reason:updated.collection_status_reason};
    });
    res.json({success:true,data});
  } catch(error){next(error);}
};

const getEligibility = async (req, res, next) => {
  try {
    const cargo = await findCargoByPublicReference(db, req.params.cargoReference);
    if (!cargo) throw buildError("Cargo record not found.", 404);
    const queue=await buildAuthoritativeGateQueue({executor:db});
    const queued=queue.rows.find(row=>row.cargo_reference===cargo.cargo_id);
    const eligibility = queued?.release_eligibility || await buildEligibility({ executor: db, cargo });
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
        latest_fully_paid_at:queued?.latest_fully_paid_at||cargo.fully_paid_at,
        presence_status:queued?.presence_status||cargo.customer_presence_status,
        customer_present_at:queued?.customer_present_at||cargo.customer_present_at,
        queue_position:queued?.queue_position||null,
        queue_state:queued?.queue_state||'Release Condition Blocked',
        allowed_to_gate_out:queued?.allowed_to_gate_out||false,
        outstanding_balance:queued?.outstanding_balance||eligibility.outstanding_amount,
        penalty_status:queued?.penalty_status||'None',
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
  let blockedQueueAttempt = null;
  let blockedFinancialAttempt = null;

  try {
    const data = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('gate_fpfg_normal_release'))");
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
      if(cargo.customer_presence_status!=='PRESENT_READY'){
        blockedQueueAttempt={cargo_reference:cargo.cargo_id,actorId:req.auth?.userId||null,action:'BLOCK_GATE_OUT_CUSTOMER_ABSENT',reason:'Customer or authorized collector must be marked present before Gate-Out.'};
        throw buildError(blockedQueueAttempt.reason,409,null,'CUSTOMER_NOT_PRESENT');
      }
      const releaseAt = await getServerNow(client);
      const dispatchRequest = await activeDispatch(client, cargo.id, true);
      const eligibility = await buildEligibility({ executor: client, cargo, at: releaseAt });
      let releaseType = cargo.management_release_status === "APPROVED" ? "Management" : "Normal";
      let emergencyRequest = null;

      if (eligibility.eligible) {
        const queue=await buildAuthoritativeGateQueue({executor:client,at:releaseAt});
        const target=queue.rows.find(row=>row.cargo_reference===cargo.cargo_id);
        if(!target?.customer_present) {
          blockedQueueAttempt={cargo_reference:cargo.cargo_id,actorId:req.auth?.userId||null,action:'BLOCK_GATE_OUT_CUSTOMER_ABSENT',reason:'Customer or authorized collector must be marked present before Gate-Out.'};
          throw buildError(blockedQueueAttempt.reason,409,null,'CUSTOMER_NOT_PRESENT');
        }
        if(!target.allowed_to_gate_out) {
          blockedQueueAttempt={cargo_reference:cargo.cargo_id,actorId:req.auth?.userId||null,action:'BLOCK_FPFG_BYPASS',reason:'An earlier eligible cargo is currently present and must be processed first.',earlier_cargo_reference:queue.firstPresent?.cargo_reference||null};
          throw buildError(blockedQueueAttempt.reason,409,{earlier_cargo_reference:blockedQueueAttempt.earlier_cargo_reference},'FPFG_ORDER_VIOLATION');
        }
        for(const skipped of queue.rows){
          if(skipped.cargo_reference===target.cargo_reference) break;
          if(skipped.allowed_to_gate_out) continue;
          await writeAuditLog({user_id:req.auth?.userId||null,action:'LEGITIMATE_FPFG_SKIP',module:'Dispatch and Gate',description:`Skipped earlier FPFG cargo ${skipped.cargo_reference} while processing ${cargo.cargo_id} because it was not ready.`,metadata:{cargo_reference:skipped.cargo_reference,processed_cargo_reference:cargo.cargo_id,reason:skipped.queue_state,presence_status:skipped.presence_status,outstanding_balance:skipped.outstanding_balance}},client);
        }
        await client.query("UPDATE cargo SET collection_status='GATE_PROCESSING',updated_at=CURRENT_TIMESTAMP WHERE id=$1",[cargo.id]);
      }

      if (!eligibility.eligible) {
        const managementBlock=eligibility.blocked_requirements.find((item)=>item.requirement==="management_release");
        const emergencyReference = cleanString(req.body.emergency_request_reference);
        if (!emergencyReference) {
          if (eligibility.blocked_requirements.some((item) => item.requirement === "payment")) {
            const penalty=(await client.query("SELECT COALESCE(SUM(penalties),0) amount FROM invoices WHERE cargo_id=$1 AND status NOT IN ('Cancelled','Draft')",[cargo.id])).rows[0]?.amount||'0.00';
            blockedFinancialAttempt={cargo_reference:cargo.cargo_id,actorId:req.auth?.userId||null,outstanding_amount:eligibility.outstanding_amount,penalty_amount:String(penalty),action:Number(penalty)>0?'BLOCK_GATE_OUT_UNPAID_PENALTY':'BLOCK_GATE_OUT_UNPAID_BALANCE'};
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
           outstanding_amount_snapshot, eligibility_snapshot,eligibility_policy_key,eligibility_policy_revision,emergency_request_id,
           customer_present_at,collector_details
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16::jsonb)
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
          JSON.stringify(eligibility),eligibility.policy_key,eligibility.revision,emergencyRequest?.id||null,
          cargo.customer_present_at||null,JSON.stringify(cargo.collector_details||{})
        ]
      );
      await client.query(
        `UPDATE cargo
         SET current_bin_id = NULL,
             location = 'Collected by Customer (Gate Out)',
             charge_end_at = $1::timestamptz AT TIME ZONE current_setting('TimeZone'),
             released_at = $1::timestamptz AT TIME ZONE current_setting('TimeZone'),
             dispatch_status = $2::varchar,
             gate_out_status = $3::varchar,
             collection_status = 'GATED_OUT',
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
    if(blockedFinancialAttempt){
      try{await writeAuditLog({user_id:blockedFinancialAttempt.actorId,action:blockedFinancialAttempt.action,module:'Dispatch and Gate',description:`Blocked Gate-Out for cargo ${blockedFinancialAttempt.cargo_reference} due to an outstanding financial balance.`,metadata:blockedFinancialAttempt},db)}catch(auditError){console.error('Failed to audit financially blocked Gate-Out:',auditError.message)}
    }
    if(blockedQueueAttempt){
      try{await writeAuditLog({user_id:blockedQueueAttempt.actorId,action:blockedQueueAttempt.action,module:'Dispatch and Gate',description:`Blocked Gate-Out for cargo ${blockedQueueAttempt.cargo_reference}: ${blockedQueueAttempt.reason}`,metadata:{cargo_reference:blockedQueueAttempt.cargo_reference,reason:blockedQueueAttempt.reason,earlier_cargo_reference:blockedQueueAttempt.earlier_cargo_reference||null,reason_code:error.errorCode||error.code||null}},db)}catch(auditError){console.error('Failed to audit blocked FPFG Gate-Out:',auditError.message)}
    }
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
    const pageSize=[10,20,50,100].includes(Number(req.query.page_size))?Number(req.query.page_size):10;
    const page=Math.max(Number(req.query.page)||1,1);
    const total=Number((await db.query('SELECT COUNT(*)::int total FROM gate_out_records')).rows[0]?.total||0);
    const totalPages=Math.max(1,Math.ceil(total/pageSize));
    const currentPage=Math.min(page,totalPages);
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
       LIMIT $1 OFFSET $2`,[pageSize,(currentPage-1)*pageSize]
    );
    res.json({
      success: true,
      count: result.rowCount,
      pagination:{page:currentPage,page_size:pageSize,total,total_pages:totalPages},
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
  ,updateCustomerPresence
};
