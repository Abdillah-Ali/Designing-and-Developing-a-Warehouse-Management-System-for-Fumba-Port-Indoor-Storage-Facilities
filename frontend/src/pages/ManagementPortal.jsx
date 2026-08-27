import { useCallback, useEffect, useState } from "react";
import { BarChart3, Bell, ClipboardCheck, Database, LayoutDashboard, LogOut, UserCircle2, X } from "lucide-react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { HeaderActions } from "@/components/wms/HeaderActions";
import { NotificationsPage } from "@/components/wms/NotificationsPage";
import { AccountProfilePage } from "@/components/wms/ProfilePage";
import { DataTable, ErrorState, OperationalStatCard, PageHeader, SectionCard } from "@/components/wms/OperationalUi";
import { approveManagementRelease, getCargo, getCargoById, getManagementDashboard, getManagementReleaseRequests, rejectManagementRelease, logout, getManagementTariffApprovals, approveManagementTariff, rejectManagementTariff } from "@/services/api";
import { ManagementReports } from "@/components/wms/ManagementReports";

const navigation = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/management" },
  { label: "Cargo Oversight", icon: Database, to: "/management/cargo" },
  { label: "Executive Reports", icon: BarChart3, to: "/management/reports" },
  { label: "Release Requests", icon: ClipboardCheck, to: "/management/release-requests" },
  { label: "Tariff Approval Requests", icon: ClipboardCheck, to: "/management/tariff-approvals" },
  { label: "Notifications", icon: Bell, to: "/management/notifications" },
  { label: "Profile", icon: UserCircle2, to: "/management/profile" }
];

function useData(loader) {
  const [state, setState] = useState({ data: {}, loading: true, error: "" });
  useEffect(() => {
    loader().then((response) => setState({ data: response.data || {}, loading: false, error: "" }))
      .catch((error) => setState({ data: {}, loading: false, error: error.message }));
  }, [loader]);
  return state;
}

function Dashboard() {
  const state = useData(getManagementDashboard);
  const metrics = state.data.metrics || {};
  const cards = [
    ["Active Warehouses", metrics.active_warehouses],
    ["Active Users", metrics.active_users],
    ["Total Cargo", metrics.total_cargo],
    ["Pending Reviews", metrics.pending_reviews],
    ["Stored Cargo", metrics.stored_cargo],
    ["Released Cargo", metrics.released_cargo],
    ["Customs Holds", metrics.customs_holds],
    ["Outstanding Balance", metrics.outstanding_balance]
  ];
  return <>
    <PageHeader eyebrow="Management" title="Executive Dashboard" description="Read-only cross-module operational and financial KPIs." />
    <div className="flex-1 overflow-auto p-4">
      {state.error && <ErrorState message={state.error} />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map(([title, value]) => <OperationalStatCard key={title} title={title} icon={BarChart3} loading={state.loading} value={value} emptyTitle={`No ${title.toLowerCase()}`} tone="info" />)}
      </div>
    </div>
  </>;
}

function Reports() {
  return <ManagementReports/>;
}

