import { useEffect, useState } from "react";
import { ArrowRight, Loader2, LockKeyhole, ShieldCheck, Warehouse } from "lucide-react";
import { useNavigate } from "react-router-dom";
import portImage from "@/assets/fumba-port.jpg";
import {
  extractRoleFromToken,
  getPortalDefaultPath,
  getStoredAuthRole
} from "@/lib/portal-access";
import { login as signIn } from "@/services/api";

const portals = [
  {
    title: "System Administrator Portal",
    description: "Configure users, roles, warehouse storage structure, system monitoring, and audit oversight.",
    icon: ShieldCheck,
    accent: "border-blue-500 text-blue-700 bg-blue-50"
  },
  {
    title: "Warehouse Staff Portal",
    description: "Receive cargo, register items, scan storage locations, track cargo, and prepare dispatch.",
    icon: Warehouse,
    accent: "border-sky-500 text-sky-700 bg-sky-50"
  }
];

const Landing = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const role = getStoredAuthRole();
    if (role) {
      navigate(getPortalDefaultPath(role), { replace: true });
    }
  }, [navigate]);

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

      navigate(getPortalDefaultPath(role), { replace: true });
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

          <div className="mt-9 grid w-full max-w-[430px] gap-3">
            <form
              onSubmit={handleSubmit}
              className="rounded-md border border-white/20 bg-white/95 p-4 text-slate-950 shadow-lg shadow-black/15 backdrop-blur"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-blue-500 bg-blue-50 text-blue-700">
                  <LockKeyhole className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold leading-snug">Sign in</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-600">Access follows the role assigned to your account.</p>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
                  Username
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
                  Password
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete="current-password"
                    className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              </div>

              {error && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 text-xs font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Sign in
              </button>
            </form>

            <div className="grid gap-2">
              {portals.map((portal) => {
                const Icon = portal.icon;
                return (
                  <div
                    key={portal.title}
                    className="rounded-md border border-white/20 bg-white/90 px-4 py-3 text-slate-950 shadow-md shadow-black/10 backdrop-blur"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border ${portal.accent}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold leading-snug">{portal.title}</h2>
                        <p className="mt-1 text-xs leading-5 text-slate-600">{portal.description}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export default Landing;
