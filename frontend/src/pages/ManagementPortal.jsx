import { useEffect, useState } from "react";
import { BarChart3, Bell, LayoutDashboard, LogOut, UserCircle2 } from "lucide-react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { HeaderActions } from "@/components/wms/HeaderActions";
import { NotificationsPage } from "@/components/wms/NotificationsPage";
import { AccountProfilePage } from "@/components/wms/ProfilePage";
import { DataTable, ErrorState, OperationalStatCard, PageHeader, SectionCard } from "@/components/wms/OperationalUi";
import { getManagementDashboard, getManagementReports, logout } from "@/services/api";

const navigation = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/management" },
  { label: "Executive Reports", icon: BarChart3, to: "/management/reports" },
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
    <div className="flex-1 overflow-auto p-4 grid gap-4 xl:grid-cols-3">
      <SectionCard title="Cargo by Type"><DataTable loading={state.loading} error={state.error} rows={state.data.cargo_by_type || []} columns={[{key:"cargo_type",label:"Cargo Type"},{key:"cargo_count",label:"Count"}]} /></SectionCard>
      <SectionCard title="Invoices by Status"><DataTable loading={state.loading} error={state.error} rows={state.data.invoices_by_status || []} columns={[{key:"status",label:"Status"},{key:"invoice_count",label:"Count"},{key:"total_amount",label:"Total"}]} /></SectionCard>
      <SectionCard title="Releases by Date"><DataTable loading={state.loading} error={state.error} rows={state.data.releases_by_date || []} columns={[{key:"release_date",label:"Date"},{key:"release_count",label:"Releases"}]} /></SectionCard>
    </div>
  </>;
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
      <Routes><Route index element={<Dashboard/>}/><Route path="dashboard" element={<Dashboard/>}/><Route path="reports" element={<Reports/>}/><Route path="notifications" element={<NotificationsPage/>}/><Route path="profile" element={<AccountProfilePage/>}/><Route path="*" element={<Navigate to="/management" replace/>}/></Routes>
    </div>
  </div>;
}
