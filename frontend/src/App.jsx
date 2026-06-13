import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Landing from "./pages/Landing.jsx";
import Index from "./pages/Index.jsx";
import AdminPortal from "./pages/AdminPortal.jsx";
import NotFound from "./pages/NotFound.jsx";
import ChangePassword from "./pages/ChangePassword.jsx";
import BootstrapAdminSetup from "./pages/BootstrapAdminSetup.jsx";
import SupervisorPortal from "./pages/SupervisorPortal.jsx";
import {
  PORTAL_ROLES,
  getPortalDefaultPath,
  getStoredAuthRole,
  isStoredBootstrapAdmin,
  isStoredBootstrapCompleted,
  isStoredBootstrapSetupPending,
  isPathAllowedForRole,
  mustChangeStoredPassword,
} from "./lib/portal-access.js";

const queryClient = new QueryClient();

function PortalAccessGate({ role, children }) {
  const location = useLocation();
  const activeRole = getStoredAuthRole();
  const redirectedByRole = activeRole && activeRole !== role;
  const allowedPath = isPathAllowedForRole(role, location.pathname);
  const mustChangePassword = mustChangeStoredPassword();

  if (!activeRole) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  if (isStoredBootstrapAdmin()) {
    return <Navigate to="/bootstrap-admin-setup" replace />;
  }

  if (mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  if (redirectedByRole) {
    return <Navigate to={getPortalDefaultPath(activeRole)} replace />;
  }

  if (!allowedPath) {
    return <Navigate to={getPortalDefaultPath(role)} replace />;
  }

  return children;
}

function PasswordChangeGate() {
  const activeRole = getStoredAuthRole();

  if (!activeRole) {
    return <Navigate to="/" replace />;
  }

  if (isStoredBootstrapAdmin()) {
    return <Navigate to="/bootstrap-admin-setup" replace />;
  }

  if (!mustChangeStoredPassword()) {
    return <Navigate to={getPortalDefaultPath(activeRole)} replace />;
  }

  return <ChangePassword />;
}

function BootstrapSetupGate() {
  const activeRole = getStoredAuthRole();

  if (!activeRole) {
    return <Navigate to="/" replace />;
  }

  if (!isStoredBootstrapAdmin()) {
    return <Navigate to={getPortalDefaultPath(activeRole)} replace />;
  }

  if (isStoredBootstrapCompleted() || !isStoredBootstrapSetupPending()) {
    return (
      <Navigate
        to="/"
        replace
        state={{ successMessage: "Bootstrap setup is complete. Please log in using the real administrator account." }}
      />
    );
  }

  return <BootstrapAdminSetup />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/bootstrap-admin-setup" element={<BootstrapSetupGate />} />
          <Route path="/change-password" element={<PasswordChangeGate />} />
          <Route
            path="/admin/*"
            element={
              <PortalAccessGate role={PORTAL_ROLES.SYSTEM_ADMIN}>
                <AdminPortal />
              </PortalAccessGate>
            }
          />
          <Route
            path="/staff/*"
            element={
              <PortalAccessGate role={PORTAL_ROLES.WAREHOUSE_STAFF}>
                <Index />
              </PortalAccessGate>
            }
          />
          <Route
            path="/supervisor/*"
            element={
              <PortalAccessGate role={PORTAL_ROLES.WAREHOUSE_SUPERVISOR}>
                <SupervisorPortal />
              </PortalAccessGate>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
