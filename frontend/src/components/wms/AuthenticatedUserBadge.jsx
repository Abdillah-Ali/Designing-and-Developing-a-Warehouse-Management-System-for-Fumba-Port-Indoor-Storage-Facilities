import { useEffect, useRef, useState } from "react";
import { KeyRound, LogOut, UserCircle2, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  getDisplayRoleName,
  getPortalConfig,
  getStoredAuthRole,
  getStoredAuthToken
} from "@/lib/portal-access";
import { cn } from "@/lib/utils";
import { ChangePasswordDialog } from "@/components/wms/ChangePasswordDialog";
import { getProfile, logout } from "@/services/api";

function AuthenticatedUserBadge({
  className,
  icon: Icon = UserCircle2,
  iconClassName,
  textClassName
}) {
  const [user, setUser] = useState(null);
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const navigate = useNavigate();
  const containerRef = useRef(null);

  useEffect(() => {
    let active = true;

    if (!getStoredAuthToken()) {
      setUser(null);
      return () => {
        active = false;
      };
    }

    getProfile()
      .then((response) => {
        if (active) {
          setUser(response.data?.user || response.data || null);
        }
      })
      .catch(() => {
        if (active) {
          setUser(null);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const displayName = String(user?.full_name || "").trim();
  const displayRole = getDisplayRoleName(user?.role_name);
  const warehouseName = String(user?.warehouse_name || "").trim();
  const portalConfig = getPortalConfig(getStoredAuthRole());
  const portalBase = portalConfig?.basePath || "";

  if (!displayName && !displayRole && !warehouseName) {
    return null;
  }

  const goToProfile = () => {
    setOpen(false);
    if (portalBase) navigate(`${portalBase}/profile`);
  };

  const goToPassword = () => {
    setOpen(false);
    setPasswordOpen(true);
  };

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    navigate("/");
  };

  return (
    <>
      <div
        ref={containerRef}
        className={cn("relative flex min-w-0 items-center border-l border-white/20 pl-3", className)}
      >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-white/10"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Signed in as ${displayName}${displayRole ? `, ${displayRole}` : ""}`}
      >
        <Icon className={cn("h-7 w-7 shrink-0", iconClassName)} />
        <div className={cn("min-w-0 max-w-[9rem] leading-tight text-right sm:max-w-[14rem] md:max-w-[16rem]", textClassName)}>
          {displayName && (
            <div className="truncate text-xs font-medium sm:text-sm" title={displayName}>
              {displayName}
            </div>
          )}
          {displayRole && (
            <div className="truncate text-[10px] text-white/75 sm:text-[11px]" title={displayRole}>
              {displayRole}
            </div>
          )}
          {warehouseName && (
            <div className="truncate text-[10px] text-white/65 sm:text-[11px]" title={warehouseName}>
              {warehouseName}
            </div>
          )}
        </div>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-56 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={goToProfile}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-muted"
          >
            <UserRound className="h-3.5 w-3.5" />
            My Profile
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={goToPassword}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-muted"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Change Password
          </button>
          <div className="border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-destructive hover:bg-muted"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>
      )}
      </div>
      <ChangePasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
      />
    </>
  );
}

export { AuthenticatedUserBadge };
