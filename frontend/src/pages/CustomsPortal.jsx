import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  CheckCircle2,
  ClipboardList,
  FileQuestion,
  History,
  LayoutDashboard,
  LogOut,
  PackageSearch,
  PlayCircle,
  ShieldCheck,
  UserCircle2,
  XCircle
} from "lucide-react";
import { HeaderActions } from "@/components/wms/HeaderActions";
import { RoleReports } from "@/components/wms/RoleReports";
import { NotificationsPage } from "@/components/wms/NotificationsPage";
import { AccountProfilePage } from "@/components/wms/ProfilePage";
import { CollapsibleSidebar } from "@/components/wms/CollapsibleSidebar";
import {
  DataTable,
  ErrorState,
  OperationalStatCard,
  PageHeader,
  SectionCard,
  StatusBadge
} from "@/components/wms/OperationalUi";
import { cn } from "@/lib/utils";
import { formatDateTime, getErrorMessage, statusTone } from "@/lib/wms-operational";
import {
  getCustomsCleared,
  getCustomsCargo,
  getCustomsDashboard,
  getCustomsDocumentContent,
  getCustomsHistory,
  getCustomsHolds,
  getCustomsQueue,
  getCustomsRecords,
  logout,
  startCustomsInspection,
  updateCustomsStatus
} from "@/services/api";

const inputClass = "h-9 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

const navigation = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/customs" },
  { label: "Inspection Queue", icon: PackageSearch, to: "/customs/inspection-queue" },
  { label: "Inspections", icon: ClipboardList, to: "/customs/records" },
  { label: "Cleared Cargo", icon: CheckCircle2, to: "/customs/cleared" },
  { label: "Cargo on Hold", icon: AlertTriangle, to: "/customs/holds" },
  { label: "Reports", icon: BarChart3, to: "/customs/reports" },
  { label: "Notifications", icon: Bell, to: "/customs/notifications" },
  { label: "Profile", icon: UserCircle2, to: "/customs/profile" }
];

function useLoad(loader, key = "") {
  const [state, setState] = useState({ data: null, rows: [], loading: true, error: "" });
  const loaderRef = useRef(loader);

  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await loaderRef.current();
      setState({ data: response.data || null, rows: response.data || [], loading: false, error: "" });
    } catch (error) {
      setState({ data: null, rows: [], loading: false, error: getErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, key]);

  return { ...state, refresh: load };
}

function CustomsSidebar() {
  const navigate = useNavigate();
  return <CollapsibleSidebar navigation={navigation} basePath="/customs" role="Customs Officer" consoleName="Inspection Console" onExit={async () => { await logout(); navigate("/"); }} />;
}

