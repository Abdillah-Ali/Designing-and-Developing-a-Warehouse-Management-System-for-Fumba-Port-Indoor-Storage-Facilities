import { Anchor, HelpCircle, UserCircle2 } from "lucide-react";

function WmsHeader() {
  return (
    <header className="flex h-14 items-center justify-between bg-header px-5 text-header-foreground shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white/15">
          <Anchor className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="text-base font-semibold">Fumba Port WMS</div>
          <div className="text-[11px] text-white/75">Indoor Storage Facilities</div>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-4">
        <button
          className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white/10"
          aria-label="Help"
        >
          <HelpCircle className="h-4 w-4" />
          <span className="hidden sm:inline">Help</span>
        </button>

        <div className="flex min-w-0 items-center gap-2 border-l border-white/20 pl-3">
          <UserCircle2 className="h-7 w-7 shrink-0" />
          <div className="hidden min-w-0 leading-tight text-right sm:block">
            <div className="truncate text-sm font-medium">Warehouse Staff</div>
            <div className="truncate text-[11px] text-white/75">Operations</div>
          </div>
        </div>
      </div>
    </header>
  );
}

export { WmsHeader };
