const q=(v)=>encodeURIComponent(String(v||""));
const cargo=(c)=>c.cargo?.cargo_id||c.cargo?.public_reference||c.subject_reference;
const builders=Object.freeze({
  none:()=>null,
  cargo_review:(c)=>`/supervisor/cargo/pending-approvals?cargoRef=${q(cargo(c))}`,
  cargo_correction:(c)=>`/staff/cargo/registration?tab=reviews&cargoRef=${q(cargo(c))}`,
  placement_override:(c)=>`/supervisor/cargo/exceptions?cargoRef=${q(cargo(c))}`,
  staff_placement:(c)=>`/staff/cargo/registration?tab=placement&cargoRef=${q(cargo(c))}`,
  dispatch_request:(c)=>`/supervisor/dispatch/requests?cargoRef=${q(cargo(c))}`,
  staff_dispatch:(c)=>`/staff/dispatch/queue?cargo=${q(cargo(c))}`,
  customs_queue:(c)=>`/customs/inspection-queue?search=${q(cargo(c))}`,
  gate_release:(c)=>`/gate/release-queue?search=${q(cargo(c))}`,
  finance_cargo:(c)=>`/finance/cargo-charges?search=${q(cargo(c))}`
});
const getDeepLinkBuilder=(key)=>builders[key]||null;
module.exports={getDeepLinkBuilder};
