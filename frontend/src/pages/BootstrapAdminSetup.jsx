import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createFirstSystemAdmin, getBootstrapOptions } from "@/services/api";

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const emptyForm = {
  full_name: "",
  username: "",
  email: "",
  phone_number: "+255",
  password: "",
  confirm_password: ""
};
const inputClass = "h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100";

function BootstrapAdminSetup() {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    getBootstrapOptions()
      .then(() => setAvailable(true))
      .catch(() => navigate("/", { replace: true }))
      .finally(() => setChecking(false));
  }, [navigate]);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!passwordPattern.test(form.password)) {
      setError("Use at least 8 characters with uppercase, lowercase, number, and special character.");
      return;
    }
    if (form.password !== form.confirm_password) {
      setError("Password confirmation does not match.");
      return;
    }
    setSaving(true);
    try {
      await createFirstSystemAdmin(form);
      navigate("/", {
        replace: true,
        state: { successMessage: "System Administrator created. Initial setup is permanently disabled." }
      });
    } catch (requestError) {
      setError(requestError.message || "Initial setup could not be completed.");
    } finally {
      setSaving(false);
    }
  };

  if (checking || !available) {
    return <main className="flex min-h-dvh items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-blue-700" /></main>;
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10 text-slate-950">
      <section className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <header className="flex items-start gap-4 border-b border-slate-200 pb-5">
          <div className="rounded-lg bg-blue-50 p-3 text-blue-700"><ShieldCheck className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-700">One-time setup</p>
            <h1 className="mt-1 text-2xl font-bold">Create the first System Administrator</h1>
            <p className="mt-2 text-sm text-slate-600">No temporary account is used. After this account is created, this setup page is permanently disabled.</p>
          </div>
        </header>

        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm font-semibold">Full name
            <input className={inputClass} value={form.full_name} onChange={(event) => update("full_name", event.target.value)} required />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">Username
            <input className={inputClass} value={form.username} onChange={(event) => update("username", event.target.value.toLowerCase())} autoComplete="username" required />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">Email
            <input className={inputClass} type="email" value={form.email} onChange={(event) => update("email", event.target.value)} required />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">Phone number
            <input className={inputClass} value={form.phone_number} onChange={(event) => update("phone_number", event.target.value)} required />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">Password
            <span className="relative">
              <input className={`${inputClass} pr-11`} type={showPassword ? "text" : "password"} value={form.password} onChange={(event) => update("password", event.target.value)} autoComplete="new-password" required />
              <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 w-11 text-slate-500" aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff className="mx-auto h-4 w-4" /> : <Eye className="mx-auto h-4 w-4" />}
              </button>
            </span>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">Confirm password
            <input className={inputClass} type="password" value={form.confirm_password} onChange={(event) => update("confirm_password", event.target.value)} autoComplete="new-password" required />
          </label>

          {error && <div className="sm:col-span-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <button type="submit" disabled={saving} className="sm:col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create System Administrator
          </button>
        </form>
      </section>
    </main>
  );
}

export default BootstrapAdminSetup;