function ReleaseRequests(){
  const [status,setStatus]=useState("PENDING"); const [refresh,setRefresh]=useState(0); const [busy,setBusy]=useState("");
  const [state,setState]=useState({data:[],loading:true,error:""});
  const [cargoDialog,setCargoDialog]=useState({row:null,data:null,loading:false,error:""});
  const [decisionDialog,setDecisionDialog]=useState(null);
  useEffect(()=>{let active=true;setState(current=>({...current,loading:true,error:""}));getManagementReleaseRequests({status}).then(response=>active&&setState({data:response.data||[],loading:false,error:""})).catch(error=>active&&setState({data:[],loading:false,error:error.message}));return()=>{active=false}},[status,refresh]);
  const viewCargo=async(row)=>{setCargoDialog({row,data:null,loading:true,error:""});try{const response=await getCargoById(row.cargo_reference);setCargoDialog({row,data:response.data,loading:false,error:""});}catch(error){setCargoDialog({row,data:null,loading:false,error:error.message});}};
  const act=async(row,decision,remarks)=>{setBusy(row.request_reference);try{if(decision==="approve")await approveManagementRelease(row.request_reference,remarks);else await rejectManagementRelease(row.request_reference,remarks);setDecisionDialog(null);setRefresh(v=>v+1)}finally{setBusy("")}};
  return <><PageHeader eyebrow="Management" title="Management Release Requests" description="Your explicit decision is mandatory before Gate-Out. Placement may continue while review is pending."/><div className="flex-1 overflow-auto p-4"><SectionCard title="Release queue" icon={ClipboardCheck}><div className="mb-3 flex gap-2">{["PENDING","APPROVED","REJECTED","ALL"].map(item=><button key={item} onClick={()=>setStatus(item)} className={`rounded border px-3 py-1.5 text-xs ${status===item?"bg-primary text-primary-foreground":"bg-secondary"}`}>{item[0]+item.slice(1).toLowerCase()}</button>)}</div><DataTable loading={state.loading} error={state.error} rows={state.data||[]} emptyTitle="No Management Release requests" columns={[{key:"cargo_reference",label:"Cargo Reference"},{key:"cargo_type",label:"Cargo"},{key:"consignee_name",label:"Owner / Customer",render:r=>r.company_name||r.consignee_name},{key:"warehouse_name",label:"Warehouse"},{key:"supervisor_name",label:"Supervisor"},{key:"request_reason",label:"Reason"},{key:"placement_status",label:"Placement"},{key:"management_release_status",label:"Release Status",render:r=>r.management_release_status==="PENDING"?"Gate-Out blocked — decision required":r.management_release_status},{key:"historical_accrued_amount",label:"Accrued"},{key:"requested_at",label:"Submitted",render:r=>new Date(r.requested_at).toLocaleString()},{key:"actions",label:"Decision",render:r=><div className="flex flex-wrap gap-2"><button onClick={()=>viewCargo(r)} className="rounded border border-border px-2 py-1 text-xs font-semibold">View</button>{r.management_release_status==="PENDING"?<><button disabled={busy===r.request_reference} onClick={()=>setDecisionDialog({row:r,decision:"approve"})} className="rounded bg-success px-2 py-1 text-xs text-success-foreground">Confirm Release</button><button disabled={busy===r.request_reference} onClick={()=>setDecisionDialog({row:r,decision:"reject"})} className="rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground">Reject</button></>:<span className="text-xs">{r.decision_remarks||"Decided"}</span>}</div>}]}/></SectionCard></div>{cargoDialog.row&&<CargoViewDialog state={cargoDialog} onClose={()=>setCargoDialog({row:null,data:null,loading:false,error:""})} onConfirm={(row)=>{setCargoDialog({row:null,data:null,loading:false,error:""});setDecisionDialog({row,decision:"approve"});}}/>} {decisionDialog&&<ReleaseDecisionDialog dialog={decisionDialog} busy={busy===decisionDialog.row.request_reference} onClose={()=>setDecisionDialog(null)} onSubmit={act}/>}</>;
}

