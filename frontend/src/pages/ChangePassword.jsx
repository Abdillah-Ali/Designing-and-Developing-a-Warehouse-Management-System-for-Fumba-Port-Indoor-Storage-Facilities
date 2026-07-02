import { useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  clearStoredAuthToken,
  getPortalDefaultPath,
  getStoredAuthRole,
  mustChangeStoredPassword
} from "@/lib/portal-access";
import { changePassword, logout } from "@/services/api";

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

function PasswordField({ label, value, onChange, autoComplete, visible, onToggle, helper }) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
      {label}
      <div className="relative">
        <input
          className="h-10 w-full rounded-md border border-slate-300 px-3 pr-10 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {helper && <span className="font-normal text-slate-500">{helper}</span>}
    </label>
  );
}

function ChangePassword() {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [visible, setVisible] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const forcedChange = mustChangeStoredPassword();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!passwordPattern.test(newPassword)) {
      setError("Use at least 8 characters with uppercase, lowercase, number, and special character.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New password confirmation does not match.");
      return;
    }

    setSaving(true);
    try {
      await changePassword({ currentPassword, newPassword, confirmPassword });
      const role = getStoredAuthRole();
      navigate(getPortalDefaultPath(role), { replace: true });
    } catch (err) {
      setError(err.message || "Password could not be changed.");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    clearStoredAuthToken();
    navigate("/", { replace: true });
  };

  const toggleVisible = (field) => {
    setVisible((current) => ({ ...current, [field]: !current[field] }));
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 py-8">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-slate-950 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Account Security</div>
            <h1 className="mt-1 text-xl font-semibold">{forcedChange ? "Change your temporary password" : "Change your password"}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {forcedChange
                ? "Your administrator-created password must be replaced before portal access is enabled."
                : "Enter your current password and choose a new secure password."}
            </p>
          </div>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <PasswordField
            label="Current password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            visible={visible.currentPassword}
            onToggle={() => toggleVisible("currentPassword")}
          />
          <PasswordField
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            visible={visible.newPassword}
            onToggle={() => toggleVisible("newPassword")}
            helper="Minimum 8 characters, including uppercase, lowercase, number, and special character."
          />
          <PasswordField
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            visible={visible.confirmPassword}
            onToggle={() => toggleVisible("confirmPassword")}
          />

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          <button
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            type="submit"
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {saving ? "Updating password..." : "Change Password"}
          </button>
          <button
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            type="button"
            onClick={handleSignOut}
            disabled={saving}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}

export default ChangePassword;
