import { useEffect, useState } from "react";
import { Loader2, ScanLine } from "lucide-react";
import { getPlacementSettings, updatePlacementSettings } from "@/services/api";
import { getErrorMessage } from "@/lib/wms-operational";
import { ErrorState, SectionCard, StatusBadge } from "./OperationalUi";

function ManualPlacementSetting() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getPlacementSettings()
      .then((response) => setEnabled(Boolean(response.data?.manual_placement_enabled)))
      .catch((loadError) => setError(getErrorMessage(loadError)))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await updatePlacementSettings(!enabled);
      setEnabled(Boolean(response.data?.manual_placement_enabled));
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Manual Placement Fallback" icon={ScanLine}>
      {error && <ErrorState message={error} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold">
            Status
            <StatusBadge tone={enabled ? "success" : "muted"}>
              {loading ? "Loading" : enabled ? "Enabled" : "Disabled"}
            </StatusBadge>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Staff may select Zone, Rack, Level, and Bin only after recording an approved fallback reason.
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={loading || saving}
          className="inline-flex items-center gap-2 rounded bg-info px-3 py-2 text-xs font-semibold text-info-foreground disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {enabled ? "Disable Manual Placement" : "Enable Manual Placement"}
        </button>
      </div>
    </SectionCard>
  );
}

export { ManualPlacementSetting };
