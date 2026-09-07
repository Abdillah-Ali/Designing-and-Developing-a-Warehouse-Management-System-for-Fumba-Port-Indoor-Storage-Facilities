import { useState } from "react";
import { Menu, LogOut } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

function isActive(location, item, basePath) {
  if (item.to) return item.to === basePath
    ? location.pathname === basePath || location.pathname === `${basePath}/dashboard`
    : location.pathname === item.to;
  return item.children?.some((child) => isActive(location, child, basePath));
}

function CollapsibleSidebar({ navigation, role, consoleName, basePath, footerNote, exitLabel = "Exit", onExit }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const renderItem = (item, nested = false) => {
    const Icon = item.icon;
    const active = isActive(location, item, basePath);

    if (item.children) {
      return (
        <div key={item.label} className="py-1">
          <div
            title={collapsed ? item.label : undefined}
            className={cn(
              "flex min-h-9 items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/60",
              collapsed && "justify-center px-2",
              active && "text-sidebar-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </div>
          <div className="space-y-0.5">{item.children.map((child) => renderItem(child, true))}</div>
        </div>
      );
    }

    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === basePath}
        title={collapsed ? item.label : undefined}
        aria-label={item.label}
        className={({ isActive: linkActive }) => cn(
          "relative flex min-h-10 items-center gap-3 px-4 py-2 text-sm transition-colors duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          nested && "py-2 pl-8 text-xs",
          collapsed && "justify-center px-2",
          linkActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
        )}
      >
        {active && <span className="absolute inset-y-0 left-0 w-1 bg-sidebar-primary" />}
        <Icon className={cn("shrink-0", nested ? "h-3.5 w-3.5" : "h-4 w-4")} />
        {!collapsed && <span className="min-w-0 truncate">{item.label}</span>}
      </NavLink>
    );
  };

  return (
    <aside className={cn(
      "flex h-full shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
      collapsed ? "w-16" : "w-64"
    )}>
      <div className={cn("border-b border-sidebar-border", collapsed ? "p-2" : "px-4 py-4")}>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className={cn("flex h-9 items-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus:outline-none focus:ring-2 focus:ring-sidebar-ring", collapsed ? "w-full justify-center" : "gap-3 px-2")}
          aria-label={collapsed ? "Expand navigation menu" : "Collapse navigation menu"}
          title={collapsed ? "Expand menu" : "Collapse menu"}
        >
          <Menu className="h-5 w-5 shrink-0" />
          {!collapsed && <span className="text-xs font-medium">Menu</span>}
        </button>
        {!collapsed && <div className="mt-2"><div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/60">{role}</div><div className="mt-1 text-sm font-semibold">{consoleName}</div></div>}
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2">{navigation.map((item) => renderItem(item))}</nav>
      <div className={cn("border-t border-sidebar-border", collapsed ? "p-2" : "p-3")}>
        <button
          type="button"
          onClick={onExit}
          title={collapsed ? exitLabel : undefined}
          aria-label={collapsed ? exitLabel : `Exit ${role} console`}
          className={cn("flex items-center justify-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent py-2 text-xs font-semibold text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent/80", collapsed ? "w-full px-2" : "w-full px-3")}
        ><LogOut className="h-3.5 w-3.5 shrink-0" />{!collapsed && exitLabel}</button>
        {!collapsed && footerNote && <div className="mt-3 px-1 text-[11px] text-sidebar-foreground/60">{footerNote}</div>}
      </div>
    </aside>
  );
}

export { CollapsibleSidebar };
