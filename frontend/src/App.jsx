import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Landing from "./pages/Landing.jsx";
import Index from "./pages/Index.jsx";
import AdminPortal from "./pages/AdminPortal.jsx";
import NotFound from "./pages/NotFound.jsx";
import {
  PORTAL_ROLES,
  getPortalDefaultPath,
  getStoredAuthRole,
  isPathAllowedForRole,
} from "./lib/portal-access.js";

const queryClient = new QueryClient();

function PortalAccessGate({ role, children }) {
  const location = useLocation();
  const activeRole = getStoredAuthRole();
  const redirectedByRole = activeRole && activeRole !== role;
  const allowedPath = isPathAllowedForRole(role, location.pathname);

  if (!activeRole) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  if (redirectedByRole) {
    return <Navigate to={getPortalDefaultPath(activeRole)} replace />;
  }

  if (!allowedPath) {
    return <Navigate to={getPortalDefaultPath(role)} replace />;
  }

  return children;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
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
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
