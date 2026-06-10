import { AlertTriangle, Database, Loader2 } from "lucide-react";
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

function DataTable({ columns, rows, loading, error, emptyTitle, emptyBody }) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="overflow-auto rounded border border-border">
      <table className="w-full min-w-[720px] text-xs">
        <thead className="bg-panel-header text-panel-header-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="px-2 py-2 text-left font-semibold">
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
            rows.map((row, rowIndex) => (
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
  SectionCard,
  StatusBadge
};
