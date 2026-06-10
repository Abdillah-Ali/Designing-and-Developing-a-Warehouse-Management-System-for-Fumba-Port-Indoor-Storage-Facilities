import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
function CollapsibleCard({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return <div className="border border-border rounded-md bg-card overflow-hidden"><div className="wms-panel-header"><span>{title}</span><button
    type="button"
    onClick={() => setOpen((o) => !o)}
    className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
  >{open ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}{open ? "Collapse" : "Expand"}</button></div><div className={cn("px-4 py-3", !open && "hidden")}>{children}</div></div>;
}
function FieldRow({ label, children }) {
  return <div className="grid grid-cols-[180px_1fr] gap-3 items-center py-1.5"><label className="text-xs text-foreground/80">{label}</label><div>{children}</div></div>;
}
function CheckRow({ label, defaultChecked }) {
  return <label className="flex items-center gap-2 py-1 text-xs cursor-pointer"><input
    type="checkbox"
    defaultChecked={defaultChecked}
    className="h-3.5 w-3.5 rounded border-input text-primary focus:ring-1 focus:ring-ring"
  /><span>{label}</span></label>;
}
export {
  CheckRow,
  CollapsibleCard,
  FieldRow
};
