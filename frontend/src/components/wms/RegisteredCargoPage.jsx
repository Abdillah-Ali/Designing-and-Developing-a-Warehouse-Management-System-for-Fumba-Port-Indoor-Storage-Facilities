import { useEffect, useState } from "react";
import { getCargo, getCargoById } from "@/services/api";
import { formatDateTime, statusTone } from "@/lib/wms-operational";
import { DataTable, ErrorState, LoadingState, PageHeader, SectionCard, StatusBadge } from "./OperationalUi";
import { EnterpriseModal } from "./EnterpriseModal";

const statuses = [
  ["registration_status", "Registration"], ["placement_status", "Placement"],
  ["customs_status", "Customs"], ["financial_status", "Finance"],
  ["management_release_status", "Management Release"], ["dispatch_status", "Dispatch"],
  ["gate_out_status", "Gate-Out"],
];
const badge = (value) => <StatusBadge tone={statusTone(value)}>{value || "Not recorded"}</StatusBadge>;

function CargoDetails({ reference, onClose }) {
  const [state, setState] = useState({ data: null, loading: true, error: "" });
  useEffect(() => {
    let active = true;
    getCargoById(reference)
      .then(response => { if (active) setState({ data: response.data, loading: false, error: "" }); })
      .catch(error => { if (active) setState({ data: null, loading: false, error: error.message }); });
    return () => { active = false; };
  }, [reference]);
  const cargo = state.data || {};
  const groups = [
    ["Cargo Information", [["Cargo Reference", cargo.cargo_id], ["Barcode", cargo.barcode],
      ["Reference Number", cargo.reference_number], ["Cargo Type", cargo.cargo_type],
      ["Description", cargo.cargo_description], ["Source", cargo.source_of_cargo],
      ["Container Number", cargo.container_number], ["Vehicle Number", cargo.vehicle_number],
      ["Quantity", cargo.quantity], ["Packaging", cargo.packaging_type],
      ["Weight (kg)", cargo.weight], ["Volume (m³)", cargo.volume], ["Hazard Class", cargo.hazard_class]]],
    ["Consignee / Owner", [["Consignee", cargo.consignee_name], ["Company", cargo.company_name],
      ["Contact Person", cargo.contact_person], ["Phone", cargo.phone_number], ["Email", cargo.email]]],
    ["Inspection & Receiving", [["Condition", cargo.cargo_condition], ["Inspection Notes", cargo.inspection_notes],
      ["Delivery Note", cargo.delivery_note_number], ["Received By", cargo.received_by],
      ["Received At", cargo.received_datetime ? formatDateTime(cargo.received_datetime) : null],
      ["Warehouse", cargo.warehouse_name], ["Current Location", cargo.location]]],
  ];
  return <EnterpriseModal open title={`Cargo Details: ${reference}`} onClose={onClose}>
    {state.loading ? <LoadingState label="Loading cargo details..." /> : state.error ? <ErrorState message={state.error} /> :
      <div className="space-y-4">
        <SectionCard title="Current Status"><dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {statuses.map(([key, label]) => <div key={key}><dt className="mb-1 text-xs font-semibold text-muted-foreground">{label}</dt><dd>{badge(cargo[key])}</dd></div>)}
        </dl></SectionCard>
        {groups.map(([title, fields]) => <SectionCard key={title} title={title}><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([label, value]) => <div key={label}><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{value ?? "—"}</dd></div>)}
        </dl></SectionCard>)}
        <SectionCard title="Supporting Documents">
          {cargo.documents?.length ? <ul className="space-y-2 text-sm">{cargo.documents.map((document, index) => <li key={document.id ?? index}>{document.file_name}</li>)}</ul> : <p className="text-sm text-muted-foreground">No supporting documents.</p>}
        </SectionCard>
      </div>}
  </EnterpriseModal>;
}

export function RegisteredCargoPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState(null);
  const [state, setState] = useState({ rows: [], total: 0, loading: true, error: "" });
  useEffect(() => {
    let active = true;
    setState(current => ({ ...current, rows: [], loading: true, error: "" }));
    const timer = setTimeout(() => {
      getCargo({ page, limit: pageSize, ...(search.trim() ? { search: search.trim() } : {}) })
        .then(response => { if (active) setState({ rows: Array.isArray(response.data) ? response.data : [], total: Number(response.total || 0), loading: false, error: "" }); })
        .catch(error => { if (active) setState({ rows: [], total: 0, loading: false, error: error.message }); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [page, pageSize, search, refresh]);

  return <>
    <PageHeader eyebrow="Cargo Operations" title="Registered Cargo" description="Browse all cargo available to your staff account, check its status, and view registration details." />
    <div className="flex-1 overflow-auto p-4"><SectionCard title="Cargo Records">
      <div className="mb-3 flex flex-wrap gap-2">
        <input aria-label="Search registered cargo" placeholder="Search cargo, owner, barcode, or delivery reference" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="h-9 w-full rounded border bg-background px-3 text-xs md:max-w-lg" />
        <button onClick={() => setRefresh(value => value + 1)} className="rounded border px-3 py-2 text-xs font-semibold">Refresh</button>
      </div>
      <DataTable rows={state.rows} total={state.total} loading={state.loading} error={state.error}
        page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize}
        emptyTitle="No registered cargo found" columns={[
          { key: "cargo_id", label: "Cargo Reference" }, { key: "cargo_type", label: "Type" },
          { key: "consignee_name", label: "Consignee / Owner" },
          ...statuses.map(([key, label]) => ({ key, label, render: row => badge(row[key]) })),
          { key: "details", label: "Details", render: row => <button aria-label={`View ${row.cargo_id}`} onClick={() => setSelected(row.cargo_id)} className="rounded border px-3 py-1 text-xs font-semibold">View</button> },
        ]} />
    </SectionCard></div>
    {selected && <CargoDetails key={selected} reference={selected} onClose={() => setSelected(null)} />}
  </>;
}
