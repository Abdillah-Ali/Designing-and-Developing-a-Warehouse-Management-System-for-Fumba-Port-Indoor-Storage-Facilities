const db = require("../config/db");
const { listFinanceCalculators } = require("./financeCalculatorRegistry");
const { chargingUnits } = require("./financeService");

const validateFinanceConfiguration = async (executor=db) => {
  const issues=[];
  const schema=await executor.query(`SELECT to_regclass('public.tariff_versions') tariffs,to_regclass('public.invoices') invoices,to_regclass('public.payments') payments`);
  if (!schema.rows[0]?.tariffs || !schema.rows[0]?.invoices || !schema.rows[0]?.payments) return {ready:false,status:'blocked',issues:[{code:'FINANCE_SCHEMA_UNAVAILABLE',message:'Authoritative Finance schema is unavailable.',impact:'blocked'}]};
  const calculators=new Set(listFinanceCalculators().map((item)=>item.calculator_key));
  const tariffs=await executor.query(`SELECT tv.public_reference,tv.calculator_key,tv.currency,tv.configuration_status,tv.effective_from,tv.effective_to,tv.daily_rate,tv.tariff_scope,tv.cargo_type_key,tv.charging_unit,tv.minimum_billable_days FROM tariff_versions tv WHERE tv.is_active=TRUE`);
  let usableTariffs=0;
  const now=Date.now();
  for (const tariff of tariffs.rows) {
    let usable=true;
    if (!calculators.has(tariff.calculator_key)) {usable=false;issues.push({code:'FINANCE_CALCULATOR_UNKNOWN',reference:tariff.public_reference,message:'An active tariff uses an unknown calculator.',impact:'blocked'});}
    if (tariff.currency!=='TZS') {usable=false;issues.push({code:'FINANCE_CURRENCY_INVALID',reference:tariff.public_reference,message:'An active tariff is not denominated in TZS.',impact:'blocked'});}
    if (tariff.configuration_status!=='ready') {usable=false;issues.push({code:'FINANCE_TARIFF_REVIEW_REQUIRED',reference:tariff.public_reference,message:'A tariff requires review before authoritative use.',impact:'blocked'});}
    if (Number(tariff.daily_rate)<0 || !chargingUnits.has(tariff.charging_unit) || Number(tariff.minimum_billable_days)<1 || (tariff.effective_to && new Date(tariff.effective_to)<=new Date(tariff.effective_from))) {usable=false;issues.push({code:'FINANCE_TARIFF_INVALID',reference:tariff.public_reference,message:'An active tariff has invalid policy values.',impact:'blocked'});}
    const effectiveNow=new Date(tariff.effective_from).getTime()<=now && (!tariff.effective_to || new Date(tariff.effective_to).getTime()>now);
    if (usable && effectiveNow) usableTariffs+=1;
  }
  const overlaps=await executor.query(`SELECT a.public_reference FROM tariff_versions a JOIN tariff_versions b ON a.id<b.id AND a.is_active AND b.is_active AND a.configuration_status='ready' AND b.configuration_status='ready' AND a.tariff_scope=b.tariff_scope AND a.cargo_type_key IS NOT DISTINCT FROM b.cargo_type_key AND a.effective_from<COALESCE(b.effective_to,'infinity') AND b.effective_from<COALESCE(a.effective_to,'infinity') LIMIT 10`);
  overlaps.rows.forEach((row)=>issues.push({code:'FINANCE_TARIFF_OVERLAP',reference:row.public_reference,message:'Active tariff periods overlap ambiguously.',impact:'blocked'}));
  if (usableTariffs===0) issues.push({code:'NO_ACTIVE_USABLE_TARIFF',message:'Storage charging requires at least one active authoritative tariff.',impact:'configuration_required'});
  const uncovered=await executor.query(`SELECT c.cargo_id FROM cargo c WHERE c.is_deleted=FALSE AND c.charge_end_at IS NULL AND NOT EXISTS (SELECT 1 FROM tariff_versions tv WHERE tv.is_active AND tv.configuration_status='ready' AND (tv.cargo_type_key=c.cargo_type_key OR tv.tariff_scope='default') AND tv.effective_from<=c.charge_start_at AND COALESCE(tv.effective_to,'infinity')>c.charge_start_at) LIMIT 10`);
  uncovered.rows.forEach((row)=>issues.push({code:'FINANCE_TARIFF_GAP',reference:row.cargo_id,message:'Active cargo has no tariff at its charging origin.',impact:'blocked'}));
  const blocked=issues.some((issue)=>issue.impact==='blocked');
  return {ready:issues.length===0,status:blocked?'blocked':issues.length?'configuration_required':'healthy',issues,active_tariffs:tariffs.rowCount,usable_tariffs:usableTariffs,invalid_tariffs:issues.filter((issue)=>issue.impact==='blocked').length};
};
module.exports={validateFinanceConfiguration};
