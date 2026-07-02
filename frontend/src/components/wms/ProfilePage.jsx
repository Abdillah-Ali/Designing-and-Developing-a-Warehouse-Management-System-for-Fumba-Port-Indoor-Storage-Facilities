import { useEffect, useState } from "react";
import { KeyRound, Loader2, Mail, Phone, Save, UserCircle2, Warehouse } from "lucide-react";
import { ChangePasswordDialog } from "@/components/wms/ChangePasswordDialog";
import {
  ErrorState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge
} from "@/components/wms/OperationalUi";
import { getDisplayRoleName } from "@/lib/portal-access";
import { formatDateTime, getErrorMessage, statusTone } from "@/lib/wms-operational";
import { getProfile, updateProfile } from "@/services/api";

const inputClass =
  "h-9 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9][0-9\s()-]{6,18}[0-9]$/;

function normalizeProfile(response) {
  return response?.data?.user || response?.data || null;
}

function displayValue(value, fallback = "Not assigned") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function statusLabel(status) {
  if (!status) return "Unknown";
  return String(status).charAt(0).toUpperCase() + String(status).slice(1);
}

function ReadonlyValue({ label, value }) {
  return (
    <div className="rounded border border-border bg-muted/20 p-3">
      <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-xs font-semibold">{value}</div>
    </div>
  );
}

function AccountProfilePage({ title = "My Profile", description = "Your account details and warehouse assignment." }) {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ email: "", phone_number: "" });
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [state, setState] = useState({ loading: true, saving: false, error: "", success: "" });

  useEffect(() => {
    let active = true;

    getProfile()
      .then((response) => {
        if (!active) return;
        const user = normalizeProfile(response);
        setProfile(user);
        setForm({
          email: user?.email || "",
          phone_number: user?.phone_number || ""
        });
        setState({ loading: false, saving: false, error: "", success: "" });
      })
      .catch((error) => {
        if (active) {
          setState({ loading: false, saving: false, error: getErrorMessage(error), success: "" });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!emailPattern.test(form.email)) {
      setState((current) => ({ ...current, error: "Enter a valid email address.", success: "" }));
      return;
    }

    if (!phonePattern.test(form.phone_number)) {
      setState((current) => ({ ...current, error: "Enter a valid phone number using digits and an optional leading +.", success: "" }));
      return;
    }

    setState((current) => ({ ...current, saving: true, error: "", success: "" }));

    try {
      const response = await updateProfile({
        email: form.email,
        phone_number: form.phone_number
      });
      const user = normalizeProfile(response);
      setProfile(user);
      setForm({
        email: user?.email || "",
        phone_number: user?.phone_number || ""
      });
      setState({ loading: false, saving: false, error: "", success: "Profile updated successfully." });
    } catch (error) {
      setState((current) => ({ ...current, saving: false, error: getErrorMessage(error), success: "" }));
    }
  };

  const resetForm = () => {
    setForm({
      email: profile?.email || "",
      phone_number: profile?.phone_number || ""
    });
    setState((current) => ({ ...current, error: "", success: "" }));
  };

  return (
    <>
      <PageHeader
        eyebrow="Profile"
        title={title}
        description={description}
        action={(
          <button
            type="button"
            onClick={() => setPasswordOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded bg-info px-3 text-xs font-semibold text-info-foreground"
          >
            <KeyRound className="h-4 w-4" />
            Change Password
          </button>
        )}
      />
      <ChangePasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
      />
      <div className="flex-1 overflow-auto p-4">
        {state.loading ? (
          <LoadingState label="Loading profile..." />
        ) : state.error && !profile ? (
          <ErrorState message={state.error} />
        ) : (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <SectionCard title="Account Details" icon={UserCircle2}>
              <div className="grid gap-3 text-xs md:grid-cols-2 xl:grid-cols-3">
                <ReadonlyValue label="Full Name" value={displayValue(profile?.full_name, "Not recorded")} />
                <ReadonlyValue label="Username" value={displayValue(profile?.username, "Not recorded")} />
                <ReadonlyValue label="Email" value={displayValue(profile?.email, "Not recorded")} />
                <ReadonlyValue label="Phone Number" value={displayValue(profile?.phone_number, "Not recorded")} />
                <ReadonlyValue label="Role" value={getDisplayRoleName(profile?.role_name) || displayValue(profile?.role_name, "Not recorded")} />
                <ReadonlyValue label="Account Status" value={<StatusBadge tone={statusTone(profile?.status)}>{statusLabel(profile?.status)}</StatusBadge>} />
                <ReadonlyValue label="Assigned Warehouse" value={displayValue(profile?.warehouse_name)} />
                <ReadonlyValue label="Assigned Shift" value={displayValue(profile?.shift_name)} />
                <ReadonlyValue label="Last Login" value={formatDateTime(profile?.last_login)} />
                <ReadonlyValue label="Created Date" value={formatDateTime(profile?.created_at)} />
              </div>
            </SectionCard>

            <div className="space-y-3">
              <SectionCard title="Update Contact Details" icon={Mail}>
                <form className="space-y-3" onSubmit={handleSubmit}>
                  <label className="grid gap-1.5 text-xs font-semibold">
                    Email
                    <input
                      type="email"
                      className={inputClass}
                      value={form.email}
                      onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold">
                    Phone Number
                    <input
                      className={inputClass}
                      value={form.phone_number}
                      onChange={(event) => setForm((current) => ({ ...current, phone_number: event.target.value }))}
                      required
                    />
                  </label>

                  {state.error && <ErrorState message={state.error} />}
                  {state.success && (
                    <div className="rounded border border-success/35 bg-success/10 px-3 py-2 text-xs font-semibold text-success">
                      {state.success}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={state.saving}
                      className="inline-flex h-9 items-center gap-2 rounded bg-info px-3 text-xs font-semibold text-info-foreground disabled:opacity-60"
                    >
                      {state.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {state.saving ? "Saving..." : "Save Changes"}
                    </button>
                    <button
                      type="button"
                      onClick={resetForm}
                      disabled={state.saving}
                      className="h-9 rounded border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-60"
                    >
                      Reset
                    </button>
                  </div>
                </form>
              </SectionCard>

              <SectionCard title="Read-only Assignment" icon={Warehouse}>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <div className="rounded border border-border bg-muted/20 px-3 py-2">
                    Role, warehouse, shift, and status are managed by an authorized administrator.
                  </div>
                  <div className="flex items-center gap-2 rounded border border-border bg-muted/20 px-3 py-2">
                    <Phone className="h-3.5 w-3.5 text-info" />
                    Phone and email changes are validated and audited.
                  </div>
                </div>
              </SectionCard>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export { AccountProfilePage };