function CargoViewDialog({state,onClose,onConfirm}){const cargo=state.data||{};const fields=[["Cargo reference",cargo.cargo_id||state.row.cargo_reference],["Barcode",cargo.barcode],["Cargo type",cargo.cargo_type],["Description",cargo.cargo_description],["Consignee",cargo.consignee_name],["Company",cargo.company_name],["Email",cargo.email],["Phone",cargo.phone],["Warehouse",cargo.warehouse_name||state.row.warehouse_name],["Registration",cargo.registration_status],["Placement",cargo.placement_status],["Current location",cargo.location],["Customs",cargo.customs_status],["Finance",cargo.financial_status],["Management release",cargo.management_release_status],["Dispatch",cargo.dispatch_status],["Gate status",cargo.gate_out_status],["Weight",cargo.weight],["Volume",cargo.volume],["Packages",cargo.package_count],["Release reason",state.row.request_reason],["Submitted",state.row.requested_at&&new Date(state.row.requested_at).toLocaleString()]];const pending=state.row.management_release_status==="PENDING";return <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"><div className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-lg border bg-card p-5 shadow-xl"><div className="flex items-center justify-between border-b pb-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary">Cargo details</p><h2 className="text-lg font-bold">{state.row.cargo_reference}</h2></div><button aria-label="Close cargo view" onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5"/></button></div>{state.loading?<p className="py-10 text-center text-sm text-muted-foreground">Loading cargo details…</p>:state.error?<div className="py-4"><ErrorState message={state.error}/></div>:<><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">{fields.map(([label,value])=><div key={label} className="rounded border bg-muted/20 p-3"><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value??"—"}</dd></div>)}</dl>{pending&&<div className="mt-5 flex justify-end border-t pt-4"><button onClick={()=>onConfirm(state.row)} className="rounded bg-success px-3 py-2 text-sm font-semibold text-success-foreground">Confirm Release</button></div>}</>}</div></div>}

