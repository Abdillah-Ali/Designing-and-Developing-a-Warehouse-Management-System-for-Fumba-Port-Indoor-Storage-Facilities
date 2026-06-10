import {
  Activity,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  DoorOpen,
  LayoutDashboard,
  LogOut,
  MapPin,
  PackageCheck,
  PackagePlus,
  Rows3,
  ScanLine,
  SquareStack,
  Truck,
  UserCircle2,
  Warehouse
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { logout } from "@/services/api";

const staffBasePath = "/staff";

const navigation = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    to: staffBasePath
  },
  {
    label: "Cargo Operations",
    icon: PackagePlus,
    children: [
      { label: "Cargo Registration", icon: ClipboardList, to: "/staff/cargo/registration" },
      { label: "Placement & Scanning", icon: ScanLine, to: "/staff/cargo/placement-scanning" },
      { label: "Cargo Tracking", icon: MapPin, to: "/staff/cargo/tracking" }
    ]
  },
  {
    label: "Warehouse Storage",
    icon: Warehouse,
    children: [
      { label: "Zones", icon: Boxes, to: "/staff/storage/zones" },
      { label: "Racks", icon: Rows3, to: "/staff/storage/racks" },
      { label: "Levels", icon: SquareStack, to: "/staff/storage/levels" },
      { label: "Bins", icon: PackageCheck, to: "/staff/storage/bins" },
      { label: "Occupancy Status", icon: ClipboardCheck, to: "/staff/storage/occupancy" }
    ]
  },
  {
    label: "Dispatch Operations",
    icon: Truck,
    children: [
      { label: "Dispatch Queue", icon: ClipboardList, to: "/staff/dispatch/queue" },
      { label: "Gate Release", icon: DoorOpen, to: "/staff/dispatch/gate-release" },
      { label: "Released Cargo", icon: PackageCheck, to: "/staff/dispatch/released" }
    ]
  },
  {
    label: "Activity Logs",
    icon: Activity,
    to: "/staff/activity-logs"
  },
  {
    label: "Profile",
    icon: UserCircle2,
    to: "/staff/profile"
  }
];

function isItemActive(location, item) {
  if (item.to === staffBasePath) return location.pathname === staffBasePath || location.pathname === "/staff/dashboard";
  if (item.to) return location.pathname === item.to;
  return item.children?.some((child) => location.pathname === child.to);
}

function NavItem({ item, nested = false }) {
  const location = useLocation();
  const Icon = item.icon;
  const active = isItemActive(location, item);

  if (item.children) {
    return (
      <div className="py-1">
        <div
          className={cn(
            "flex items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/60",
            active && "text-sidebar-foreground"
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span>{item.label}</span>
        </div>
        <div className="space-y-0.5">
          {item.children.map((child) => (
            <NavItem key={child.label} item={child} nested />
          ))}
        </div>
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.to === staffBasePath}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          nested && "py-2 pl-8 text-xs",
          (isActive || active) && "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
        )
      }
    >
      {active && <span className="absolute left-0 top-0 bottom-0 w-1 bg-sidebar-primary" />}
      <Icon className={cn("shrink-0", nested ? "h-3.5 w-3.5" : "h-4 w-4")} />
      <span>{item.label}</span>
    </NavLink>
  );
}

function WmsSidebar() {
  const navigate = useNavigate();

  return (
    <aside className="sticky top-0 h-full w-64 shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col">
      <div className="border-b border-sidebar-border px-4 py-4">
        <div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/60">Warehouse Staff</div>
        <div className="mt-1 text-sm font-semibold">Operational Console</div>
      </div>
      <nav className="flex-1 overflow-auto py-2">
        {navigation.map((item) => (
          <NavItem key={item.label} item={item} />
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate("/");
          }}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent px-3 py-2 text-xs font-semibold text-sidebar-accent-foreground transition hover:bg-sidebar-accent/80"
          aria-label="Exit warehouse staff console"
        >
          <LogOut className="h-3.5 w-3.5" />
          Exit
        </button>
        <div className="mt-3 px-1 text-[11px] text-sidebar-foreground/60">Fumba Port WMS</div>
      </div>
    </aside>
  );
}

export { WmsSidebar };
