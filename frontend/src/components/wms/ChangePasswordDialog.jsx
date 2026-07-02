import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { EnterpriseModal } from "@/components/wms/EnterpriseModal";
import { ErrorState } from "@/components/wms/OperationalUi";
import { getErrorMessage } from "@/lib/wms-operational";
import { changePassword } from "@/services/api";

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const inputClass =
  "h-10 w-full rounded border border-input bg-background px-3 pr-10 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

function PasswordInput({ label, value, onChange, autoComplete, visible, onToggle, helper }) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold">
      {label}
      <div className="relative">
        <input
          className={inputClass}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {helper && <span className="font-normal text-muted-foreground">{helper}</span>}
    </label>
  );
}

function ChangePasswordDialog({ open, onClose }) {
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [visible, setVisible] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false
  });
  const [state, setState] = useState({ saving: false, error: "", success: "" });

  useEffect(() => {
    if (!open) {
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setVisible({ currentPassword: false, newPassword: false, confirmPassword: false });
      setState({ saving: false, error: "", success: "" });
    }
  }, [open]);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setState((current) => ({ ...current, error: "", success: "" }));
  };

  const toggleVisible = (field) => {
    setVisible((current) => ({ ...current, [field]: !current[field] }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!passwordPattern.test(form.newPassword)) {
      setState({ saving: false, error: "Use at least 8 characters with uppercase, lowercase, number, and special character.", success: "" });
      return;
    }

    if (form.newPassword !== form.confirmPassword) {
      setState({ saving: false, error: "New password confirmation does not match.", success: "" });
      return;
    }

    setState({ saving: true, error: "", success: "" });

    try {
      await changePassword(form);
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setVisible({ currentPassword: false, newPassword: false, confirmPassword: false });
      setState({ saving: false, error: "", success: "Password changed successfully." });
    } catch (error) {
      setState({ saving: false, error: getErrorMessage(error), success: "" });
    }
  };

  return (
    <EnterpriseModal
      open={open}
      title="Change Password"
      subtitle="Enter your current password and choose a new secure password."
      onClose={state.saving ? undefined : onClose}
      size="compact"
      zIndex={70}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <PasswordInput
          label="Current password"
          value={form.currentPassword}
          onChange={(value) => updateField("currentPassword", value)}
          autoComplete="current-password"
          visible={visible.currentPassword}
          onToggle={() => toggleVisible("currentPassword")}
        />
        <PasswordInput
          label="New password"
          value={form.newPassword}
          onChange={(value) => updateField("newPassword", value)}
          autoComplete="new-password"
          visible={visible.newPassword}
          onToggle={() => toggleVisible("newPassword")}
          helper="Minimum 8 characters, including uppercase, lowercase, number, and special character."
        />
        <PasswordInput
          label="Confirm new password"
          value={form.confirmPassword}
          onChange={(value) => updateField("confirmPassword", value)}
          autoComplete="new-password"
          visible={visible.confirmPassword}
          onToggle={() => toggleVisible("confirmPassword")}
        />

        {state.error && <ErrorState message={state.error} />}
        {state.success && (
          <div className="rounded border border-success/35 bg-success/10 px-3 py-2 text-xs font-semibold text-success">
            {state.success}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={state.saving}
            className="h-9 rounded border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-60"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={state.saving}
            className="inline-flex h-9 items-center gap-2 rounded bg-info px-3 text-xs font-semibold text-info-foreground disabled:opacity-60"
          >
            {state.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {state.saving ? "Updating..." : "Change Password"}
          </button>
        </div>
      </form>
    </EnterpriseModal>
  );
}

export { ChangePasswordDialog, PasswordInput };
