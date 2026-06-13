import { useEffect, useState } from "react";
import {
  Building2,
  Check,
  Clock3,
  Eye,
  EyeOff,
  Info,
  Loader2,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  UserPlus,
  UserRound
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { clearStoredAuthToken } from "@/lib/portal-access";
import {
  createFirstSystemAdmin,
  getBootstrapOptions,
  logout
} from "@/services/api";

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const phonePattern = /^\+?[0-9][0-9\s()-]{6,18}[0-9]$/;

const emptyForm = {
  full_name: "",
  username: "",
  email: "",
  phone_number: "+255",
  password: "",
  confirm_password: "",
  shift_id: ""
};

const inputClass = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100";

const formatTime = (value) => {
  if (!value) return "";
  const [hours, minutes] = String(value).split(":");
  return `${hours}:${minutes}`;
};

function Field({ label, help, children }) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
      {label}
      {children}
      {help && <span className="text-[11px] font-normal leading-4 text-slate-500">{help}</span>}
    </label>
  );
}

function SectionTitle({ icon: Icon, title, description }) {
  return (
    <div>
      <div className="flex items-center gap-3 text-blue-900">
        <Icon className="h-4 w-4 text-blue-600" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="mt-2 h-0.5 w-12 bg-blue-600" />
      <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function BootstrapAdminSetup() {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  useEffect(() => {
    let active = true;

    getBootstrapOptions()
      .then((response) => {
        if (!active) return;
        const nextShifts = response.data?.shifts || [];
        setShifts(nextShifts);
        setForm((current) => ({
          ...current,
          shift_id: current.shift_id || String(nextShifts[0]?.id || "")
        }));
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Setup options could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updatePhone = (value) => {
    const localNumber = value.replace(/\D/g, "").slice(0, 9);
    updateField("phone_number", `+255${localNumber}`);
  };

  const validateForm = () => {
    if (!form.full_name.trim()) return "Full name is required.";
    if (!form.username.trim()) return "Username is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Enter a valid email address.";
    if (!phonePattern.test(form.phone_number.trim())) return "Enter a valid phone number.";
    if (!passwordPattern.test(form.password)) {
      return "Use at least 8 characters with uppercase, lowercase, number, and special character.";
    }
    if (form.password !== form.confirm_password) return "Password confirmation does not match.";
    if (!form.shift_id) return "Shift is required.";
    return "";
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationError = validateForm();
    setError(validationError);
    if (validationError) return;

    setSaving(true);
    try {
      await createFirstSystemAdmin({
        ...form,
        full_name: form.full_name.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        phone_number: form.phone_number.trim()
      });
      clearStoredAuthToken();
      navigate("/", {
        replace: true,
        state: {
          successMessage: "First System Admin created successfully. Please log in using the new administrator account."
        }
      });
    } catch (requestError) {
      setError(requestError.message || "The first System Administrator could not be created.");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  const localPhoneNumber = form.phone_number.replace(/^\+255/, "");

  return (
    <main className="min-h-dvh bg-slate-50 px-3 py-3 text-slate-950 sm:px-5">
      <section className="mx-auto w-full max-w-5xl rounded-lg border border-slate-200 bg-white px-5 py-5 shadow-[0_8px_30px_rgba(15,23,42,0.08)] sm:px-6">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">Initial System Setup</p>
              <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
                Create the First System Administrator
              </h1>
              <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-600 sm:text-sm">
                This bootstrap account is temporary and can be deactivated after setup.
                <br className="hidden sm:block" />
                Create the first System Administrator who will have full access to manage the WMS.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={saving}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 self-start rounded-md border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </header>

        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50/80 px-4 py-3 text-blue-900">
          <div className="flex items-center gap-3 font-semibold">
            <Info className="h-5 w-5 fill-blue-600 text-white" />
            Important
          </div>
          <p className="mt-1.5 text-xs leading-5">You are using a temporary bootstrap account.</p>
          <p className="text-xs leading-5">
            For security, create the first System Administrator account below. You will be signed out immediately after.
          </p>
        </div>

        {loading ? (
          <div className="mt-4 flex min-h-64 items-center justify-center gap-2 rounded-md border border-slate-200 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading setup options...
          </div>
        ) : (
          <form className="mt-4" onSubmit={handleSubmit}>
            <div className="overflow-hidden rounded-md border border-slate-200">
              <div className="grid lg:grid-cols-2">
                <section className="space-y-4 p-4 sm:p-5 lg:border-r lg:border-slate-200">
                  <SectionTitle
                    icon={UserRound}
                    title="Administrator Information"
                    description="Provide the details for the primary system administrator."
                  />

                  <Field label="Full Name">
                    <input
                      className={inputClass}
                      value={form.full_name}
                      onChange={(event) => updateField("full_name", event.target.value)}
                      placeholder="e.g. Abdillah Juma Mwinyi"
                      required
                    />
                  </Field>

                  <Field label="Username" help="Use lowercase letters, numbers, dots, underscores, or hyphens.">
                    <input
                      className={inputClass}
                      value={form.username}
                      onChange={(event) => updateField("username", event.target.value.toLowerCase())}
                      placeholder="e.g. admin"
                      autoComplete="username"
                      required
                    />
                  </Field>

                  <Field label="Email Address">
                    <input
                      className={inputClass}
                      type="email"
                      value={form.email}
                      onChange={(event) => updateField("email", event.target.value)}
                      placeholder="e.g. admin@fumbaport.tz"
                      required
                    />
                  </Field>

                  <Field label="Phone Number" help="Include country code. Example: +255 712 345 678">
                    <div className="flex">
                      <div className="flex h-9 items-center gap-2 rounded-l-md border border-r-0 border-slate-300 bg-slate-50 px-3 text-xs font-medium text-slate-700">
                        <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">TZ</span>
                        +255
                      </div>
                      <input
                        className={`${inputClass} rounded-l-none`}
                        value={localPhoneNumber}
                        onChange={(event) => updatePhone(event.target.value)}
                        inputMode="numeric"
                        placeholder="e.g. 712 345 678"
                        required
                      />
                    </div>
                  </Field>

                  <Field
                    label="Password"
                    help="Minimum 8 characters with uppercase, lowercase, number, and special character."
                  >
                    <div className="relative">
                      <input
                        className={`${inputClass} pr-11`}
                        type={showPassword ? "text" : "password"}
                        value={form.password}
                        onChange={(event) => updateField("password", event.target.value)}
                        placeholder="Enter a strong password"
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 hover:text-blue-700"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>

                  <Field label="Confirm Password">
                    <div className="relative">
                      <input
                        className={`${inputClass} pr-11`}
                        type={showConfirmation ? "text" : "password"}
                        value={form.confirm_password}
                        onChange={(event) => updateField("confirm_password", event.target.value)}
                        placeholder="Confirm the password"
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmation((current) => !current)}
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 hover:text-blue-700"
                        aria-label={showConfirmation ? "Hide password confirmation" : "Show password confirmation"}
                      >
                        {showConfirmation ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>
                </section>

                <section className="space-y-5 border-t border-slate-200 p-4 sm:p-5 lg:border-t-0">
                  <SectionTitle
                    icon={LockKeyhole}
                    title="Access & Assignment"
                    description="Define where and when the administrator will operate."
                  />

                  <Field label="Role" help="Role is fixed and cannot be changed.">
                    <div className="flex h-9 items-center gap-3 rounded-md border border-slate-300 bg-slate-50 px-3 text-xs text-slate-500">
                      <LockKeyhole className="h-4 w-4" />
                      System Administrator (Full Access)
                    </div>
                  </Field>

                  <Field label="Assigned Warehouse" help="This administrator has global access to every active warehouse.">
                    <div className="flex h-9 items-center gap-3 rounded-md border border-blue-200 bg-blue-50/70 px-3 text-xs font-medium text-blue-900">
                      <Building2 className="h-4 w-4 text-blue-600" />
                      All Warehouses
                    </div>
                  </Field>

                  <Field label="Assigned Shift" help="Select the default shift for this administrator.">
                    <div className="relative">
                      <Clock3 className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-blue-600" />
                      <select
                        className={`${inputClass} appearance-none pl-10`}
                        value={form.shift_id}
                        onChange={(event) => updateField("shift_id", event.target.value)}
                        required
                      >
                        <option value="">Select shift</option>
                        {shifts.map((shift) => {
                          const hours = shift.start_time && shift.end_time
                            ? ` (${formatTime(shift.start_time)} - ${formatTime(shift.end_time)})`
                            : "";
                          return (
                            <option key={shift.id} value={String(shift.id)}>
                              {shift.shift_name}{hours}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </Field>

                  <div className="rounded-md border border-emerald-300 bg-emerald-50/70 p-4 text-emerald-950">
                    <div className="flex items-center gap-3 font-semibold">
                      <ShieldCheck className="h-5 w-5 text-emerald-600" />
                      After You Create This Account
                    </div>
                    <div className="mt-3 space-y-2 text-xs">
                      {[
                        "You will be signed out automatically",
                        "The bootstrap account can then be deactivated",
                        "You can sign in using the new administrator account",
                        "You can manage all warehouses, users, and settings"
                      ].map((item) => (
                        <div key={item} className="flex items-start gap-3">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700">
                {error}
              </div>
            )}

            <div className="mt-4 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 text-xs font-medium text-slate-600">
                <LockKeyhole className="h-4 w-4 text-slate-400" />
                Your security is our priority. All actions are logged and monitored.
              </div>
              <button
                type="submit"
                disabled={saving || shifts.length === 0}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-700 px-5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-5 w-5" />}
                {saving ? "Creating administrator..." : "Create First System Administrator"}
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

export default BootstrapAdminSetup;
