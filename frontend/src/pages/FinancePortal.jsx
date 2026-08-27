import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { Bar, BarChart as RechartsBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  BarChart3,
  Bell,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  PackageSearch,
  Plus,
  ReceiptText,
  Save,
  Settings2,
  UserCircle2
} from "lucide-react";
import { HeaderActions } from "@/components/wms/HeaderActions";
import { RoleReports } from "@/components/wms/RoleReports";
import { NotificationsPage } from "@/components/wms/NotificationsPage";
import { AccountProfilePage } from "@/components/wms/ProfilePage";
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
  activateFinanceTariff,
  cancelFinanceInvoice,
  createFinanceTariff,
  generateFinanceDraftInvoice,
  deactivateFinanceTariff,
  getFinanceCargoCharges,
  getFinanceDashboard,
  getFinanceInvoice,
  getFinanceInvoices,
  getFinancePayments,
  getFinanceReports,
  getFinanceTariffs,
  issueFinanceInvoice,
  logout,
  updateFinanceTariff,
  submitFinanceTariff,
  resendPaymentEmail
} from "@/services/api";

const inputClass = "h-9 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

const navigation = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/finance" },
  { label: "Cargo Charges", icon: PackageSearch, to: "/finance/cargo-charges" },
  { label: "Invoices", icon: ReceiptText, to: "/finance/invoices" },
  { label: "Payments", icon: CreditCard, to: "/finance/payments" },
  { label: "Tariff Configuration", icon: Settings2, to: "/finance/tariffs" },
  { label: "Financial Reports", icon: BarChart3, to: "/finance/reports" },
  { label: "Notifications", icon: Bell, to: "/finance/notifications" },
  { label: "Profile", icon: UserCircle2, to: "/finance/profile" }
];