function ReleaseDecisionDialog({dialog,busy,onClose,onSubmit}){const [remarks,setRemarks]=useState("");const reject=dialog.decision==="reject";const submit=(event)=>{event.preventDefault();if(reject&&!remarks.trim())return;onSubmit(dialog.row,dialog.decision,remarks.trim());};return <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"><form onSubmit={submit} className="w-full max-w-lg rounded-lg border bg-card p-5 shadow-xl"><div className="flex items-center justify-between border-b pb-3"><h2 className="text-lg font-bold">{reject?"Reject release request":"Confirm cargo release"}</h2><button type="button" aria-label="Close decision dialog" onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5"/></button></div><p className="mt-4 text-sm text-muted-foreground">Cargo: <strong className="text-foreground">{dialog.row.cargo_reference}</strong></p><label className="mt-4 block text-sm font-semibold">{reject?"Reason for rejection":"Release notes"}<textarea autoFocus value={remarks} onChange={event=>setRemarks(event.target.value)} required={reject} placeholder={reject?"Enter the reason for rejection":"Optional notes for this release decision"} className="mt-2 min-h-28 w-full rounded border bg-background p-3 text-sm"/></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded border px-3 py-2 text-sm font-semibold">Cancel</button><button disabled={busy} className={`rounded px-3 py-2 text-sm font-semibold text-white ${reject?"bg-destructive":"bg-success"}`}>{busy?"Saving…":reject?"Reject":"Confirm Release"}</button></div></form></div>}

function CargoOversight() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const state = useData(useCallback(() => getCargo({ limit: 200, ...(search.trim() ? { search: search.trim() } : {}) }), [search]));
  const detail = useData(useCallback(() => selected ? getCargoById(selected.cargo_id || selected.id) : Promise.resolve({ data: null }), [selected]));
  return <><PageHeader eyebrow="Management · Read only" title="Cargo Oversight" description="Inspect cargo lifecycle status without operational editing controls." />
    <div className="flex-1 overflow-auto p-4"><SectionCard title="Cargo records" icon={Database}><input aria-label="Search cargo" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reference, owner, or description" className="mb-3 w-full rounded border bg-background px-3 py-2 text-xs md:max-w-md" /><DataTable loading={state.loading} error={state.error} rows={state.data || []} emptyTitle="No cargo records" columns={[{ key: "cargo_id", label: "Reference" }, { key: "cargo_type", label: "Type" }, { key: "registration_status", label: "Registration" }, { key: "placement_status", label: "Placement" }, { key: "customs_status", label: "Customs" }, { key: "financial_status", label: "Finance" }, { key: "dispatch_status", label: "Dispatch" }, { key: "gate_out_status", label: "Gate" }, { key: "details", label: "", render: (row) => <button onClick={() => setSelected(row)} className="rounded border px-2 py-1 text-[11px]">Details</button> }]} /></SectionCard></div>
    {selected && <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4"><div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-md border bg-card p-4"><div className="flex justify-between"><h2 className="font-semibold">Cargo details</h2><button aria-label="Close cargo details" onClick={() => setSelected(null)}><X className="h-4 w-4" /></button></div>{detail.loading ? <p className="mt-4 text-sm text-muted-foreground">Loading cargo record…</p> : detail.error ? <ErrorState message={detail.error} /> : <dl className="mt-4 grid gap-3 text-xs md:grid-cols-3">{[["Reference", detail.data?.cargo_id], ["Registration", detail.data?.registration_status], ["Placement", detail.data?.placement_status], ["Customs", detail.data?.customs_status], ["Finance", detail.data?.financial_status], ["Dispatch", detail.data?.dispatch_status], ["Gate", detail.data?.gate_out_status], ["Management", detail.data?.management_release_status], ["Location", detail.data?.location]].map(([label, value]) => <div key={label}><dt className="font-semibold text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value || "—"}</dd></div>)}</dl>}</div></div>}</>;
}

function TariffApprovals(){const [refresh,setRefresh]=useState(0);const state=useData(useCallback(()=>getManagementTariffApprovals({status:"PENDING_APPROVAL",refresh}),[refresh]));const act=async(row,approve)=>{const reason=approve?"":window.prompt("Rejection reason (required)","");if(!approve&&!reason?.trim())return;if(approve)await approveManagementTariff(row.public_reference);else await rejectManagementTariff(row.public_reference,reason);setRefresh(v=>v+1)};return <><PageHeader eyebrow="Management" title="Tariff Approval Requests" description="Compare proposed rates and independently approve or reject Finance submissions."/><div className="flex-1 overflow-auto p-4"><SectionCard title="Pending tariff versions"><DataTable loading={state.loading} error={state.error} rows={state.data||[]} emptyTitle="No pending tariffs" columns={[{key:"public_reference",label:"Tariff Version"},{key:"tariff_name",label:"Name"},{key:"cargo_type",label:"Cargo Type"},{key:"charging_unit",label:"Basis"},{key:"currency",label:"Currency"},{key:"daily_rate",label:"Proposed Rate"},{key:"existing_approved_rate",label:"Existing Rate"},{key:"minimum_charge",label:"Minimum"},{key:"effective_from",label:"Effective"},{key:"submitted_by_name",label:"Submitted By"},{key:"supporting_notes",label:"Notes"},{key:"actions",label:"Decision",render:r=><div className="flex gap-2"><button onClick={()=>act(r,true)} className="rounded bg-success px-2 py-1 text-xs text-success-foreground">Approve</button><button onClick={()=>act(r,false)} className="rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground">Reject</button></div>}]}/></SectionCard></div></>}

export default function ManagementPortal() {
  const navigate = useNavigate();
  return <div className="flex h-screen bg-background">
    <aside className="flex w-64 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="border-b p-4"><div className="text-xs uppercase opacity-60">Management</div><div className="font-semibold">Executive Console</div></div>
      <nav className="flex-1 py-2">{navigation.map((item) => <NavLink key={item.to} to={item.to} end={item.to === "/management"} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-sidebar-accent"><item.icon className="h-4 w-4" />{item.label}</NavLink>)}</nav>
      <button className="m-3 flex items-center justify-center gap-2 rounded border p-2 text-xs" onClick={async()=>{await logout();navigate("/");}}><LogOut className="h-4 w-4"/>Exit</button>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col"><header className="flex h-14 items-center justify-between bg-header px-5 text-header-foreground"><span className="font-semibold">Fumba Port WMS</span><HeaderActions /></header>
      <Routes><Route index element={<Dashboard/>}/><Route path="dashboard" element={<Dashboard/>}/><Route path="cargo" element={<CargoOversight/>}/><Route path="reports" element={<Reports/>}/><Route path="release-requests" element={<ReleaseRequests/>}/><Route path="tariff-approvals" element={<TariffApprovals/>}/><Route path="notifications" element={<NotificationsPage/>}/><Route path="profile" element={<AccountProfilePage/>}/><Route path="*" element={<Navigate to="/management" replace/>}/></Routes>
    </div>
  </div>;
}
