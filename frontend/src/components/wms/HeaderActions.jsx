import { HelpCircle, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getPortalConfig, getStoredAuthRole } from "@/lib/portal-access";
import { AuthenticatedUserBadge } from "@/components/wms/AuthenticatedUserBadge";
import { NotificationBell } from "@/components/wms/NotificationBell";

function HeaderActions() {
  const navigate = useNavigate();
  const portalBase = getPortalConfig(getStoredAuthRole())?.basePath || "";

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white/10"
        aria-label="Help"
      >
        <HelpCircle className="h-4 w-4" />
        <span className="hidden sm:inline">Help</span>
      </button>
      <NotificationBell />
      <button
        type="button"
        onClick={() => {
          if (portalBase) navigate(`${portalBase}/profile`);
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-white/10"
        aria-label="Settings"
      >
        <Settings className="h-4 w-4" />
      </button>
      <AuthenticatedUserBadge />
    </div>
  );
}

export { HeaderActions };
