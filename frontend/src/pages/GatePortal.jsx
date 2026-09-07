import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  CheckCircle2,
  ClipboardList,
  DoorOpen,
  History,
  LayoutDashboard,
  LogOut,
  PackageSearch,
  ShieldAlert,
  Truck,
  UserCircle2
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
  confirmGateOut,
  getEmergencyReleaseRequests,
  getGateDashboard,
  getGateEligibility,
  getGateRecords,
  getGateReleaseQueue,
  logout,
  requestEmergencyRelease
  ,updateGatePresence
} from "@/services/api";

const inputClass = "h-9 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

const navigation = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/gate" },
  { label: "Release Queue", icon: DoorOpen, to: "/gate/release-queue" },
  { label: "Gate-Out Records", icon: History, to: "/gate/gate-out-records" },
  { label: "Emergency Releases", icon: ShieldAlert, to: "/gate/emergency-releases" },
  { label: "Reports", icon: BarChart3, to: "/gate/reports" },
  { label: "Notifications", icon: Bell, to: "/gate/notifications" },
  { label: "Profile", icon: UserCircle2, to: "/gate/profile" }
];

function formatMoney(value) {
  const number = Number(value || 0);
  return `TZS ${Number.isFinite(number) ? number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

function useLoad(loader, key = "") {
  const [state, setState] = useState({ data: null, rows: [], pagination: null, loading: true, error: "" });
  const loaderRef = useRef(loader);

  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await loaderRef.current();
      setState({ data: response.data || null, rows: response.data || [], pagination: response.pagination || null, loading: false, error: "" });
    } catch (error) {
      setState({ data: null, rows: [], pagination: null, loading: false, error: getErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, key]);

  return { ...state, refresh: load };
}

function GateSidebar() {
  const navigate = useNavigate();
  return <CollapsibleSidebar navigation={navigation} basePath="/gate" role="Gate Officer" consoleName="Release Console" onExit={async () => { await logout(); navigate("/"); }} />;
}

function GateLayout({ children }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-14 items-center justify-between bg-header px-5 text-header-foreground shadow-sm">
        <div>
          <div className="text-base font-semibold">Fumba Port WMS</div>
          <div className="text-[11px] text-white/75">Dispatch and Gate</div>
        </div>
        <HeaderActions />
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <GateSidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function DashboardPage() {
  const dashboard = useLoad(() => getGateDashboard(), "gate-dashboard");
  const metrics = dashboard.data?.metrics || {};
  return (
    <>
      <PageHeader eyebrow="Gate" title="Gate Dashboard" description="Release queue status, blocked cargo, releases today, and emergency release requests." />
      <div className="flex-1 overflow-auto p-4">
        {dashboard.error && <ErrorState message={dashboard.error} />}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OperationalStatCard title="Awaiting Gate Release" icon={DoorOpen} loading={dashboard.loading} value={metrics.awaiting_gate_release} emptyTitle="No awaiting cargo" tone="info" />
          <OperationalStatCard title="Ready for Release" icon={CheckCircle2} loading={dashboard.loading} value={metrics.ready_for_release} emptyTitle="No ready cargo" tone="success" />
          <OperationalStatCard title="Blocked by Customs" icon={AlertTriangle} loading={dashboard.loading} value={metrics.blocked_by_customs} emptyTitle="No customs blocks" tone="destructive" />
          <OperationalStatCard title="Blocked by Payment" icon={AlertTriangle} loading={dashboard.loading} value={metrics.blocked_by_payment} emptyTitle="No payment blocks" tone="warning" />
          <OperationalStatCard title="Blocked by Supervisor" icon={AlertTriangle} loading={dashboard.loading} value={metrics.blocked_by_supervisor} emptyTitle="No supervisor blocks" tone="warning" />
          <OperationalStatCard title="Blocked by Management" icon={ShieldAlert} loading={dashboard.loading} value={metrics.blocked_by_management} emptyTitle="No Management blocks" tone="warning" />
          <OperationalStatCard title="Released Today" icon={Truck} loading={dashboard.loading} value={metrics.released_today} emptyTitle="No releases today" tone="success" />
          <OperationalStatCard title="Emergency Requests" icon={ShieldAlert} loading={dashboard.loading} value={metrics.emergency_release_requests} emptyTitle="No emergency requests" tone="warning" />
        </div>
      </div>
    </>
  );
}

function ReleaseQueuePage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [message, setMessage] = useState("");
  const [releaseCargo, setReleaseCargo] = useState(null);
  const [emergencyCargo, setEmergencyCargo] = useState(null);
  const [presenceCargo, setPresenceCargo] = useState(null);
  const data = useLoad(() => getGateReleaseQueue({ search, page, page_size: pageSize }), `release-${search}-${page}-${pageSize}`);

  return (
    <>
      <PageHeader eyebrow="Gate" title="Release Queue" description="Validate Management authorization where required, Customs, Finance, dispatch, and Gate state before release." />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title="Search or Scan Cargo" icon={PackageSearch}>
          <div className="flex gap-2">
            <input className={inputClass} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cargo public reference or barcode" />
            <button type="button" onClick={data.refresh} className="rounded border border-border px-3 text-xs font-semibold">Search</button>
          </div>
        </SectionCard>
        {message && <div className="mt-3 rounded border border-info/30 bg-info/10 px-3 py-2 text-xs font-semibold text-info">{message}</div>}
        <div className="mt-3">
          <SectionCard title="Release Queue" icon={DoorOpen}>
            <DataTable
              loading={data.loading}
              error={data.error}
              rows={data.rows || []}
              emptyTitle="No cargo in release queue"
              columns={[
                { key: "queue_position", label: "FPFG", render: (row) => row.queue_position || "—" },
                { key: "cargo_reference", label: "Cargo", className: "font-mono font-semibold" },
                { key: "latest_fully_paid_at", label: "Latest Settlement", render: (row) => formatDateTime(row.latest_fully_paid_at) },
                { key: "owner_information", label: "Owner" },
                { key: "presence_status", label: "Presence", render: (row) => <div className="space-y-1"><StatusBadge tone={row.customer_present ? "success" : "muted"}>{row.presence_status}</StatusBadge><div>{formatDateTime(row.customer_present_at)}</div></div> },
                { key: "customs_status", label: "Customs", render: (row) => <StatusBadge tone={statusTone(row.customs_status)}>{row.customs_status}</StatusBadge> },
                { key: "payment_status", label: "Payment", render: (row) => <div className="space-y-1"><StatusBadge tone={row.financially_cleared ? "success" : "destructive"}>{row.payment_status}</StatusBadge><div>Penalty: {row.penalty_status}</div><div>{formatMoney(row.outstanding_balance)}</div></div> },
                { key: "queue_state", label: "Gate Status", render: (row) => <div className="space-y-1"><StatusBadge tone={row.allowed_to_gate_out ? "success" : row.financially_cleared ? "warning" : "destructive"}>{row.queue_state}</StatusBadge>{row.blocked_reason && <div>{row.blocked_reason}</div>}</div> },
                {
                  key: "actions",
                  label: "Actions",
                  render: (row) => (
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={() => setPresenceCargo(row)} className="rounded border border-border px-2 py-1 text-[11px] font-semibold">
                        Presence
                      </button>
                      <button type="button" disabled={!row.allowed_to_gate_out} onClick={() => setReleaseCargo(row)} className="rounded bg-info px-2 py-1 text-[11px] font-semibold text-info-foreground disabled:cursor-not-allowed disabled:opacity-40">
                        Gate Out
                      </button>
                      {!row.release_eligibility?.eligible && !row.release_eligibility?.blocked_requirements?.some((item) => item.requirement === "management_release") && (
                        <button type="button" onClick={() => setEmergencyCargo(row)} className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] font-semibold text-warning">
                          Emergency
                        </button>
                      )}
                    </div>
                  )
                }
              ]}
              page={data.pagination?.page || page}
              pageSize={data.pagination?.page_size || pageSize}
              total={data.pagination?.total || 0}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              itemLabel="cargo"
            />
          </SectionCard>
        </div>
      </div>
      <GateOutDialog
        cargo={releaseCargo}
        onClose={() => setReleaseCargo(null)}
        onSaved={async (text) => {
          setMessage(text);
          setReleaseCargo(null);
          await data.refresh();
        }}
      />
      <PresenceDialog cargo={presenceCargo} onClose={() => setPresenceCargo(null)} onSaved={async (text) => { setMessage(text); setPresenceCargo(null); await data.refresh(); }} />
      <EmergencyRequestDialog
        cargo={emergencyCargo}
        onClose={() => setEmergencyCargo(null)}
        onSaved={async (text) => {
          setMessage(text);
          setEmergencyCargo(null);
        }}
      />
    </>
  );
}

function PresenceDialog({ cargo, onClose, onSaved }) {
  const [form, setForm] = useState({ status: "PRESENT_READY", collector_name: "", identity_type: "", identity_number: "", authorization_reference: "", reason: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (cargo) setForm({ status: cargo.customer_present ? "TEMPORARILY_UNAVAILABLE" : "PRESENT_READY", collector_name: cargo.collector_details?.collector_name || "", identity_type: cargo.collector_details?.identity_type || "", identity_number: cargo.collector_details?.identity_number || "", authorization_reference: cargo.collector_details?.authorization_reference || "", reason: "" });
  }, [cargo]);
  if (!cargo) return null;
  const submit = async event => {
    event.preventDefault(); setError(""); setSaving(true);
    try { await updateGatePresence(cargo.cargo_reference, form); onSaved(`Customer presence updated for ${cargo.cargo_reference}.`); }
    catch (submitError) { setError(getErrorMessage(submitError)); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-md border border-border bg-card p-4 shadow-xl">
        <div className="flex items-center justify-between"><div><div className="text-sm font-semibold">Customer Presence</div><div className="text-xs text-muted-foreground">{cargo.cargo_reference}</div></div><button type="button" onClick={onClose} className="rounded border border-border px-2 py-1 text-xs">Close</button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold">Status<select className={`${inputClass} mt-1`} value={form.status} onChange={event => setForm(current => ({...current,status:event.target.value}))}><option value="PRESENT_READY">Present and ready</option><option value="WAITING_FOR_CUSTOMER">Not present</option><option value="TEMPORARILY_UNAVAILABLE">Temporarily unavailable</option></select></label>
          <label className="text-xs font-semibold">Collector name<input className={`${inputClass} mt-1`} value={form.collector_name} onChange={event => setForm(current => ({...current,collector_name:event.target.value}))} /></label>
          <label className="text-xs font-semibold">Identity type<input className={`${inputClass} mt-1`} value={form.identity_type} onChange={event => setForm(current => ({...current,identity_type:event.target.value}))} /></label>
          <label className="text-xs font-semibold">Identity number<input className={`${inputClass} mt-1`} value={form.identity_number} onChange={event => setForm(current => ({...current,identity_number:event.target.value}))} /></label>
          <label className="text-xs font-semibold sm:col-span-2">Authorization reference<input className={`${inputClass} mt-1`} value={form.authorization_reference} onChange={event => setForm(current => ({...current,authorization_reference:event.target.value}))} /></label>
          <label className="text-xs font-semibold sm:col-span-2">Reason{form.status !== "PRESENT_READY" && cargo.customer_present ? " (required)" : ""}<textarea className="mt-1 min-h-20 w-full rounded border border-input bg-background p-2 text-xs" value={form.reason} onChange={event => setForm(current => ({...current,reason:event.target.value}))} placeholder="Explain presence changes or temporary unavailability" /></label>
        </div>
        {error && <div className="mt-3 rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
        <div className="mt-4 flex justify-end"><button disabled={saving} className="rounded bg-info px-3 py-2 text-xs font-semibold text-info-foreground disabled:opacity-50">{saving ? "Saving…" : "Save presence"}</button></div>
      </form>
    </div>
  );
}

function GateOutDialog({ cargo, onClose, onSaved }) {
  const [form, setForm] = useState({ vehicle_number: "", driver_name: "", gate_notes: "", emergency_request_reference: "" });
  const [error, setError] = useState("");
  const [eligibility, setEligibility] = useState({ loading: false, data: null, error: "" });

  useEffect(() => {
    if (cargo) {
      setForm({ vehicle_number: "", driver_name: "", gate_notes: "", emergency_request_reference: "" });
      setError("");
      setEligibility({ loading: true, data: null, error: "" });
      getGateEligibility(cargo.cargo_reference)
        .then((response) => setEligibility({ loading: false, data: response.data, error: "" }))
        .catch((eligibilityError) => setEligibility({ loading: false, data: null, error: getErrorMessage(eligibilityError) }));
    }
  }, [cargo]);

  if (!cargo) return null;

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const response = await confirmGateOut(cargo.cargo_reference, form);
      onSaved(`Gate-out confirmed for ${response.data.cargo_reference}.`);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-md border border-border bg-card p-4 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold">Confirm Gate-Out</div>
            <div className="mt-1 text-xs text-muted-foreground">{cargo.cargo_reference}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-border px-2 py-1 text-xs font-semibold">Close</button>
        </div>
        <div className="mt-4 rounded border border-border bg-muted/30 p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">Live Eligibility</span>
            {eligibility.loading ? (
              <StatusBadge tone="info">Checking</StatusBadge>
            ) : eligibility.data?.eligible ? (
              <StatusBadge tone="success">Ready</StatusBadge>
            ) : (
              <StatusBadge tone="destructive">Blocked</StatusBadge>
            )}
          </div>
          {eligibility.error && <div className="mt-2 text-destructive">{eligibility.error}</div>}
          {eligibility.data && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div>Customs: <span className="font-semibold">{eligibility.data.customs_status}</span></div>
              <div>Finance: <span className="font-semibold">{eligibility.data.financial_status}</span></div>
              <div>Release: <span className="font-semibold">{eligibility.data.release_type === "MANAGEMENT" ? `Management — ${eligibility.data.management_release_status}` : "Normal Release"}</span></div>
              <div>Dispatch: <span className="font-semibold">{eligibility.data.supervisor_dispatch_approval}</span></div>
              <div>Outstanding: <span className="font-semibold">{formatMoney(eligibility.data.outstanding_amount)}</span></div>
              <div className="sm:col-span-2">Location: <span className="font-semibold">{eligibility.data.location || "Not placed"}</span></div>
              {eligibility.data.blocked_requirements?.length > 0 && (
                <ul className="sm:col-span-2 list-disc space-y-1 pl-4 text-destructive">
                  {eligibility.data.blocked_requirements.map((item) => (
                    <li key={`${item.requirement}-${item.message}`}>{item.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="mt-4 grid gap-3">
          <InputField label="Vehicle Number" value={form.vehicle_number} onChange={(value) => setForm((current) => ({ ...current, vehicle_number: value }))} required />
          <InputField label="Driver Name" value={form.driver_name} onChange={(value) => setForm((current) => ({ ...current, driver_name: value }))} required />
          <InputField label="Emergency Request Reference" value={form.emergency_request_reference} onChange={(value) => setForm((current) => ({ ...current, emergency_request_reference: value }))} />
          <label className="space-y-1.5 text-xs font-semibold">
            Gate Notes
            <textarea className="min-h-20 w-full rounded border border-input bg-background px-2 py-2 text-xs" value={form.gate_notes} onChange={(event) => setForm((current) => ({ ...current, gate_notes: event.target.value }))} />
          </label>
          {error && <ErrorState message={error} />}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded border border-border px-3 py-2 text-xs font-semibold">Cancel</button>
            <button type="submit" disabled={!eligibility.data?.eligible || eligibility.loading} className="inline-flex items-center gap-2 rounded bg-info px-3 py-2 text-xs font-semibold text-info-foreground disabled:cursor-not-allowed disabled:opacity-40">
              <DoorOpen className="h-4 w-4" />
              Confirm Release
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function InputField({ label, value, onChange, required = false }) {
  return (
    <label className="space-y-1.5 text-xs font-semibold">
      {label}
      <input className={inputClass} value={value} required={required} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function EmergencyRequestDialog({ cargo, onClose, onSaved }) {
  const [justification, setJustification] = useState("");
  const [error, setError] = useState("");

  if (!cargo) return null;

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const response = await requestEmergencyRelease({
        cargo_reference: cargo.cargo_reference,
        justification
      });
      onSaved(`Emergency request ${response.data.emergency_release_reference} submitted.`);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-md border border-border bg-card p-4 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold">Emergency Release Request</div>
            <div className="mt-1 text-xs text-muted-foreground">{cargo.cargo_reference}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-border px-2 py-1 text-xs font-semibold">Close</button>
        </div>
        <div className="mt-4 space-y-3">
          <div className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            Gate Officers may request emergency release but cannot approve it.
          </div>
          <label className="space-y-1.5 text-xs font-semibold">
            Mandatory Justification
            <textarea className="min-h-24 w-full rounded border border-input bg-background px-2 py-2 text-xs" value={justification} onChange={(event) => setJustification(event.target.value)} required />
          </label>
          {error && <ErrorState message={error} />}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded border border-border px-3 py-2 text-xs font-semibold">Cancel</button>
            <button type="submit" className="rounded bg-warning px-3 py-2 text-xs font-semibold text-warning-foreground">Submit Request</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function GateRecordsPage() {
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(10);
  const records = useLoad(() => getGateRecords({page,page_size:pageSize}), `gate-records-${page}-${pageSize}`);
  return (
    <>
      <PageHeader eyebrow="Gate" title="Gate-Out Records" description="Immutable gate-out history with public cargo and gate references." />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title="Gate-Out History" icon={History}>
          <DataTable
            loading={records.loading}
            error={records.error}
            rows={records.rows || []}
            emptyTitle="No gate-out records"
            page={records.pagination?.page||page}
            pageSize={records.pagination?.page_size||pageSize}
            total={records.pagination?.total||0}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            columns={[
              { key: "gate_out_reference", label: "Gate Ref", className: "font-mono font-semibold" },
              { key: "cargo_reference", label: "Cargo", className: "font-mono" },
              { key: "release_type", label: "Type", render: (row) => <StatusBadge tone={row.release_type === "Emergency" ? "warning" : "success"}>{row.release_type}</StatusBadge> },
              { key: "vehicle_number", label: "Vehicle" },
              { key: "driver_name", label: "Driver" },
              { key: "outstanding_amount", label: "Outstanding", render: (row) => formatMoney(row.outstanding_amount) },
              { key: "released_by_name", label: "Released By" },
              { key: "released_at", label: "Released At", render: (row) => formatDateTime(row.released_at) }
            ]}
          />
        </SectionCard>
      </div>
    </>
  );
}

function EmergencyReleasesPage() {
  const requests = useLoad(() => getEmergencyReleaseRequests(), "emergency-requests");
  return (
    <>
      <PageHeader eyebrow="Gate" title="Emergency Releases" description="Requests, decisions, and completion state for emergency releases. Approval remains supervisor-controlled." />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title="Emergency Release Requests" icon={ShieldAlert}>
          <DataTable
            loading={requests.loading}
            error={requests.error}
            rows={requests.rows || []}
            emptyTitle="No emergency release requests"
            columns={[
              { key: "emergency_release_reference", label: "Request Ref", className: "font-mono font-semibold" },
              { key: "cargo_reference", label: "Cargo", className: "font-mono" },
              { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge> },
              { key: "customs_status", label: "Customs", render: (row) => <StatusBadge tone={statusTone(row.customs_status)}>{row.customs_status}</StatusBadge> },
              { key: "financial_status", label: "Finance", render: (row) => <StatusBadge tone={statusTone(row.financial_status)}>{row.financial_status}</StatusBadge> },
              { key: "justification", label: "Justification" },
              { key: "approved_at", label: "Approved", render: (row) => formatDateTime(row.approved_at) },
              { key: "gate_confirmed_at", label: "Gate Confirmed", render: (row) => formatDateTime(row.gate_confirmed_at) }
            ]}
          />
        </SectionCard>
      </div>
    </>
  );
}

function ProfilePage() {
  return <AccountProfilePage title="Gate Officer Profile" description="Your authenticated gate account details." />;
}

function GatePortal() {
  return (
    <GateLayout>
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="release-queue" element={<ReleaseQueuePage />} />
        <Route path="gate-out-records" element={<GateRecordsPage />} />
        <Route path="emergency-releases" element={<EmergencyReleasesPage />} />
        <Route path="reports" element={<RoleReports scope="gate" />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/gate" replace />} />
      </Routes>
    </GateLayout>
  );
}

export default GatePortal;
