import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import portImage from "@/assets/fumba-port.jpg";
import {
  clearStoredAuthToken,
  extractRoleFromToken,
  getPortalDefaultPath,
  getStoredAuthRole,
  isPathAllowedForRole,
  isStoredBootstrapAdmin,
  isStoredBootstrapCompleted,
  isStoredBootstrapSetupPending,
  mustChangeStoredPassword
} from "@/lib/portal-access";
import { login as signIn } from "@/services/api";

const getAccountRoute = (role, requestedPath) => (
  requestedPath && isPathAllowedForRole(role, requestedPath)
    ? requestedPath
    : getPortalDefaultPath(role)
);

const Landing = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const requestedPath = location.state?.from;

  useEffect(() => {
    const role = getStoredAuthRole();
    if (role) {
      if (isStoredBootstrapAdmin() && isStoredBootstrapCompleted()) {
        clearStoredAuthToken();
        return;
      }

      navigate(
        isStoredBootstrapSetupPending()
          ? "/bootstrap-admin-setup"
          : mustChangeStoredPassword()
            ? "/change-password"
            : getAccountRoute(role, requestedPath),
        { replace: true }
      );
    }
  }, [navigate, requestedPath]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await signIn(username.trim(), password);
      const role = extractRoleFromToken(response.data?.token);

      if (!role) {
        throw new Error("Your account role is not allowed in this portal.");
      }

      const mustChangePassword = Boolean(
        response.data?.user?.must_change_password
        ?? response.data?.must_change_password
        ?? mustChangeStoredPassword()
      );
      const bootstrapPending = Boolean(
        response.data?.user?.is_bootstrap_admin
        ?? response.data?.is_bootstrap_admin
        ?? response.is_bootstrap_admin
      ) && !(
        response.data?.user?.bootstrap_completed
        ?? response.data?.bootstrap_completed
        ?? response.bootstrap_completed
      );
      navigate(
        bootstrapPending
          ? "/bootstrap-admin-setup"
          : mustChangePassword
            ? "/change-password"
            : getAccountRoute(role, requestedPath),
        { replace: true }
      );
    } catch (err) {
      setError(err.message || "Sign in failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main
      className="min-h-dvh overflow-x-hidden bg-slate-950 bg-cover bg-center bg-no-repeat text-white md:bg-fixed"
      style={{
        backgroundImage: `linear-gradient(90deg, rgba(5, 25, 45, 0.9), rgba(5, 25, 45, 0.62) 44%, rgba(5, 25, 45, 0.28)), url(${portImage})`,
      }}
    >
      <div className="flex min-h-dvh w-full flex-col justify-center overflow-x-hidden px-6 py-10 sm:px-10 lg:px-20">
        <section className="w-full max-w-[900px]">
          <div className="max-w-[840px]">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.34em] text-cyan-100 sm:text-sm">
              Fumba Port Warehouse
            </p>
            <h1 className="max-w-[840px] text-4xl font-semibold leading-[1.06] sm:text-5xl lg:text-[4.35rem]">
              Fumba Port Warehouse Management System
            </h1>
            <p className="mt-5 max-w-[760px] text-base leading-7 text-white/85 sm:text-xl">
              Indoor Cargo Storage & Warehouse Operations Platform
            </p>
          </div>

          <div className="mt-9 w-full max-w-[460px]">
            <form
              onSubmit={handleSubmit}
              className="overflow-hidden rounded-lg border border-white/25 bg-white/95 text-slate-950 shadow-2xl shadow-black/25 backdrop-blur-xl"
            >
              <div className="border-b border-slate-200 bg-slate-50/90 px-5 py-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-white text-blue-700 shadow-sm">
                    <LockKeyhole className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold leading-snug text-slate-950">Sign in</h2>
                    <p className="mt-1 text-sm leading-5 text-slate-600">Use your assigned WMS account.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-5 py-5">
                <label className="grid gap-2 text-sm font-semibold text-slate-700">
                  Username
                  <span className="relative block">
                    <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="username"
                      placeholder="Enter username"
                      className="h-12 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm font-medium text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
                    />
                  </span>
                </label>
                <label className="grid gap-2 text-sm font-semibold text-slate-700">
                  Password
                  <span className="relative block">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="Enter password"
                      className="h-12 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-11 text-sm font-medium text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </span>
                </label>

                {location.state?.successMessage && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                    {location.state.successMessage}
                  </div>
                )}

                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-950/20 transition hover:from-blue-800 hover:to-cyan-700 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Sign in
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
};

export default Landing;