function formatMoney(value, currency = "TZS") {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return `${currency} 0.00`;
  return `${currency} ${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function useLoad(loader, dependencyKey = "") {
  const [state, setState] = useState({ data: null, rows: [], loading: true, error: "" });
  const loaderRef = useRef(loader);

  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await loaderRef.current();
      setState({
        data: response.data || null,
        rows: response.data || [],
        loading: false,
        error: ""
      });
    } catch (error) {
      setState({ data: null, rows: [], loading: false, error: getErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, dependencyKey]);

  return { ...state, refresh: load };
}

function FinanceSidebar() {
  const navigate = useNavigate();
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-4 py-4">
        <div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/60">Finance Officer</div>
        <div className="mt-1 text-sm font-semibold">Billing Console</div>
      </div>
      <nav className="flex-1 overflow-auto py-2">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/finance"}
            className={({ isActive }) => cn(
              "relative flex items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-sidebar-accent",
              isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate("/");
          }}
          className="flex w-full items-center justify-center gap-2 rounded border border-sidebar-border bg-sidebar-accent px-3 py-2 text-xs font-semibold"
        >
          <LogOut className="h-3.5 w-3.5" />
          Exit
        </button>
      </div>
    </aside>
  );
}

function FinanceLayout({ children }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-14 items-center justify-between bg-header px-5 text-header-foreground shadow-sm">
        <div>
          <div className="text-base font-semibold">Fumba Port WMS</div>
          <div className="text-[11px] text-white/75">Finance Operations</div>
        </div>
        <HeaderActions />
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <FinanceSidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function DashboardPage() {
  const dashboard = useLoad(() => getFinanceDashboard(), "finance-dashboard");
  const metrics = dashboard.data?.metrics || {};
  return (
    <>
      <PageHeader eyebrow="Finance" title="Finance Dashboard" description="Live charging, invoice, payment, and outstanding balance overview." />
      <div className="flex-1 overflow-auto p-4">
        {dashboard.error && <ErrorState message={dashboard.error} />}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OperationalStatCard title="Accumulating Charges" icon={PackageSearch} loading={dashboard.loading} value={metrics.accumulating_charges} emptyTitle="No active charges" tone="info" />
          <OperationalStatCard title="Draft Invoices" icon={FileText} loading={dashboard.loading} value={metrics.draft_invoices} emptyTitle="No draft invoices" tone="warning" />
          <OperationalStatCard title="Partially Paid" icon={CreditCard} loading={dashboard.loading} value={metrics.partially_paid_invoices} emptyTitle="No partial payments" tone="warning" />
          <OperationalStatCard title="Paid Invoices" icon={ReceiptText} loading={dashboard.loading} value={metrics.paid_invoices} emptyTitle="No paid invoices" tone="success" />
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-3">
          <SectionCard title="Financial Totals" icon={BarChart3}>
            <div className="grid gap-2 text-xs">
              <ReadonlyValue label="Total Invoiced" value={formatMoney(metrics.total_invoiced_amount)} />
              <ReadonlyValue label="Total Received" value={formatMoney(metrics.total_amount_received)} />
              <ReadonlyValue label="Outstanding Balance" value={formatMoney(metrics.outstanding_balance)} />
              <ReadonlyValue label="Uninvoiced Accrued" value={formatMoney(metrics.uninvoiced_accrued_charges)} />
            </div>
          </SectionCard>
          <SectionCard title="Recent Payments" icon={CreditCard} className="xl:col-span-2">
            <DataTable
              loading={dashboard.loading}
              rows={dashboard.data?.recent_payments || []}
              emptyTitle="No recent payments"
              columns={[
                { key: "payment_reference", label: "Payment Ref", className: "font-mono font-semibold" },
                { key: "invoice_number", label: "Invoice", className: "font-mono" },
                { key: "cargo_reference", label: "Cargo", className: "font-mono" },
                { key: "amount", label: "Amount", render: (row) => formatMoney(row.amount) },
                { key: "bank_name", label: "Bank" },
                { key: "payment_date", label: "Payment Date", render: (row) => formatDateTime(row.payment_date) }
              ]}
            />
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function ReadonlyValue({ label, value }) {
  return (
    <div className="rounded border border-border bg-muted/20 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function CargoChargesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    search: searchParams.get("search") || "",
    cargo_type: "",
    approval_status: "",
    placement_status: "",
    customs_status: "",
    billing_status: "",
    page: 1
  });
  const key = JSON.stringify(filters);
  const charges = useLoad(() => getFinanceCargoCharges({ ...filters, limit: 25 }), key);

  useEffect(() => {
    const value = searchParams.get("search") || "";
    if (value && value !== filters.search) {
      setFilters((current) => ({ ...current, search: value, page: 1 }));
    }
  }, [filters.search, searchParams]);

  const updateFilter = (keyName, value) => {
    setFilters((current) => ({ ...current, [keyName]: value, page: 1 }));
    if (keyName === "search") {
      const next = new URLSearchParams(searchParams);
      value ? next.set("search", value) : next.delete("search");
      setSearchParams(next, { replace: true });
    }
  };

  return (
    <>
      <PageHeader eyebrow="Finance" title="Cargo Charges" description="All registered cargo, including unapproved and unplaced cargo, with dynamic backend charge calculations." />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title="Search and Filters" icon={PackageSearch}>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <FormField label="Search">
              <input className={inputClass} value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Cargo ref, barcode, consignee" />
            </FormField>
            <FormField label="Cargo Type">
              <input className={inputClass} value={filters.cargo_type} onChange={(event) => updateFilter("cargo_type", event.target.value)} placeholder="All cargo types" />
            </FormField>
            <SelectField label="Approval" value={filters.approval_status} onChange={(value) => updateFilter("approval_status", value)} options={["", "Pending Review", "Approved", "Correction Required", "Rejected"]} />
            <SelectField label="Placement" value={filters.placement_status} onChange={(value) => updateFilter("placement_status", value)} options={["", "Unplaced", "Placed", "Relocated", "Dispatched"]} />
            <SelectField label="Customs" value={filters.customs_status} onChange={(value) => updateFilter("customs_status", value)} options={["", "Pending Inspection", "Inspection In Progress", "Documents Required", "On Hold", "Cleared", "Rejected"]} />
            <SelectField label="Billing" value={filters.billing_status} onChange={(value) => updateFilter("billing_status", value)} options={["", "Unbilled", "Outstanding", "Partially Paid", "Fully Paid", "Released With Balance"]} />
          </div>
        </SectionCard>
        <div className="mt-3">
          <SectionCard title="Dynamic Cargo Charges" icon={ReceiptText}>
            <DataTable
              loading={charges.loading}
              error={charges.error}
              rows={charges.data?.data || charges.rows || []}
              emptyTitle="No cargo charge records found"
              columns={[
                { key: "cargo_reference", label: "Cargo Ref", className: "font-mono font-semibold" },
                { key: "cargo_type", label: "Type" },
                { key: "owner_information", label: "Owner" },
                { key: "registration_date", label: "Registered", render: (row) => formatDateTime(row.registration_date) },
                { key: "approval_status", label: "Approval", render: (row) => <StatusBadge tone={statusTone(row.approval_status)}>{row.approval_status}</StatusBadge> },
                { key: "placement_status", label: "Placement", render: (row) => <StatusBadge tone={statusTone(row.placement_status)}>{row.placement_status}</StatusBadge> },
                { key: "customs_status", label: "Customs", render: (row) => <StatusBadge tone={statusTone(row.customs_status)}>{row.customs_status}</StatusBadge> },
                { key: "management_release_status", label: "Release", render: (row) => <div className="space-y-1"><StatusBadge tone={row.management_release_status === "APPROVED" ? "success" : row.management_release_status === "PENDING" ? "warning" : "info"}>{row.management_release_status === "NOT_REQUIRED" ? "Normal Release" : `Management ${row.management_release_status}`}</StatusBadge>{row.management_release_finance_review_required && <div className="text-[10px] font-semibold text-warning">Payment received — Finance review required</div>}</div> },
                { key: "billable_days", label: "Days" },
                { key: "current_accrued_charge", label: "Accrued", render: (row) => formatMoney(row.current_accrued_charge) },
                { key: "invoiced_amount", label: "Invoiced", render: (row) => formatMoney(row.invoiced_amount) },
                { key: "paid_amount", label: "Paid", render: (row) => formatMoney(row.paid_amount) },
                { key: "outstanding_amount", label: "Outstanding", render: (row) => formatMoney(row.outstanding_amount) },
                { key: "billing_status", label: "Billing", render: (row) => <StatusBadge tone={statusTone(row.billing_status)}>{row.billing_status}</StatusBadge> },
              ]}
            />
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function FormField({ label, children }) {
  return (
    <label className="space-y-1.5 text-xs font-semibold">
      {label}
      {children}
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <FormField label={label}>
      <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const optionValue = typeof option === "string" ? option : option.value;
          const optionLabel = typeof option === "string" ? option || "All" : option.label;
          return <option key={optionValue || "all"} value={optionValue}>{optionLabel}</option>;
        })}
      </select>
    </FormField>
  );
}

function InvoicesPage() {
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [resendNotice, setResendNotice] = useState(null);
  const [resendingInvoice, setResendingInvoice] = useState("");
  const [detail, setDetail] = useState({ invoice: null, data: null, loading: false, error: "" });
  const invoices = useLoad(() => getFinanceInvoices({ status, limit: 100 }), status);

  useEffect(() => {
    if (!resendNotice || resendNotice.state === "resending") return undefined;
    const timer = window.setTimeout(() => setResendNotice(null), 2000);
    return () => window.clearTimeout(timer);
  }, [resendNotice]);

  const act = async (action, invoiceNumber) => {
    setMessage("");
    try {
      if (action === "issue") await issueFinanceInvoice(invoiceNumber);
      if (action === "cancel") {
        const reason = window.prompt("Enter cancellation reason");
        if (!reason) return;
        await cancelFinanceInvoice(invoiceNumber, reason);
      }
      setMessage(`${invoiceNumber} updated.`);
      await invoices.refresh();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };

  const openDetail = async (row) => {
    setDetail({ invoice: row, data: null, loading: true, error: "" });
    try {
      const response = await getFinanceInvoice(row.invoice_number);
      setDetail({ invoice: row, data: response.data, loading: false, error: "" });
    } catch (error) {
      setDetail({ invoice: row, data: null, loading: false, error: getErrorMessage(error) });
    }
  };
  const copyLink=async(row)=>{try{await navigator.clipboard.writeText(row.payment_url);setMessage("Secure payment link copied.");}catch{setMessage("Copy failed. Select the link from invoice details instead.");}};
  const resend=async(row)=>{setMessage("");setResendingInvoice(row.invoice_number);setResendNotice({state:"resending",text:"Resending payment email…"});try{const response=await resendPaymentEmail(row.invoice_number);const sent=response.data?.delivery_status==="SENT";setResendNotice({state:sent?"success":"error",text:sent?"Payment email sent.":`Email status: ${response.data?.delivery_status||"unknown"}.`});await invoices.refresh();}catch(error){setResendNotice({state:"error",text:getErrorMessage(error)});}finally{setResendingInvoice("");}};

  return (
    <>
      {resendNotice&&<div role="status" className={`fixed right-4 top-4 z-50 rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ${resendNotice.state==="error"?"bg-rose-600 text-white":"bg-slate-900 text-white"}`}>{resendNotice.text}</div>}
      <PageHeader eyebrow="Finance" title="Invoices" description="Monitor system-generated invoices and payment progress." />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title="Invoice Filter" icon={FileText}>
          <div className="w-56">
            <SelectField label="Status" value={status} onChange={setStatus} options={["", "Draft", "Issued", "Partially Paid", "Paid", "Overdue", "Cancelled"]} />
          </div>
        </SectionCard>
        {message && <div className="mt-3 rounded border border-info/30 bg-info/10 px-3 py-2 text-xs font-semibold text-info">{message}</div>}
        <div className="mt-3">
          <SectionCard title="Invoices" icon={ReceiptText}>
            <DataTable
              loading={invoices.loading}
              error={invoices.error}
              rows={invoices.rows || []}
              emptyTitle="No invoices found"
              columns={[
                { key: "invoice_number", label: "Invoice", className: "font-mono font-semibold" },
                { key: "cargo_reference", label: "Cargo", className: "font-mono" },
                { key: "owner_information", label: "Owner" },
                { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge> },
                { key: "payment_status", label: "Payment", render: (row) => <StatusBadge tone={statusTone(row.payment_status)}>{row.payment_status}</StatusBadge> },
                { key: "billable_days", label: "Days" },
                { key: "total_amount", label: "Total", render: (row) => formatMoney(row.total_amount, row.currency) },
                { key: "amount_paid", label: "Paid", render: (row) => formatMoney(row.amount_paid, row.currency) },
                { key: "outstanding_balance", label: "Outstanding", render: (row) => formatMoney(row.outstanding_balance, row.currency) },
                { key: "master_payment_reference", label: "Master PAY", className:"font-mono" },
                { key: "installment_count", label: "Installments" },
                { key: "customer_email", label: "Customer Email" },
                { key: "email_delivery_status", label: "Email", render:(row)=><StatusBadge tone={statusTone(row.email_delivery_status)}>{row.email_delivery_status}</StatusBadge> },
                { key: "email_last_sent_at", label: "Last Sent", render:(row)=>formatDateTime(row.email_last_sent_at) },
                { key: "created_at", label: "Created", render: (row) => formatDateTime(row.created_at) },
                {
                  key: "actions",
                  label: "Actions",
                  render: (row) => (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => openDetail(row)} className="rounded border border-border px-2 py-1 text-[11px] font-semibold">Details</button>
                      <button type="button" disabled={!row.payment_url || row.status === "Cancelled"} onClick={() => copyLink(row)} className="rounded border border-border px-2 py-1 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50">Copy link</button>
                      <button type="button" disabled={row.status === "Cancelled" || resendingInvoice===row.invoice_number} onClick={() => resend(row)} className="rounded border border-border px-2 py-1 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50">{resendingInvoice===row.invoice_number?"Resending…":"Resend email"}</button>
                    </div>
                  )
                }
              ]}
            />
          </SectionCard>
        </div>
      </div>
      <InvoiceDetailDialog detail={detail} onClose={() => setDetail({ invoice: null, data: null, loading: false, error: "" })} />
    </>
  );
}

function GatewayPaymentDialog({ state, onClose, onSubmit }) {
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "", country_code: "255", network: "", amount: "" });
  useEffect(() => {
    if (state.invoice) setCustomer({ name: state.invoice.owner_information || "", email: "", phone: "", country_code: "255", network: "", amount: state.invoice.outstanding_balance || "" });
  }, [state.invoice]);
  if (!state.invoice) return null;
  const result = state.result;
  const redirectUrl = result?.next_action?.redirect_url?.url;
  const instruction = result?.next_action?.payment_instruction?.note || result?.next_action?.payment_instruction?.instruction || result?.next_action?.payment_instruction?.message;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-lg rounded-md border border-border bg-card p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div><div className="text-sm font-semibold">Flutterwave Mobile Money</div><div className="mt-1 font-mono text-xs text-muted-foreground">{state.invoice.invoice_number}</div></div>
          <button type="button" onClick={onClose} className="rounded border border-border px-2 py-1 text-xs font-semibold">Close</button>
        </div>
        {!result ? (
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSubmit(customer); }}>
            <FormField label="Customer Name"><input className={inputClass} value={customer.name} onChange={(event) => setCustomer((current) => ({ ...current, name: event.target.value }))} required /></FormField>
            <FormField label="Email"><input className={inputClass} type="email" value={customer.email} onChange={(event) => setCustomer((current) => ({ ...current, email: event.target.value }))} required /></FormField>
            <FormField label="Country Code"><input className={inputClass} value={customer.country_code} onChange={(event) => setCustomer((current) => ({ ...current, country_code: event.target.value }))} required /></FormField>
            <FormField label="Mobile Number"><input className={inputClass} inputMode="tel" placeholder="7XXXXXXXX" value={customer.phone} onChange={(event) => setCustomer((current) => ({ ...current, phone: event.target.value }))} required /></FormField>
            <FormField label="Mobile Money Network"><input className={inputClass} placeholder="Provider network code" value={customer.network} onChange={(event) => setCustomer((current) => ({ ...current, network: event.target.value }))} required /></FormField>
            <FormField label={`Amount to Pay Now (max ${formatMoney(state.invoice.outstanding_balance, state.invoice.currency)})`}><input className={inputClass} type="number" min="0.01" step="0.01" max={state.invoice.outstanding_balance} value={customer.amount} onChange={(event) => setCustomer((current) => ({ ...current, amount: event.target.value }))} required /></FormField>
            <div className="flex items-end"><button type="submit" disabled={state.submitting} className="h-9 rounded bg-info px-3 text-xs font-semibold text-info-foreground disabled:opacity-50">{state.submitting ? "Initiating..." : "Initiate Sandbox Payment"}</button></div>
            {state.error && <div className="sm:col-span-2"><ErrorState message={state.error} /></div>}
          </form>
        ) : (
          <div className="mt-4 space-y-3 text-xs">
            <ReadonlyValue label="WMS Payment Reference" value={result.payment_reference} />
            <ReadonlyValue label="Payment Attempt" value={result.attempt_reference} />
            <ReadonlyValue label="Installment Amount" value={formatMoney(result.amount, state.invoice.currency)} />
            <ReadonlyValue label="Flutterwave Charge" value={result.charge_id} />
            <ReadonlyValue label="Provider Status" value={result.status} />
            {instruction && <div className="rounded border border-info/30 bg-info/10 p-3">{instruction}</div>}
            {redirectUrl && <a href={redirectUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded bg-info px-3 font-semibold text-info-foreground">Continue Sandbox Authorization</a>}
          </div>
        )}
      </div>
    </div>
  );
}

function InvoiceDetailDialog({ detail, onClose }) {
  if (!detail.invoice) return null;
  const invoice = detail.data || detail.invoice;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-md border border-border bg-card p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Invoice Detail</div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">{invoice.invoice_number}</div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => window.print()} className="rounded border border-border px-2 py-1 text-xs font-semibold">Print</button>
            <button type="button" onClick={onClose} className="rounded border border-border px-2 py-1 text-xs font-semibold">Close</button>
          </div>
        </div>
        {detail.loading && <div className="mt-4 text-xs text-muted-foreground">Loading invoice...</div>}
        {detail.error && <div className="mt-4"><ErrorState message={detail.error} /></div>}
        {!detail.loading && !detail.error && (
          <div className="mt-4 space-y-4 text-xs">
            <div className="grid gap-3 sm:grid-cols-3">
              <ReadonlyValue label="Cargo" value={invoice.cargo_reference} />
              <ReadonlyValue label="Status" value={invoice.status} />
              <ReadonlyValue label="Workflow State" value={invoice.workflow_state || invoice.status} />
              <ReadonlyValue label="Cargo Approval" value={invoice.cargo_approval_status || (invoice.status === "Draft" ? "Pending Supervisor Approval" : "Approved / Awaiting Payment")} />
              <ReadonlyValue label="Payment" value={invoice.payment_status} />
              <ReadonlyValue label="Payment Reference" value={invoice.payment_reference || "Available after supervisor approval"} />
              <ReadonlyValue label="Billing Period" value={`${formatDateTime(invoice.billing_period_start)} to ${formatDateTime(invoice.billing_period_end)}`} />
              <ReadonlyValue label="Billable Days" value={invoice.billable_days} />
              <ReadonlyValue label="Total" value={formatMoney(invoice.total_amount, invoice.currency)} />
              <ReadonlyValue label="Paid" value={formatMoney(invoice.amount_paid, invoice.currency)} />
              <ReadonlyValue label="Outstanding" value={formatMoney(invoice.outstanding_balance, invoice.currency)} />
              <ReadonlyValue label="Tariff" value={invoice.tariff?.tariff_name || "Snapshot unavailable"} />
            </div>
            {invoice.cancellation_reason && <ReadonlyValue label="Cancellation Reason" value={invoice.cancellation_reason} />}
            <SectionCard title="Charge Breakdown" icon={ReceiptText}>
              <DataTable rows={invoice.line_items || []} emptyTitle="No line items" columns={[
                { key: "line_type", label: "Type" },
                { key: "description", label: "Description" },
                { key: "quantity", label: "Quantity" },
                { key: "unit_rate", label: "Unit Rate", render: (row) => formatMoney(row.unit_rate, invoice.currency) },
                { key: "amount", label: "Amount", render: (row) => formatMoney(row.amount, invoice.currency) }
              ]} />
            </SectionCard>
            <SectionCard title="Installment & Payment History" icon={ReceiptText}>
              <DataTable rows={invoice.payment_history || []} emptyTitle="No payment attempts yet" columns={[
                { key: "public_reference", label: "Attempt" },
                { key: "amount", label: "Amount", render: (row) => formatMoney(row.amount, invoice.currency) },
                { key: "status", label: "Status" },
                { key: "gateway_status", label: "Gateway" },
                { key: "confirmed_at", label: "Confirmed", render: (row) => formatDateTime(row.confirmed_at) }
              ]} />
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentsPage() {
  const payments = useLoad(() => getFinancePayments(), "payments");

  return (
    <>
      <PageHeader eyebrow="Finance" title="Payments" description="Monitor provider-verified payments, failures, exceptions, and reconciliation." />
      <div className="flex-1 overflow-auto p-4">
        <div>
          <SectionCard title="Recent Payments" icon={CreditCard}>
            <DataTable
              loading={payments.loading}
              error={payments.error}
              rows={payments.rows || []}
              emptyTitle="No payments recorded"
              columns={[
                { key: "master_payment_reference", label: "Master Ref", className: "font-mono font-semibold" },
                { key: "attempt_reference", label: "Attempt", className: "font-mono" },
                { key: "invoice_number", label: "Invoice", className: "font-mono" },
                { key: "cargo_reference", label: "Cargo", className: "font-mono" },
                { key: "amount", label: "Amount", render: (row) => formatMoney(row.amount) },
                { key: "gateway_transaction_id", label: "Provider Charge", className: "font-mono" },
                { key: "verified_at", label: "Verified", render: (row) => formatDateTime(row.verified_at) },
                { key: "reconciliation_status", label: "Reconciliation" }
                ,{ key: "status", label: "Status", render: (row) => <StatusBadge tone={row.status === "Confirmed" ? "success" : "warning"}>{row.status}</StatusBadge> }
                ,{ key: "gateway_status", label: "Gateway", render: (row) => <StatusBadge tone={statusTone(row.gateway_status)}>{row.gateway_status || "Legacy"}</StatusBadge> }
              ]}
            />
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function TariffsPage() {
  const tariffs = useLoad(() => getFinanceTariffs(), "tariffs");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    tariff_name: "",
    cargo_type: "",
    charging_unit: "per_cargo_per_day",
    daily_rate: "",
    currency: "TZS",
    minimum_billable_days: 1,
    grace_period_days: 0,
    penalty_type: "none",
    penalty_rate: 0,
    fixed_penalty: 0,
    effective_from: "",
    effective_to: "",
    notes: ""
  });

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    try {
      await createFinanceTariff(form);
      setMessage("Tariff version created.");
      await tariffs.refresh();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };

  const activate = async (reference) => {
    setMessage("");
    try {
      await activateFinanceTariff(reference);
      setMessage(`${reference} activated.`);
      await tariffs.refresh();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };

  const deactivate = async (reference) => {
    setMessage("");
    try {
      await deactivateFinanceTariff(reference);
      setMessage(`${reference} deactivated.`);
      await tariffs.refresh();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };

  const saveEdit = async (payload) => {
    setMessage("");
    try {
      await updateFinanceTariff(editing.tariff_version_reference, payload);
      setEditing(null);
      setMessage(`${editing.tariff_version_reference} updated.`);
      await tariffs.refresh();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };

  return (
    <>
      <PageHeader eyebrow="Finance" title="Tariff Configuration" description="Create versioned storage tariffs without granting unrelated system settings access." />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title="New Tariff Version" icon={Plus}>
          <form className="grid gap-3 md:grid-cols-3 xl:grid-cols-4" onSubmit={submit}>
            <FormInput label="Tariff Name" value={form.tariff_name} onChange={(value) => setForm((current) => ({ ...current, tariff_name: value }))} required />
            <SelectField
              label="Cargo Type Key (or default)"
              value={form.cargo_type}
              onChange={(value) => setForm((current) => ({ ...current, cargo_type: value }))}
              options={[
                { value: "", label: "Select cargo type key" },
                { value: "general_goods", label: "general_goods (General Goods)" },
                { value: "electronics", label: "electronics (Electronics)" },
                { value: "machinery", label: "machinery (Machinery)" },
                { value: "food_products", label: "food_products (Food Products)" },
                { value: "construction_materials", label: "construction_materials (Construction Materials)" },
                { value: "fragile_goods", label: "fragile_goods (Fragile Goods)" },
                { value: "hazardous_cargo", label: "hazardous_cargo (Hazardous Cargo)" },
                { value: "mixed_cargo", label: "mixed_cargo (Mixed Cargo)" },
                { value: "default", label: "default (Default / All Types)" }
              ]}
            />
            <SelectField label="Charging Unit" value={form.charging_unit} onChange={(value) => setForm((current) => ({ ...current, charging_unit: value }))} options={["per_cargo_per_day", "per_kilogram_per_day", "per_tonne_per_day", "per_cubic_metre_per_day", "fixed_daily_charge"]} />
            <FormInput label="Daily Rate" type="number" value={form.daily_rate} onChange={(value) => setForm((current) => ({ ...current, daily_rate: value }))} required />
            <FormInput label="Currency" value="TZS" onChange={() => {}} required />
            <FormInput label="Minimum Days" type="number" value={form.minimum_billable_days} onChange={(value) => setForm((current) => ({ ...current, minimum_billable_days: value }))} />
            <FormInput label="Grace Days" type="number" value={form.grace_period_days} onChange={(value) => setForm((current) => ({ ...current, grace_period_days: value }))} />
            <SelectField label="Penalty Type" value={form.penalty_type} onChange={(value) => setForm((current) => ({ ...current, penalty_type: value }))} options={["none", "percentage", "fixed"]} />
            <FormInput label="Penalty Rate" type="number" value={form.penalty_rate} onChange={(value) => setForm((current) => ({ ...current, penalty_rate: value }))} />
            <FormInput label="Fixed Penalty" type="number" value={form.fixed_penalty} onChange={(value) => setForm((current) => ({ ...current, fixed_penalty: value }))} />
            <FormInput label="Effective From" type="datetime-local" value={form.effective_from} onChange={(value) => setForm((current) => ({ ...current, effective_from: value }))} required />
            <FormInput label="Effective To" type="datetime-local" value={form.effective_to} onChange={(value) => setForm((current) => ({ ...current, effective_to: value }))} />
            <FormInput label="Notes" value={form.notes} onChange={(value) => setForm((current) => ({ ...current, notes: value }))} />
            <div className="flex items-end">
              <button type="submit" className="inline-flex h-9 items-center gap-2 rounded bg-info px-3 text-xs font-semibold text-info-foreground">
                <Save className="h-4 w-4" />
                Create Tariff
              </button>
            </div>
          </form>
        </SectionCard>
        {message && <div className="mt-3 rounded border border-info/30 bg-info/10 px-3 py-2 text-xs font-semibold text-info">{message}</div>}
        <div className="mt-3">
          <SectionCard title="Tariff Versions" icon={Settings2}>
            <DataTable
              loading={tariffs.loading}
              error={tariffs.error}
              rows={tariffs.rows || []}
              emptyTitle="No tariffs configured"
              columns={[
                { key: "tariff_version_reference", label: "Version Ref", className: "font-mono font-semibold" },
                { key: "tariff_name", label: "Name" },
                { key: "cargo_type", label: "Cargo Type" },
                { key: "charging_unit", label: "Unit" },
                { key: "daily_rate", label: "Daily Rate", render: (row) => formatMoney(row.daily_rate, row.currency) },
                { key: "minimum_billable_days", label: "Min Days" },
                { key: "effective_from", label: "Effective From", render: (row) => formatDateTime(row.effective_from) },
                { key: "effective_to", label: "Effective To", render: (row) => formatDateTime(row.effective_to) },
                { key: "approval_status", label: "Approval", render: (row) => <StatusBadge tone={statusTone(row.approval_status)}>{row.approval_status || "Draft"}</StatusBadge> },
                { key: "is_active", label: "Status", render: (row) => <StatusBadge tone={row.is_active ? "success" : "muted"}>{row.is_active ? "Active" : "Inactive"}</StatusBadge> },
                { key: "actions", label: "Actions", render: (row) => (
                  <div className="flex flex-wrap gap-1">
                    {["DRAFT","REJECTED"].includes(row.approval_status) && <button type="button" onClick={() => setEditing(row)} className="rounded border border-border px-2 py-1 text-[11px] font-semibold">Edit</button>}
                    {["DRAFT","REJECTED"].includes(row.approval_status) && <button type="button" onClick={async()=>{await submitFinanceTariff(row.tariff_version_reference);await tariffs.refresh()}} className="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground">Submit</button>}
                    {!row.is_active && row.approval_status === "APPROVED" && <button type="button" onClick={() => activate(row.tariff_version_reference)} className="rounded bg-success px-2 py-1 text-[11px] font-semibold text-success-foreground">Activate</button>}
                    {row.is_active && <button type="button" onClick={() => deactivate(row.tariff_version_reference)} className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] font-semibold text-warning">Deactivate</button>}
                  </div>
                ) }
              ]}
            />
          </SectionCard>
        </div>
      </div>
      <TariffEditDialog tariff={editing} onClose={() => setEditing(null)} onSave={saveEdit} />
    </>
  );
}

function TariffEditDialog({ tariff, onClose, onSave }) {
  const [form, setForm] = useState({});
  useEffect(() => {
    if (tariff) {
      setForm({
        tariff_name: tariff.tariff_name || "",
        cargo_type: tariff.cargo_type || "",
        charging_unit: tariff.charging_unit || "per_cargo_per_day",
        daily_rate: tariff.daily_rate || "",
        currency: tariff.currency || "TZS",
        minimum_billable_days: tariff.minimum_billable_days || 1,
        grace_period_days: tariff.grace_period_days || 0,
        penalty_type: tariff.penalty_type || "none",
        penalty_rate: tariff.penalty_rate || 0,
        fixed_penalty: tariff.fixed_penalty || 0,
        effective_from: tariff.effective_from ? String(tariff.effective_from).slice(0, 16) : "",
        effective_to: tariff.effective_to ? String(tariff.effective_to).slice(0, 16) : "",
        notes: tariff.notes || ""
      });
    }
  }, [tariff]);
  if (!tariff) return null;
  const submit = (event) => {
    event.preventDefault();
    onSave(form);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <form onSubmit={submit} className="w-full max-w-3xl rounded-md border border-border bg-card p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Edit Tariff Version</div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">{tariff.tariff_version_reference}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-border px-2 py-1 text-xs font-semibold">Close</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <FormInput label="Tariff Name" value={form.tariff_name || ""} onChange={(value) => setForm((current) => ({ ...current, tariff_name: value }))} required />
          <SelectField
            label="Cargo Type Key (or default)"
            value={form.cargo_type_key || form.cargo_type || ""}
            onChange={(value) => setForm((current) => ({ ...current, cargo_type_key: value }))}
            options={[
              { value: "", label: "Select cargo type key" },
              { value: "general_goods", label: "general_goods (General Goods)" },
              { value: "electronics", label: "electronics (Electronics)" },
              { value: "machinery", label: "machinery (Machinery)" },
              { value: "food_products", label: "food_products (Food Products)" },
              { value: "construction_materials", label: "construction_materials (Construction Materials)" },
              { value: "fragile_goods", label: "fragile_goods (Fragile Goods)" },
              { value: "hazardous_cargo", label: "hazardous_cargo (Hazardous Cargo)" },
              { value: "mixed_cargo", label: "mixed_cargo (Mixed Cargo)" },
              { value: "default", label: "default (Default / All Types)" }
            ]}
          />
          <SelectField label="Charging Unit" value={form.charging_unit || "per_cargo_per_day"} onChange={(value) => setForm((current) => ({ ...current, charging_unit: value }))} options={["per_cargo_per_day", "per_kilogram_per_day", "per_tonne_per_day", "per_cubic_metre_per_day", "fixed_daily_charge"]} />
          <FormInput label="Daily Rate" type="number" value={form.daily_rate || ""} onChange={(value) => setForm((current) => ({ ...current, daily_rate: value }))} required />
          <FormInput label="Minimum Days" type="number" value={form.minimum_billable_days || 1} onChange={(value) => setForm((current) => ({ ...current, minimum_billable_days: value }))} />
          <FormInput label="Grace Days" type="number" value={form.grace_period_days || 0} onChange={(value) => setForm((current) => ({ ...current, grace_period_days: value }))} />
          <FormInput label="Effective From" type="datetime-local" value={form.effective_from || ""} onChange={(value) => setForm((current) => ({ ...current, effective_from: value }))} required />
          <FormInput label="Effective To" type="datetime-local" value={form.effective_to || ""} onChange={(value) => setForm((current) => ({ ...current, effective_to: value }))} />
          <FormInput label="Notes" value={form.notes || ""} onChange={(value) => setForm((current) => ({ ...current, notes: value }))} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-border px-3 py-2 text-xs font-semibold">Cancel</button>
          <button type="submit" className="rounded bg-info px-3 py-2 text-xs font-semibold text-info-foreground">Save Tariff</button>
        </div>
      </form>
    </div>
  );
}

function FormInput({ label, value, onChange, type = "text", required = false }) {
  return (
    <FormField label={label}>
      <input className={inputClass} type={type} value={value} required={required} min={type === "number" ? "0" : undefined} step={type === "number" ? "0.01" : undefined} onChange={(event) => onChange(event.target.value)} />
    </FormField>
  );
}

function ReportsPage() {
  return <RoleReports scope="finance" />;
}

function ReportBarChart({ data, xKey, yKey }) {
  if (!data?.length) {
    return <div className="mb-3 rounded border border-border bg-muted/20 p-4 text-xs text-muted-foreground">No chart data available.</div>;
  }
  const chartData = data.map((row) => ({
    ...row,
    [yKey]: Number(row[yKey] || 0)
  }));
  return (
    <div className="mb-3 h-52 rounded border border-border bg-background p-2">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip formatter={(value) => formatMoney(value)} />
          <Bar dataKey={yKey} fill="hsl(var(--info))" radius={[3, 3, 0, 0]} />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProfilePage() {
  return <AccountProfilePage title="Finance Officer Profile" description="Your authenticated finance account details." />;
}

function FinancePortal() {
  return (
    <FinanceLayout>
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="cargo-charges" element={<CargoChargesPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="tariffs" element={<TariffsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/finance" replace />} />
      </Routes>
    </FinanceLayout>
  );
}

export default FinancePortal;
