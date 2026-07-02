import { Anchor } from "lucide-react";
import { HeaderActions } from "@/components/wms/HeaderActions";

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

      <HeaderActions />
    </header>
  );
}

export { WmsHeader };