function CustomsLayout({ children }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-14 items-center justify-between bg-header px-5 text-header-foreground shadow-sm">
        <div>
          <div className="text-base font-semibold">Fumba Port WMS</div>
          <div className="text-[11px] text-white/75">Customs Management</div>
        </div>
        <HeaderActions />
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <CustomsSidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function DashboardPage() {
  const dashboard = useLoad(() => getCustomsDashboard(), "customs-dashboard");
  const metrics = dashboard.data?.metrics || {};
  return (
    <>
      <PageHeader eyebrow="Customs" title="Customs Dashboard" description="Inspection queues, holds, document requests, and recently updated inspections." />
      <div className="flex-1 overflow-auto p-4">
        {dashboard.error && <ErrorState message={dashboard.error} />}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <OperationalStatCard title="Awaiting Inspection" icon={PackageSearch} loading={dashboard.loading} value={metrics.awaiting_inspection} emptyTitle="No cargo waiting" tone="warning" />
          <OperationalStatCard title="In Progress" icon={PlayCircle} loading={dashboard.loading} value={metrics.inspections_in_progress} emptyTitle="No active inspections" tone="info" />
          <OperationalStatCard title="On Hold" icon={AlertTriangle} loading={dashboard.loading} value={metrics.cargo_on_hold} emptyTitle="No holds" tone="destructive" />
          <OperationalStatCard title="Cleared" icon={CheckCircle2} loading={dashboard.loading} value={metrics.cleared_cargo} emptyTitle="No cleared cargo" tone="success" />
          <OperationalStatCard title="Documents Requested" icon={FileQuestion} loading={dashboard.loading} value={metrics.documents_requested} emptyTitle="No requests" tone="warning" />
        </div>
        <div className="mt-3">
          <SectionCard title="Recently Updated Inspections" icon={History}>
            <CustomsTable rows={dashboard.data?.recently_updated || []} loading={dashboard.loading} />
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function CustomsTable({ rows, loading, error, onAction, onHistory, onDetails, mode }) {
  const actionLabel = (row) => {
    if (mode === "queue") return "Start Inspection";
    if (mode === "holds") return "Release Hold";
    if (mode === "cleared") return "Clearance Details";
    if (row.customs_status === "Inspection In Progress") return "Record Result";
    if (row.customs_status === "On Hold") return "Release Hold";
    return "View Inspection";
  };
  return (
    <DataTable
      loading={loading}
      error={error}
      rows={rows}
      emptyTitle="No customs cargo found"
      columns={[
        { key: "cargo_reference", label: "Cargo", className: "font-mono font-semibold" },
        { key: "barcode", label: "Barcode", className: "font-mono" },
        { key: "owner_information", label: "Owner" },
        { key: "cargo_type", label: "Type" },
        ...(mode === "records" ? [
          { key: "inspection_started_at", label: "Inspection Date", render: (row) => formatDateTime(row.inspection_started_at || row.registration_date) },
          { key: "inspector_name", label: "Inspector", render: (row) => row.inspector_name || "—" },
          { key: "inspection_result", label: "Result", render: (row) => row.inspection_result || "In Progress" }
        ] : [
          { key: "approval_status", label: "Approval", render: (row) => <StatusBadge tone={statusTone(row.approval_status)}>{row.approval_status}</StatusBadge> },
          { key: "placement_status", label: "Placement", render: (row) => <StatusBadge tone={statusTone(row.placement_status)}>{row.placement_status}</StatusBadge> }
        ]),
        { key: "customs_status", label: "Customs", render: (row) => <StatusBadge tone={statusTone(row.customs_status)}>{row.customs_status}</StatusBadge> },
        { key: "registration_date", label: "Registered", render: (row) => formatDateTime(row.registration_date) },
        ...(onAction || onHistory || onDetails ? [{
          key: "actions",
          label: "Actions",
          render: (row) => (
            <div className="flex flex-wrap gap-1">
              {onDetails && <button type="button" onClick={() => onDetails(row)} className="rounded border border-border px-2 py-1 text-[11px] font-semibold">Details</button>}
              {onAction && mode !== "cleared" && <button type="button" onClick={() => onAction(row)} className="rounded bg-info px-2 py-1 text-[11px] font-semibold text-info-foreground">{actionLabel(row)}</button>}
              {onHistory && <button type="button" onClick={() => onHistory(row)} className="rounded border border-border px-2 py-1 text-[11px] font-semibold">History</button>}
            </div>
          )
        }] : [])
      ]}
    />
  );
}

function CustomsListPage({ mode }) {
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState({ cargo: null, data: null, loading: false, error: "" });
  const [history, setHistory] = useState({ cargo: null, rows: [], error: "" });
  const loader = {
    queue: () => getCustomsQueue({ search }),
    records: () => getCustomsRecords({ search }),
    cleared: () => getCustomsCleared({ search }),
    holds: () => getCustomsHolds({ search })
  }[mode];
  const data = useLoad(loader, `${mode}-${search}`);
  const titles = {
    queue: "Inspection Queue",
    records: "Inspections",
    cleared: "Cleared Cargo",
    holds: "Cargo on Hold"
  };

  const loadHistory = async (row) => {
    setHistory({ cargo: row, rows: [], error: "" });
    try {
      const response = await getCustomsHistory(row.cargo_reference);
      setHistory({ cargo: row, rows: response.data || [], error: "" });
    } catch (error) {
      setHistory({ cargo: row, rows: [], error: getErrorMessage(error) });
    }
  };

  const loadDetails = async (row) => {
    setDetail({ cargo: row, data: null, loading: true, error: "" });
    try {
      const response = await getCustomsCargo(row.cargo_reference);
      setDetail({ cargo: row, data: response.data, loading: false, error: "" });
    } catch (error) {
      setDetail({ cargo: row, data: null, loading: false, error: getErrorMessage(error) });
    }
  };

  return (
    <>
      <PageHeader eyebrow="Customs" title={titles[mode]} description={mode === "queue" ? "Approved cargo waiting for its first Customs inspection." : mode === "records" ? "Permanent register of inspection activity and results." : "Search by public cargo reference, barcode, delivery note, consignee, and customs status."} />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title="Search" icon={PackageSearch}>
          <div className="flex gap-2">
            <input className={inputClass} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cargo reference, barcode, delivery note, consignee" />
            <button type="button" onClick={data.refresh} className="inline-flex h-9 items-center gap-2 rounded border border-border px-3 text-xs font-semibold">
              <PackageSearch className="h-4 w-4" />
              Search
            </button>
          </div>
        </SectionCard>
        {message && <div className="mt-3 rounded border border-info/30 bg-info/10 px-3 py-2 text-xs font-semibold text-info">{message}</div>}
        <div className="mt-3">
          <SectionCard title={titles[mode]} icon={ClipboardList}>
            <CustomsTable rows={data.rows || []} loading={data.loading} error={data.error} onAction={setSelected} onHistory={loadHistory} onDetails={loadDetails} mode={mode} />
          </SectionCard>
        </div>
      </div>
      <CustomsActionDialog
        cargo={selected}
        onClose={() => setSelected(null)}
        onSaved={async (text) => {
          setMessage(text);
          setSelected(null);
          await data.refresh();
        }}
      />
      <CustomsDetailDialog detail={detail} onClose={() => setDetail({ cargo: null, data: null, loading: false, error: "" })} />
      <CustomsHistoryDialog history={history} onClose={() => setHistory({ cargo: null, rows: [], error: "" })} />
    </>
  );
}

function CustomsHistoryDialog({ history, onClose }) {
  if (!history.cargo) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={`Customs History: ${history.cargo.cargo_reference}`}>
      <div className="flex max-h-[85vh] w-full max-w-5xl flex-col rounded-md border border-border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div><div className="text-sm font-semibold">Customs History</div><div className="mt-1 font-mono text-xs text-muted-foreground">{history.cargo.cargo_reference}</div></div>
          <button type="button" onClick={onClose} className="rounded border border-border px-2 py-1 text-xs font-semibold">Close</button>
        </div>
        <div className="overflow-auto p-4"><DataTable error={history.error} rows={history.rows} emptyTitle="No customs history recorded" columns={[
          { key: "public_reference", label: "History Ref", className: "font-mono font-semibold" },
          { key: "changed_at", label: "Time", render: (row) => formatDateTime(row.changed_at) },
          { key: "previous_status", label: "Previous", render: (row) => row.previous_status || "Initial" },
          { key: "new_status", label: "New", render: (row) => <StatusBadge tone={statusTone(row.new_status)}>{row.new_status}</StatusBadge> },
          { key: "changed_by_name", label: "Officer", render: (row) => row.changed_by_name || row.changed_by_reference || "Customs Officer" },
          { key: "notes", label: "Notes", render: (row) => row.notes || "No notes" }
        ]} /></div>
      </div>
    </div>
  );
}

function CustomsDetailDialog({ detail, onClose }) {
  const [documentError, setDocumentError] = useState("");
  if (!detail.cargo) return null;
  const cargo = detail.data || detail.cargo;
  const openDocument = async (document) => {
    setDocumentError("");
    try {
      const response = await getCustomsDocumentContent(cargo.cargo_reference, document.id);
      const content = response.data;
      const url = `data:${content.file_type || "application/octet-stream"};base64,${content.content_base64}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setDocumentError(getErrorMessage(error));
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-2xl rounded-md border border-border bg-card p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Customs Cargo Detail</div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">{cargo.cargo_reference}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-border px-2 py-1 text-xs font-semibold">Close</button>
        </div>
        {detail.loading && <div className="mt-4 text-xs text-muted-foreground">Loading cargo details...</div>}
        {detail.error && <div className="mt-4"><ErrorState message={detail.error} /></div>}
        {!detail.loading && !detail.error && (
          <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
            <DetailItem label="Owner" value={cargo.owner_information || cargo.consignee_name} />
            <DetailItem label="Delivery Note" value={cargo.delivery_note_number || "Not recorded"} />
            <DetailItem label="Cargo Type" value={cargo.cargo_type} />
            <DetailItem label="Description" value={cargo.cargo_description || "No description"} />
            <DetailItem label="Customs Status" value={cargo.customs_status} />
            <DetailItem label="Placement Status" value={cargo.placement_status} />
            <DetailItem label="Location" value={cargo.location || "Not placed"} />
            <DetailItem label="Registered" value={formatDateTime(cargo.registration_date)} />
            <DetailItem label="Updated" value={formatDateTime(cargo.updated_at)} />
          </div>
        )}
        {!detail.loading && !detail.error && <div className="mt-4 rounded border border-border bg-background/50 p-3"><div className="text-xs font-semibold">Registration Documents</div>{cargo.documents?.length ? <ul className="mt-2 space-y-2 text-xs">{cargo.documents.map((document) => <li key={document.id} className="flex items-center justify-between gap-3"><span className="break-all">{document.file_name}</span><button type="button" onClick={() => openDocument(document)} className="shrink-0 rounded border px-2 py-1 font-semibold">Open</button></li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">No documents were attached to this registration.</p>}{documentError && <div className="mt-2"><ErrorState message={documentError} /></div>}</div>}
      </div>
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div className="rounded border border-border bg-background/50 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value || "Not available"}</div>
    </div>
  );
}

function CustomsActionDialog({ cargo, onClose, onSaved }) {
  const stateKeys = { "Pending Inspection": "pending_inspection", "Inspection In Progress": "inspection_in_progress", "Documents Required": "documents_required", "On Hold": "on_hold", Cleared: "cleared", Rejected: "rejected" };
  const [form, setForm] = useState({ status: "Inspection In Progress", notes: "", documents_requested: "" });
  const [error, setError] = useState("");
  useEffect(() => {
    if (cargo) {
      const initialStatus = cargo.customs_status === "On Hold" ? "Release Hold" : cargo.customs_status === "Pending Inspection" ? "Inspection In Progress" : "Documents Required";
      setForm({ status: initialStatus, notes: "", documents_requested: "", inspection_type: "", document_verification: "", inspection_result: "" });
      setError("");
    }
  }, [cargo]);

  if (!cargo) return null;
  const statusOptions = cargo.customs_status === "Pending Inspection"
    ? ["Inspection In Progress"]
    : cargo.customs_status === "On Hold"
      ? ["Release Hold"]
      : cargo.customs_status === "Cleared" ? [] : ["Documents Required", "On Hold", "Cleared", "Rejected"];
  const reasonRequired = ["Documents Required", "On Hold", "Release Hold", "Rejected"].includes(form.status);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      if (cargo.customs_status === "Pending Inspection" && form.status === "Inspection In Progress") {
        await startCustomsInspection(cargo.cargo_reference, { notes: form.notes, expected_state_key: cargo.customs_state_key || stateKeys[cargo.customs_status] });
      } else {
        const transitionKeys = { "Inspection In Progress": "start_inspection", "Documents Required": "request_documents", "On Hold": "place_on_hold", "Release Hold": "release_hold", Cleared: "clear_customs", Rejected: "reject_customs" };
        await updateCustomsStatus(cargo.cargo_reference, {
          ...form,
          transition_key: transitionKeys[form.status],
          expected_state_key: cargo.customs_state_key || stateKeys[cargo.customs_status],
          confirm: form.status === "Cleared"
        });
      }
      onSaved(`Customs status updated for ${cargo.cargo_reference}.`);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-md border border-border bg-card p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Update Customs Status</div>
            <div className="mt-1 text-xs text-muted-foreground">{cargo.cargo_reference}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-border px-2 py-1 text-xs font-semibold">Close</button>
        </div>
        <div className="mt-4 grid gap-3">
          <label className="space-y-1.5 text-xs font-semibold">
            Status
            <select className={inputClass} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold">
            {reasonRequired ? "Reason / Customs Remarks *" : "Inspection Notes / Customs Remarks"}
            <textarea required={reasonRequired} className="min-h-24 w-full rounded border border-input bg-background px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          {cargo.customs_status !== "Pending Inspection" && cargo.customs_status !== "On Hold" && <>
            <label className="space-y-1.5 text-xs font-semibold">Inspection Type<select className={inputClass} value={form.inspection_type || ""} onChange={(event) => setForm((current) => ({ ...current, inspection_type: event.target.value }))}><option value="">Select inspection type</option><option>Document Review</option><option>Physical Inspection</option><option>Joint Inspection</option></select></label>
            <label className="space-y-1.5 text-xs font-semibold">Document Verification<select className={inputClass} value={form.document_verification || ""} onChange={(event) => setForm((current) => ({ ...current, document_verification: event.target.value }))}><option value="">Select verification result</option><option>Verified</option><option>Discrepancy Found</option><option>Further Documents Required</option></select></label>
            <label className="space-y-1.5 text-xs font-semibold">Inspection Result<select className={inputClass} value={form.inspection_result || ""} onChange={(event) => setForm((current) => ({ ...current, inspection_result: event.target.value }))}><option value="">Select inspection result</option><option>Passed</option><option>Further Inspection Required</option><option>Hold Recommended</option></select></label>
          </>}
          <label className="space-y-1.5 text-xs font-semibold">
            Documents Requested
            <input className={inputClass} value={form.documents_requested} onChange={(event) => setForm((current) => ({ ...current, documents_requested: event.target.value }))} />
          </label>
          {error && <ErrorState message={error} />}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded border border-border px-3 py-2 text-xs font-semibold">Cancel</button>
            <button type="submit" className="inline-flex items-center gap-2 rounded bg-info px-3 py-2 text-xs font-semibold text-info-foreground">
              {form.status === "Cleared" ? <ShieldCheck className="h-4 w-4" /> : form.status === "Rejected" ? <XCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
              {cargo.customs_status === "Pending Inspection" ? "Start Inspection" : form.status === "On Hold" ? "Place Hold" : form.status === "Release Hold" ? "Release Hold" : form.status === "Cleared" ? "Grant Clearance" : "Save Inspection"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ProfilePage() {
  return <AccountProfilePage title="Customs Officer Profile" description="Your authenticated customs account details." />;
}

function CustomsPortal() {
  return (
    <CustomsLayout>
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="inspection-queue" element={<CustomsListPage mode="queue" />} />
        <Route path="records" element={<CustomsListPage mode="records" />} />
        <Route path="cleared" element={<CustomsListPage mode="cleared" />} />
        <Route path="holds" element={<CustomsListPage mode="holds" />} />
        <Route path="reports" element={<RoleReports scope="customs" />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/customs" replace />} />
      </Routes>
    </CustomsLayout>
  );
}

export default CustomsPortal;
