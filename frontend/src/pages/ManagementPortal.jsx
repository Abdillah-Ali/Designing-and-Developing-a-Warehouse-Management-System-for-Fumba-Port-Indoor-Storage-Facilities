import { useEffect, useState } from "react";
import { BarChart3, Bell, ClipboardCheck, LayoutDashboard, LogOut, UserCircle2 } from "lucide-react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { HeaderActions } from "@/components/wms/HeaderActions";
import { NotificationsPage } from "@/components/wms/NotificationsPage";
import { AccountProfilePage } from "@/components/wms/ProfilePage";
import { DataTable, ErrorState, OperationalStatCard, PageHeader, SectionCard } from "@/components/wms/OperationalUi";
import { approveManagementRelease, getManagementDashboard, getManagementReleaseRequests, getManagementReports, rejectManagementRelease, logout } from "@/services/api";

const navigation = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/management" },
  { label: "Executive Reports", icon: BarChart3, to: "/management/reports" },
  { label: "Release Requests", icon: ClipboardCheck, to: "/management/release-requests" },
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
  const state = useData(getManagementReports);
  return <>
    <PageHeader eyebrow="Management" title="Executive Reports" description="Read-only cargo, finance, and release analytics." />
    <div className="flex-1 overflow-auto p-4 grid gap-4 xl:grid-cols-2">
      <SectionCard title="Cargo by Type"><DataTable loading={state.loading} error={state.error} rows={state.data.cargo_by_type || []} columns={[{key:"cargo_type",label:"Cargo Type"},{key:"cargo_count",label:"Count"}]} /></SectionCard>
      <SectionCard title="Invoices by Status"><DataTable loading={state.loading} error={state.error} rows={state.data.invoices_by_status || []} columns={[{key:"status",label:"Status"},{key:"invoice_count",label:"Count"},{key:"total_amount",label:"Total"}]} /></SectionCard>
      <SectionCard title="Releases by Date"><DataTable loading={state.loading} error={state.error} rows={state.data.releases_by_date || []} columns={[{key:"release_date",label:"Date"},{key:"release_count",label:"Releases"}]} /></SectionCard>
      <SectionCard title="Management Release"><DataTable loading={state.loading} error={state.error} rows={state.data.management_release_summary || []} columns={[{key:"management_release_status",label:"Classification"},{key:"cargo_count",label:"Cargo"},{key:"waived_amount",label:"Waived Amount"}]} /></SectionCard>
    </div>
  </>;
}

function ReleaseRequests(){
  const [status,setStatus]=useState("PENDING"); const [refresh,setRefresh]=useState(0); const [busy,setBusy]=useState("");
  const [state,setState]=useState({data:[],loading:true,error:""});
  useEffect(()=>{let active=true;setState(current=>({...current,loading:true,error:""}));getManagementReleaseRequests({status}).then(response=>active&&setState({data:response.data||[],loading:false,error:""})).catch(error=>active&&setState({data:[],loading:false,error:error.message}));return()=>{active=false}},[status,refresh]);
  const act=async(row,decision)=>{const remarks=window.prompt(decision==="approve"?"Management approval remarks (optional)":"Reason for rejection (required)","");if(remarks===null||decision==="reject"&&!remarks.trim())return;setBusy(row.request_reference);try{if(decision==="approve")await approveManagementRelease(row.request_reference,remarks);else await rejectManagementRelease(row.request_reference,remarks);setRefresh(v=>v+1)}finally{setBusy("")}};
  return <><PageHeader eyebrow="Management" title="Management Release Requests" description="Your explicit decision is mandatory before Gate-Out. Placement may continue while review is pending."/><div className="flex-1 overflow-auto p-4"><SectionCard title="Release queue" icon={ClipboardCheck}><div className="mb-3 flex gap-2">{["PENDING","APPROVED","REJECTED","ALL"].map(item=><button key={item} onClick={()=>setStatus(item)} className={`rounded border px-3 py-1.5 text-xs ${status===item?"bg-primary text-primary-foreground":"bg-secondary"}`}>{item[0]+item.slice(1).toLowerCase()}</button>)}</div><DataTable loading={state.loading} error={state.error} rows={state.data||[]} emptyTitle="No Management Release requests" columns={[{key:"cargo_reference",label:"Cargo Reference"},{key:"cargo_type",label:"Cargo"},{key:"consignee_name",label:"Owner / Customer",render:r=>r.company_name||r.consignee_name},{key:"warehouse_name",label:"Warehouse"},{key:"supervisor_name",label:"Supervisor"},{key:"request_reason",label:"Reason"},{key:"placement_status",label:"Placement"},{key:"management_release_status",label:"Release Status",render:r=>r.management_release_status==="PENDING"?"Gate-Out blocked — decision required":r.management_release_status},{key:"historical_accrued_amount",label:"Accrued"},{key:"requested_at",label:"Submitted",render:r=>new Date(r.requested_at).toLocaleString()},{key:"actions",label:"Decision",render:r=>r.management_release_status==="PENDING"?<div className="flex gap-2"><button disabled={busy===r.request_reference} onClick={()=>act(r,"approve")} className="rounded bg-success px-2 py-1 text-xs text-success-foreground">Confirm Release</button><button disabled={busy===r.request_reference} onClick={()=>act(r,"reject")} className="rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground">Reject</button></div>:r.decision_remarks||"Decided"}]}/></SectionCard></div></>;
}

export default function ManagementPortal() {
  const navigate = useNavigate();
  return <div className="flex h-screen bg-background">
    <aside className="flex w-64 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="border-b p-4"><div className="text-xs uppercase opacity-60">Management</div><div className="font-semibold">Executive Console</div></div>
      <nav className="flex-1 py-2">{navigation.map((item) => <NavLink key={item.to} to={item.to} end={item.to === "/management"} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-sidebar-accent"><item.icon className="h-4 w-4" />{item.label}</NavLink>)}</nav>
      <button className="m-3 flex items-center justify-center gap-2 rounded border p-2 text-xs" onClick={async()=>{await logout();navigate("/");}}><LogOut className="h-4 w-4"/>Exit</button>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col"><header className="flex h-14 items-center justify-between bg-header px-5 text-header-foreground"><span className="font-semibold">Fumba Port WMS</span><HeaderActions /></header>
      <Routes><Route index element={<Dashboard/>}/><Route path="dashboard" element={<Dashboard/>}/><Route path="reports" element={<Reports/>}/><Route path="release-requests" element={<ReleaseRequests/>}/><Route path="notifications" element={<NotificationsPage/>}/><Route path="profile" element={<AccountProfilePage/>}/><Route path="*" element={<Navigate to="/management" replace/>}/></Routes>
    </div>
  </div>;
}
