import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Database, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function StatusBadge({ children, tone, className }) {
  const tones = {
    success: "border-success/40 bg-success/15 text-success",
    registered: "border-orange-500/45 bg-orange-50 text-orange-700",
    pending: "border-yellow-500/45 bg-yellow-50 text-yellow-700",
    warning: "border-warning/40 bg-warning/20 text-warning",
    released: "border-info/40 bg-info/15 text-info",
    info: "border-info/40 bg-info/15 text-info",
    destructive: "border-destructive/40 bg-destructive/10 text-destructive",
    muted: "border-border bg-muted text-muted-foreground"
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold",
        tones[tone] || tones.muted,
        className
      )}
    >
      {children}
    </span>
  );
}

function SectionCard({ title, icon: Icon, action, children, className }) {
  return (
    <section className={cn("overflow-hidden rounded-md border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border bg-panel-header px-3 py-2 text-panel-header-foreground">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-info" />}
          <span className="truncate">{title}</span>
        </div>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function EmptyState({ icon: Icon = Database, title, body }) {
  return (
    <div className="rounded border border-dashed border-border bg-muted/20 px-3 py-5 text-center">
      <Icon className="mx-auto h-5 w-5 text-muted-foreground" />
      <div className="mt-2 text-xs font-semibold text-foreground">{title}</div>
      {body && <div className="mt-1 text-[11px] text-muted-foreground">{body}</div>}
    </div>
  );
}

function LoadingState({ label = "Loading operational data..." }) {
  return (
    <div className="flex items-center gap-2 rounded border border-border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin text-info" />
      {label}
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="flex items-center gap-2 rounded border border-destructive/35 bg-destructive/10 px-3 py-3 text-xs font-semibold text-destructive">
      <AlertTriangle className="h-4 w-4" />
      {message}
    </div>
  );
}

function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5 py-3">
      <div>
        {eyebrow && <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{eyebrow}</div>}
        <h1 className="mt-0.5 text-lg font-semibold leading-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const PAGE_SIZES = [10, 20, 50, 100];

function PaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  itemLabel = "records"
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = total ? (currentPage - 1) * pageSize + 1 : 0;
  const end = Math.min(total, currentPage * pageSize);
  const pageItems = [];

  for (let candidate = 1; candidate <= totalPages; candidate += 1) {
    if (candidate === 1 || candidate === totalPages || Math.abs(candidate - currentPage) <= 1) {
      pageItems.push(candidate);
    } else if (pageItems[pageItems.length - 1] !== "ellipsis") {
      pageItems.push("ellipsis");
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border bg-muted/10 px-3 py-3 text-xs text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
      <span className="font-medium">{start.toLocaleString()}–{end.toLocaleString()} of {Number(total).toLocaleString()} {itemLabel}</span>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 rounded border border-input bg-background px-2 text-foreground"
          >
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <nav aria-label="Table pagination" className="flex items-center gap-1">
          <button type="button" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)} className="inline-flex h-8 items-center gap-1 rounded border border-border px-2 font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-40">
            <ChevronLeft className="h-3.5 w-3.5" /> Previous
          </button>
          {pageItems.map((item, index) => item === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="px-1" aria-hidden="true">…</span>
          ) : (
            <button
              key={item}
              type="button"
              aria-label={`Page ${item}`}
              aria-current={item === currentPage ? "page" : undefined}
              onClick={() => onPageChange(item)}
              className={cn("h-8 min-w-8 rounded border px-2 font-semibold", item === currentPage ? "border-info bg-info text-info-foreground" : "border-border text-foreground hover:bg-muted")}
            >
              {item}
            </button>
          ))}
          <button type="button" disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)} className="inline-flex h-8 items-center gap-1 rounded border border-border px-2 font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-40">
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </nav>
      </div>
    </div>
  );
}

function DataTable({
  columns,
  rows = [],
  loading,
  error,
  emptyTitle = "No records",
  emptyBody,
  tableClassName,
  containerClassName,
  pagination = true,
  initialPageSize = 10,
  page: controlledPage,
  pageSize: controlledPageSize,
  total: controlledTotal,
  onPageChange,
  onPageSizeChange,
  itemLabel = "records",
  resetKey
}) {
  const validInitialSize = PAGE_SIZES.includes(initialPageSize) ? initialPageSize : 10;
  const [localPage, setLocalPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(validInitialSize);
  const serverMode = controlledTotal !== undefined || controlledPage !== undefined;
  const page = controlledPage ?? localPage;
  const pageSize = controlledPageSize ?? localPageSize;
  const total = controlledTotal ?? rows.length;
  const rowSignature = useMemo(() => rows.map((row, index) => row.id ?? row.public_reference ?? row.cargo_id ?? row.barcode ?? row.code ?? index).join("|"), [rows]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    if (controlledPage === undefined) setLocalPage(1);
    else if (controlledPage > totalPages) onPageChange?.(totalPages);
  }, [rowSignature, resetKey, controlledPage, totalPages, onPageChange]);

  const changePage = (nextPage) => {
    if (controlledPage === undefined) setLocalPage(nextPage);
    onPageChange?.(nextPage);
  };
  const changePageSize = (nextSize) => {
    if (controlledPageSize === undefined) setLocalPageSize(nextSize);
    if (controlledPage === undefined) setLocalPage(1);
    onPageSizeChange?.(nextSize);
    onPageChange?.(1);
  };
  const visibleRows = pagination && !serverMode
    ? rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : rows;

  if (loading && !rows.length) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className={cn("overflow-hidden rounded border border-border", containerClassName)}>
      <div className="overflow-auto">
        <table className={cn("w-full min-w-[720px] text-xs", tableClassName)}>
        <thead className="bg-panel-header text-panel-header-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={cn("px-2 py-2 text-left font-semibold", column.headerClassName)}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr className="border-t border-border">
              <td colSpan={columns.length} className="p-3">
                <EmptyState title={emptyTitle} body={emptyBody} />
              </td>
            </tr>
          ) : (
            visibleRows.map((row, rowIndex) => (
              <tr key={row.id ?? row.cargo_id ?? row.barcode ?? row.code ?? rowIndex} className="border-t border-border">
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-2 py-2 align-top", column.className)}>
                    {column.render ? column.render(row) : row[column.key] ?? "No data"}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        </table>
      </div>
      {pagination && rows.length > 0 && (
        <PaginationControls page={currentPage} pageSize={pageSize} total={total} onPageChange={changePage} onPageSizeChange={changePageSize} itemLabel={itemLabel} />
      )}
    </div>
  );
}

function OperationalStatCard({ title, icon: Icon, loading, error, value, emptyTitle, emptyBody, tone = "info" }) {
  const toneClasses = {
    info: "text-info bg-info/10 border-info/25",
    success: "text-success bg-success/10 border-success/25",
    warning: "text-warning bg-warning/10 border-warning/25",
    destructive: "text-destructive bg-destructive/10 border-destructive/25"
  };

  return (
    <section className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-muted-foreground">{title}</div>
          {loading ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading
            </div>
          ) : error ? (
            <div className="mt-3 text-xs font-semibold text-destructive">{error}</div>
          ) : value !== undefined && value !== null && Number(value) > 0 ? (
            <div className="mt-2 text-2xl font-semibold leading-none">{Number(value).toLocaleString()}</div>
          ) : (
            <div className="mt-3">
              <EmptyState title={emptyTitle} body={emptyBody} />
            </div>
          )}
        </div>
        {Icon && (
          <div className={cn("rounded-md border p-2", toneClasses[tone])}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
    </section>
  );
}

export {
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  OperationalStatCard,
  PageHeader,
  PaginationControls,
  SectionCard,
  StatusBadge
};
