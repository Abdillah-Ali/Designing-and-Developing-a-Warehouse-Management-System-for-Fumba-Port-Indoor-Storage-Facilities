import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  FileWarning,
  History,
  ListChecks,
  MapPin,
  PackageCheck,
  Printer,
  Save,
  ScanLine,
  Search,
  Settings2,
  Truck,
  Upload,
  Warehouse,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  confirmPlacement as confirmPlacementRequest,
  createCargo,
  getBins,
  getCargo,
  getCargoById,
  getLevels,
  getPlacementLogs,
  getRacks,
  getZones,
  validatePlacement
} from "@/services/api";
import { CollapsibleCard } from "./CollapsibleCard";

const tabs = [
  { label: "Cargo Registration", icon: ClipboardList },
  { label: "Placement & Scanning", icon: ScanLine },
  { label: "Cargo Tracking", icon: MapPin },
  { label: "System & Validation Logs", icon: Settings2 }
];

const sourceOptions = [
  "Container",
  "Truck",
  "Ship",
  "Internal Transfer",
  "Other Warehouse"
];

const cargoTypes = [
  "General Goods",
  "Electronics",
  "Machinery",
  "Food Products",
  "Construction Materials",
  "Fragile Goods",
  "Hazardous Cargo",
  "Mixed Cargo"
];

const hazardClasses = [
  "Flammable",
  "Corrosive",
  "Toxic",
  "Explosive",
  "Radioactive"
];

const packagingTypes = [
  "Boxes",
  "Pallets",
  "Crates",
  "Drums",
  "Containers",
  "Loose Cargo",
  "Bags"
];

const cargoConditions = [
  "Good",
  "Damaged",
  "Wet",
  "Broken Packaging",
  "Leaking",
  "Partially Missing"
];

const allowedFileTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg"
]);

const initialCargoForm = {
  consignee_name: "",
  company_name: "",
  contact_person: "",
  phone_number: "",
  email: "",
  source_of_cargo: sourceOptions[0],
  container_number: "",
  vehicle_number: "",
  cargo_description: "",
  cargo_type: cargoTypes[0],
  packaging_type: packagingTypes[0],
  quantity: "",
  weight: "",
  volume: "",
  cargo_condition: cargoConditions[0],
  hazard_class: "",
  inspection_notes: "",
  received_by: "Warehouse Staff",
  received_datetime: new Date().toISOString(),
  delivery_note_number: ""
};

const emptyTrackingFilters = {
  cargoId: "",
  barcode: "",
  consignee: "",
  cargoType: "All",
  status: "All"
};

function Select({ children, value, onChange, className, ...props }) {
  return (
    <select
      {...props}
      {...(value !== undefined ? { value } : {})}
      onChange={(event) => onChange?.(event.target.value)}
      className={cn(
        "h-9 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring",
        className
      )}
    >
      {children}
    </select>
  );
}

const Input = forwardRef(function Input({ className, readOnly, ...props }, ref) {
  return (
    <input
      {...props}
      ref={ref}
      readOnly={readOnly}
      className={cn(
        "h-9 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring",
        readOnly && "cursor-default border-border bg-muted/60 text-foreground/80 focus:ring-0",
        className
      )}
    />
  );
});

function Textarea({ className, ...props }) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-20 w-full resize-none rounded border border-input bg-background px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring",
        className
      )}
    />
  );
}

function Field({ label, children, className }) {
  return (
    <label className={cn("space-y-1.5", className)}>
      <span className="block text-[11px] font-semibold text-foreground/80">{label}</span>
      {children}
    </label>
  );
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="h-4 w-4 text-info" />
      {children}
    </span>
  );
}

function StatusBadge({ children, tone = "info" }) {
  const tones = {
    success: "border-success/40 bg-success/15 text-success",
    registered: "border-orange-500/45 bg-orange-50 text-orange-700",
    pending: "border-yellow-500/45 bg-yellow-50 text-yellow-700",
    released: "border-info/40 bg-info/15 text-info",
    warning: "border-warning/40 bg-warning/20 text-warning",
    info: "border-info/40 bg-info/15 text-info",
    destructive: "border-destructive/40 bg-destructive/10 text-destructive",
    muted: "border-border bg-muted text-muted-foreground"
  };

  return (
    <span className={cn("inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold", tones[tone])}>
      {children}
    </span>
  );
}

function ReadonlyGrid({ items, columns = "md:grid-cols-2 xl:grid-cols-4" }) {
  return (
    <div className={cn("grid gap-3", columns)}>
      {items.map((item) => (
        <Field key={item.label} label={item.label}>
          <Input value={item.value ?? ""} readOnly />
        </Field>
      ))}
    </div>
  );
}

function ScanInputPanel({
  title,
  helper,
  placeholder,
  value,
  onChange,
  inputRef,
  active,
  onFocus,
  children
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 transition-colors",
        active ? "border-info bg-info/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.18)]" : "border-border bg-muted/20"
      )}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ScanLine className="h-4 w-4 text-info" />
            {title}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{helper}</div>
        </div>
        <StatusBadge tone={active ? "info" : "muted"}>{active ? "Scan Ready" : "Standby"}</StatusBadge>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
          placeholder={placeholder}
          className={cn(
            "h-12 border-2 font-mono text-sm",
            active ? "border-info bg-white shadow-inner" : "border-input"
          )}
        />
        <button
          type="button"
          onClick={() => {
            inputRef.current?.focus();
            onFocus();
          }}
          className="inline-flex h-12 items-center justify-center gap-2 rounded bg-info px-4 text-xs font-semibold text-info-foreground transition hover:opacity-90"
        >
          <ScanLine className="h-4 w-4" />
          Focus Scan Field
        </button>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        {active && !value ? "Waiting for scanner input..." : "External scanner input appears here when this field is focused."}
      </div>
      {children}
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return "Not recorded";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";

  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function formatMeasure(value, unit) {
  if (value === undefined || value === null || value === "") return "Not recorded";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Not recorded";
  return `${number.toLocaleString()} ${unit}`;
}

function getErrorMessage(error) {
  if (error?.errors?.length) return error.errors.join(" ");
  return error?.message || "Something went wrong.";
}

function statusTone(status) {
  if (!status) return "muted";
  if (status === "Registered") return "registered";
  if (status === "Stored") return "success";
  if (status === "Blocked") return "destructive";
  if (status === "Released") return "released";
  if (status.includes("Pending")) return "pending";
  return "info";
}

function binStatusTone(status) {
  if (status === "Available") return "success";
  if (status === "Occupied") return "success";
  if (status === "Reserved") return "warning";
  if (status === "Blocked") return "destructive";
  return "info";
}

function cargoOperationalStatus(record) {
  if (!record) return "Pending Registration";
  if (record.status === "Registered" && !record.current_bin_id && !record.location) return "Pending Placement";
  return record.status || "Pending";
}

function getRecordId(record, fallbackKey) {
  return String(record?.id ?? record?.[fallbackKey] ?? "");
}

function readRecordValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function getZoneCode(record) {
  return readRecordValue(record, ["zone_code", "code"]);
}

function getZoneName(record) {
  return readRecordValue(record, ["zone_name", "name"]);
}

function getRackCode(record) {
  return readRecordValue(record, ["rack_code", "code"]);
}

function getLevelCode(record) {
  return readRecordValue(record, ["level_code", "code"]);
}

function getBinCode(record) {
  return readRecordValue(record, ["bin_code", "code"]);
}

function getBinBarcode(record) {
  return readRecordValue(record, ["bin_barcode", "barcode"]);
}

function getBinStatus(record) {
  return readRecordValue(record, ["bin_status", "status"]) || "Unknown";
}

function formatZoneLabel(record, fallback = "Awaiting selection") {
  const code = getZoneCode(record);
  const name = getZoneName(record);
  if (code && name) return `${code} - ${name}`;
  return code || name || fallback;
}

function formatLevelLabel(record, fallback = "Select level") {
  const code = getLevelCode(record);
  const levelNumber = readRecordValue(record, ["level_number"]);
  if (code && levelNumber) return `${code} (Level ${levelNumber})`;
  return code || fallback;
}

function getRemainingCapacity(bin, field) {
  if (!bin) return null;
  const max = Number(bin[`max_${field}`] ?? 0);
  const current = Number(bin[`current_${field}`] ?? 0);
  const remaining = Number(bin[`remaining_${field}`] ?? (max - current));
  return Number.isFinite(remaining) ? remaining : null;
}

function checkMessage(validation, keys, fallback) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  return keyList
    .map((key) => validation?.checks?.[key]?.message)
    .filter(Boolean)
    .join(" ") || fallback;
}

function checkPassed(validation, keys, fallback = false) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  if (!validation?.checks) return fallback;
  return keyList.every((key) => validation.checks[key]?.passed !== false);
}

function DetailForm({ initialTab = 0 }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [formData, setFormData] = useState(initialCargoForm);
  const [cargoRecords, setCargoRecords] = useState([]);
  const [savedCargo, setSavedCargo] = useState(null);
  const [cargoLoading, setCargoLoading] = useState(false);
  const [cargoError, setCargoError] = useState("");
  const [savingCargo, setSavingCargo] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState(false);
  const [zones, setZones] = useState([]);
  const [selectedZone, setSelectedZone] = useState("");
  const [racks, setRacks] = useState([]);
  const [selectedRack, setSelectedRack] = useState("");
  const [levels, setLevels] = useState([]);
  const [selectedLevel, setSelectedLevel] = useState("");
  const [bins, setBins] = useState([]);
  const [selectedBin, setSelectedBin] = useState("");
  const [zonesError, setZonesError] = useState("");
  const [hierarchyError, setHierarchyError] = useState("");
  const [hierarchyLoading, setHierarchyLoading] = useState({
    racks: false,
    levels: false,
    bins: false
  });
  const [placementLogs, setPlacementLogs] = useState([]);
  const [logsError, setLogsError] = useState("");
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [cargoBarcode, setCargoBarcode] = useState("");
  const [binBarcode, setBinBarcode] = useState("");
  const [focusedScan, setFocusedScan] = useState("cargo");
  const [placementValidation, setPlacementValidation] = useState(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [placementSaving, setPlacementSaving] = useState(false);
  const [placementError, setPlacementError] = useState("");
  const [placementConfirmed, setPlacementConfirmed] = useState(false);
  const [placementTime, setPlacementTime] = useState("");
  const [placementNotice, setPlacementNotice] = useState(false);
  const [trackingFilters, setTrackingFilters] = useState(emptyTrackingFilters);
  const [trackingCargoDetail, setTrackingCargoDetail] = useState(null);
  const [trackingDetailError, setTrackingDetailError] = useState("");
  const fileInput = useRef(null);
  const cargoScanRef = useRef(null);
  const binScanRef = useRef(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const currentStatus = savedCargo?.status || "Pending Registration";
  const receivedAt = formatDateTime(formData.received_datetime);

  const refreshCargoRecords = async () => {
    setCargoLoading(true);
    setCargoError("");

    try {
      const response = await getCargo();
      setCargoRecords(response.data || []);
    } catch (error) {
      setCargoError(getErrorMessage(error));
    } finally {
      setCargoLoading(false);
    }
  };

  const refreshZones = async () => {
    setZonesError("");

    try {
      const response = await getZones();
      setZones(response.data || []);
    } catch (error) {
      setZonesError(getErrorMessage(error));
    }
  };

  const refreshPlacementLogs = async () => {
    setLogsError("");

    try {
      const response = await getPlacementLogs();
      setPlacementLogs(response.data || []);
    } catch (error) {
      setLogsError(getErrorMessage(error));
    }
  };

  useEffect(() => {
    refreshCargoRecords();
    refreshZones();
    refreshPlacementLogs();
  }, []);

  useEffect(() => {
    if (!selectedZone && zones.length > 0) {
      setSelectedZone(getRecordId(zones[0], "zone_id"));
    }
  }, [selectedZone, zones]);

  useEffect(() => {
    if (!selectedZone) {
      setRacks([]);
      setSelectedRack("");
      setLevels([]);
      setSelectedLevel("");
      setBins([]);
      setSelectedBin("");
      return undefined;
    }

    let active = true;

    const loadRacks = async () => {
      setHierarchyLoading((current) => ({ ...current, racks: true }));
      setHierarchyError("");
      setRacks([]);
      setSelectedRack("");
      setLevels([]);
      setSelectedLevel("");
      setBins([]);
      setSelectedBin("");

      try {
        const response = await getRacks(selectedZone);
        if (!active) return;

        const nextRacks = response.data || [];
        setRacks(nextRacks);
        if (nextRacks.length > 0) {
          setSelectedRack(getRecordId(nextRacks[0], "rack_id"));
        }
      } catch (error) {
        if (active) setHierarchyError(getErrorMessage(error));
      } finally {
        if (active) setHierarchyLoading((current) => ({ ...current, racks: false }));
      }
    };

    loadRacks();

    return () => {
      active = false;
    };
  }, [selectedZone]);

  useEffect(() => {
    if (!selectedRack) {
      setLevels([]);
      setSelectedLevel("");
      setBins([]);
      setSelectedBin("");
      return undefined;
    }

    let active = true;

    const loadLevels = async () => {
      setHierarchyLoading((current) => ({ ...current, levels: true }));
      setHierarchyError("");
      setLevels([]);
      setSelectedLevel("");
      setBins([]);
      setSelectedBin("");

      try {
        const response = await getLevels(selectedRack);
        if (!active) return;

        const nextLevels = response.data || [];
        setLevels(nextLevels);
        if (nextLevels.length > 0) {
          setSelectedLevel(getRecordId(nextLevels[0], "level_id"));
        }
      } catch (error) {
        if (active) setHierarchyError(getErrorMessage(error));
      } finally {
        if (active) setHierarchyLoading((current) => ({ ...current, levels: false }));
      }
    };

    loadLevels();

    return () => {
      active = false;
    };
  }, [selectedRack]);

  useEffect(() => {
    if (!selectedLevel) {
      setBins([]);
      setSelectedBin("");
      return undefined;
    }

    let active = true;

    const loadBins = async () => {
      setHierarchyLoading((current) => ({ ...current, bins: true }));
      setHierarchyError("");
      setBins([]);
      setSelectedBin("");

      try {
        const response = await getBins(selectedLevel);
        if (!active) return;

        setBins(response.data || []);
      } catch (error) {
        if (active) setHierarchyError(getErrorMessage(error));
      } finally {
        if (active) setHierarchyLoading((current) => ({ ...current, bins: false }));
      }
    };

    loadBins();

    return () => {
      active = false;
    };
  }, [selectedLevel]);

  useEffect(() => {
    setPlacementConfirmed(false);
    setPlacementNotice(false);
    setPlacementError("");

    if (!cargoBarcode.trim() || !binBarcode.trim()) {
      setPlacementValidation(null);
      setValidationLoading(false);
      setValidationError("");
      return undefined;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setValidationLoading(true);
      setValidationError("");

      try {
        const response = await validatePlacement({
          cargo_barcode: cargoBarcode.trim(),
          bin_barcode: binBarcode.trim()
        });

        if (active) {
          setPlacementValidation(response.data);
          refreshPlacementLogs();
        }
      } catch (error) {
        if (active) {
          setPlacementValidation(null);
          setValidationError(getErrorMessage(error));
        }
      } finally {
        if (active) setValidationLoading(false);
      }
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [cargoBarcode, binBarcode]);

  const scannedCargo = useMemo(() => {
    if (placementValidation?.cargo) return placementValidation.cargo;

    const scan = cargoBarcode.trim().toUpperCase();
    if (!scan) return null;

    return cargoRecords.find((record) =>
      record.barcode?.toUpperCase() === scan || record.cargo_id?.toUpperCase() === scan
    ) || null;
  }, [cargoBarcode, cargoRecords, placementValidation]);

  const validation = useMemo(() => {
    if (validationLoading) {
      return {
        approved: false,
        reason: "Checking Placement",
        detail: "Placement rules are being checked.",
        checks: {}
      };
    }

    if (placementValidation) return placementValidation;

    if (!cargoBarcode.trim()) {
      return {
        approved: false,
        reason: "Awaiting Cargo Scan",
        detail: "Scan or enter a registered cargo barcode.",
        checks: {}
      };
    }

    if (!binBarcode.trim()) {
      return {
        approved: false,
        reason: "Awaiting Bin Scan",
        detail: "Scan a storage bin barcode to check placement rules.",
        checks: {}
      };
    }

    return {
      approved: false,
      reason: validationError ? "Validation Error" : "Validation Pending",
      detail: validationError || "Waiting for placement rules to finish.",
      checks: {}
    };
  }, [binBarcode, cargoBarcode, placementValidation, validationError, validationLoading]);

  const selectedZoneRecord = useMemo(
    () => zones.find((zone) => getRecordId(zone, "zone_id") === selectedZone) || null,
    [selectedZone, zones]
  );
  const selectedRackRecord = useMemo(
    () => racks.find((rack) => getRecordId(rack, "rack_id") === selectedRack) || null,
    [racks, selectedRack]
  );
  const selectedLevelRecord = useMemo(
    () => levels.find((level) => getRecordId(level, "level_id") === selectedLevel) || null,
    [levels, selectedLevel]
  );
  const selectedBinRecord = useMemo(
    () => bins.find((bin) => getRecordId(bin, "bin_id") === selectedBin) || null,
    [bins, selectedBin]
  );

  useEffect(() => {
    const bin = placementValidation?.bin;
    if (!bin?.zone_id) return;

    const nextZone = String(bin.zone_id);
    if (nextZone !== selectedZone) {
      setSelectedZone(nextZone);
    }
  }, [placementValidation, selectedZone]);

  useEffect(() => {
    const bin = placementValidation?.bin;
    if (!bin || racks.length === 0) return;

    const matchedRack = racks.find((rack) =>
      String(rack.id ?? rack.rack_id) === String(bin.rack_id) ||
      getRackCode(rack) === getRackCode(bin)
    );

    if (matchedRack) {
      const nextRack = getRecordId(matchedRack, "rack_id");
      if (nextRack !== selectedRack) setSelectedRack(nextRack);
    }
  }, [placementValidation, racks, selectedRack]);

  useEffect(() => {
    const bin = placementValidation?.bin;
    if (!bin || levels.length === 0) return;

    const matchedLevel = levels.find((level) =>
      String(level.id ?? level.level_id) === String(bin.level_id) ||
      getLevelCode(level) === getLevelCode(bin)
    );

    if (matchedLevel) {
      const nextLevel = getRecordId(matchedLevel, "level_id");
      if (nextLevel !== selectedLevel) setSelectedLevel(nextLevel);
    }
  }, [levels, placementValidation, selectedLevel]);

  useEffect(() => {
    const bin = placementValidation?.bin;
    if (!bin || bins.length === 0) return;

    const matchedBin = bins.find((item) =>
      String(item.id ?? item.bin_id) === String(bin.id ?? bin.bin_id) ||
      getBinBarcode(item) === getBinBarcode(bin)
    );

    if (matchedBin) {
      const nextBin = getRecordId(matchedBin, "bin_id");
      if (nextBin !== selectedBin) setSelectedBin(nextBin);
    }
  }, [bins, placementValidation, selectedBin]);

  useEffect(() => {
    const selectedBarcode = getBinBarcode(selectedBinRecord);
    if (!selectedBarcode) return;
    if (selectedBarcode !== binBarcode.trim().toUpperCase()) {
      setBinBarcode(selectedBarcode);
    }
  }, [binBarcode, selectedBinRecord]);

  const scannedBin = placementValidation?.bin || null;
  const activeBin = selectedBinRecord || scannedBin;
  const activeBinRemainingWeight = getRemainingCapacity(activeBin, "weight");
  const activeBinRemainingVolume = getRemainingCapacity(activeBin, "volume");
  const currentPlacementSession = cargoBarcode.trim() || binBarcode.trim()
    ? "Placement scan fields active"
    : "No active placement session";

  const filteredCargoRecords = useMemo(() => {
    return cargoRecords.filter((record) => {
      const cargoIdMatch = !trackingFilters.cargoId ||
        record.cargo_id?.toLowerCase().includes(trackingFilters.cargoId.toLowerCase());
      const barcodeMatch = !trackingFilters.barcode ||
        record.barcode?.toLowerCase().includes(trackingFilters.barcode.toLowerCase());
      const consigneeMatch = !trackingFilters.consignee ||
        record.consignee_name?.toLowerCase().includes(trackingFilters.consignee.toLowerCase());
      const typeMatch = trackingFilters.cargoType === "All" || record.cargo_type === trackingFilters.cargoType;
      const operationalStatus = cargoOperationalStatus(record);
      const statusMatch = trackingFilters.status === "All" || record.status === trackingFilters.status || operationalStatus === trackingFilters.status;

      return cargoIdMatch && barcodeMatch && consigneeMatch && typeMatch && statusMatch;
    });
  }, [cargoRecords, trackingFilters]);

  const selectedTrackingCargo = filteredCargoRecords[0] || savedCargo || null;
  const selectedTrackingCargoId = selectedTrackingCargo?.id || null;

  useEffect(() => {
    if (!selectedTrackingCargoId) {
      setTrackingCargoDetail(null);
      setTrackingDetailError("");
      return undefined;
    }

    let active = true;

    const loadCargoDetail = async () => {
      setTrackingDetailError("");

      try {
        const response = await getCargoById(selectedTrackingCargoId);
        if (active) setTrackingCargoDetail(response.data);
      } catch (error) {
        if (active) setTrackingDetailError(getErrorMessage(error));
      }
    };

    loadCargoDetail();

    return () => {
      active = false;
    };
  }, [selectedTrackingCargoId]);

  const trackingCargo = trackingCargoDetail || selectedTrackingCargo;
  const movementRows = trackingCargo?.movement_history || [];
  const failedValidationLogs = placementLogs.filter((log) => !log.approved);

  const statusCounts = useMemo(() => {
    return cargoRecords.reduce((counts, record) => {
      const operationalStatus = cargoOperationalStatus(record);
      counts[operationalStatus] = (counts[operationalStatus] || 0) + 1;
      return counts;
    }, {});
  }, [cargoRecords]);

  const validationCards = [
    {
      title: "Cargo Compatibility",
      passed: checkPassed(validation, "cargoCompatibility", validation.approved),
      body: checkMessage(validation, "cargoCompatibility", validation.detail)
    },
    {
      title: "Capacity Validation",
      passed: checkPassed(validation, ["weightCapacity", "volumeCapacity"], validation.approved),
      body: checkMessage(validation, ["weightCapacity", "volumeCapacity"], "Weight and volume capacity will be checked before placement.")
    },
    {
      title: "Bin Availability",
      passed: checkPassed(validation, ["blockedBin", "reservedBin"], validation.approved),
      body: checkMessage(validation, ["blockedBin", "reservedBin"], "Blocked and reserved bin rules will be checked before placement.")
    }
  ];

  const handleCargoFieldChange = (field, value) => {
    setFormData((current) => {
      const next = { ...current, [field]: value };
      if (field === "cargo_type" && value !== "Hazardous Cargo") {
        next.hazard_class = "";
      }
      return next;
    });
  };

  const handleTrackingFilterChange = (field, value) => {
    setTrackingFilters((current) => ({ ...current, [field]: value }));
  };

  const resetPlacementSelection = () => {
    setBinBarcode("");
    setSelectedBin("");
    setPlacementValidation(null);
    setValidationError("");
    setPlacementError("");
    setPlacementSaving(false);
    setPlacementConfirmed(false);
    setPlacementNotice(false);
    setPlacementTime("");
  };

  const handleZoneSelect = (value) => {
    setSelectedZone(value);
    resetPlacementSelection();
  };

  const handleRackSelect = (value) => {
    setSelectedRack(value);
    resetPlacementSelection();
  };

  const handleLevelSelect = (value) => {
    setSelectedLevel(value);
    resetPlacementSelection();
  };

  const handleBinSelect = (value) => {
    setSelectedBin(value);
    setPlacementValidation(null);
    setValidationError("");
    setPlacementError("");
    setPlacementSaving(false);
    setPlacementConfirmed(false);
    setPlacementNotice(false);
    setPlacementTime("");
  };

  const addFiles = (list) => {
    if (!list) return;

    const nextFiles = Array.from(list).filter((file) => {
      const lowerName = file.name.toLowerCase();
      return (
        allowedFileTypes.has(file.type) ||
        lowerName.endsWith(".pdf") ||
        lowerName.endsWith(".docx") ||
        lowerName.endsWith(".jpg") ||
        lowerName.endsWith(".jpeg")
      );
    });

    setFiles((current) => [...current, ...nextFiles]);
  };

  const saveCargo = async () => {
    setSavingCargo(true);
    setSaveError("");
    setSaveNotice(false);

    try {
      const response = await createCargo({
        ...formData,
        received_datetime: formData.received_datetime || new Date().toISOString()
      });
      const cargo = response.data;

      setSavedCargo(cargo);
      setCargoBarcode(cargo.barcode);
      setSaveNotice(true);
      await refreshCargoRecords();
      await refreshPlacementLogs();
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setSavingCargo(false);
    }
  };

  const handleConfirmPlacement = async () => {
    if (!cargoBarcode.trim() || !binBarcode.trim() || !validation.approved) return;

    setPlacementSaving(true);
    setPlacementError("");
    setPlacementNotice(false);

    try {
      const response = await confirmPlacementRequest({
        cargo_barcode: cargoBarcode.trim(),
        bin_barcode: binBarcode.trim(),
        assigned_by: formData.received_by || "Warehouse Staff"
      });
      const result = response.data || {};

      if (result.validation) setPlacementValidation(result.validation);
      if (result.cargo) setSavedCargo(result.cargo);
      if (result.bin) {
        setPlacementValidation((current) => ({
          ...(current || result.validation || {}),
          bin: result.bin
        }));
      }

      setPlacementConfirmed(true);
      setPlacementNotice(true);
      setPlacementTime(formatDateTime(result.movement?.created_at || result.cargo?.updated_at));
      await refreshCargoRecords();
      await refreshPlacementLogs();
    } catch (error) {
      setPlacementError(getErrorMessage(error));
    } finally {
      setPlacementSaving(false);
    }
  };

  const clearScanSession = () => {
    setCargoBarcode("");
    setBinBarcode("");
    setFocusedScan("cargo");
    setPlacementValidation(null);
    setValidationError("");
    setPlacementError("");
    setPlacementSaving(false);
    setSelectedBin("");
    setPlacementConfirmed(false);
    setPlacementNotice(false);
    setPlacementTime("");
    requestAnimationFrame(() => cargoScanRef.current?.focus());
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="grid gap-2 border-b border-border bg-muted/40 px-3 pt-2 xl:grid-cols-[1fr_auto]">
        <div className="grid min-w-0 grid-cols-1 gap-1 md:grid-cols-2 xl:grid-cols-4">
          {tabs.map((tab, index) => {
            const Icon = tab.icon;
            const active = activeTab === index;

            return (
              <button
                key={tab.label}
                type="button"
                onClick={() => setActiveTab(index)}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-t border border-b-0 px-3 py-2 text-xs font-semibold transition-colors",
                  active
                    ? "-mb-px border-border bg-card text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-card/70 hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-end justify-end pb-2">
          <StatusBadge tone={statusTone(currentStatus)}>{currentStatus}</StatusBadge>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === 0 && (
          <div className="space-y-3 p-4">
            {saveNotice && (
              <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs font-semibold text-success">
                <CheckCircle2 className="h-4 w-4" />
                Cargo saved. Reference {savedCargo?.cargo_id} is ready.
              </div>
            )}
            {saveError && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {saveError}
              </div>
            )}

            <CollapsibleCard title={<SectionTitle icon={ClipboardList}>Consignee / Owner Information</SectionTitle>} defaultOpen>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Consignee Name">
                  <Input value={formData.consignee_name} onChange={(event) => handleCargoFieldChange("consignee_name", event.target.value)} placeholder="Enter consignee name" />
                </Field>
                <Field label="Company Name">
                  <Input value={formData.company_name} onChange={(event) => handleCargoFieldChange("company_name", event.target.value)} placeholder="Enter company name" />
                </Field>
                <Field label="Contact Person">
                  <Input value={formData.contact_person} onChange={(event) => handleCargoFieldChange("contact_person", event.target.value)} placeholder="Enter contact person" />
                </Field>
                <Field label="Phone Number">
                  <Input value={formData.phone_number} onChange={(event) => handleCargoFieldChange("phone_number", event.target.value)} placeholder="+255 ..." />
                </Field>
                <Field label="Email Address" className="md:col-span-2">
                  <Input value={formData.email} onChange={(event) => handleCargoFieldChange("email", event.target.value)} type="email" placeholder="name@company.com" />
                </Field>
              </div>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={Truck}>Cargo Information</SectionTitle>} defaultOpen>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Source of Cargo">
                  <Select value={formData.source_of_cargo} onChange={(value) => handleCargoFieldChange("source_of_cargo", value)}>
                    {sourceOptions.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Container Number">
                  <Input value={formData.container_number} onChange={(event) => handleCargoFieldChange("container_number", event.target.value)} placeholder="e.g. MSCU1234567" />
                </Field>
                <Field label="Vehicle Number">
                  <Input value={formData.vehicle_number} onChange={(event) => handleCargoFieldChange("vehicle_number", event.target.value)} placeholder="e.g. T 123 ABC" />
                </Field>
                <Field label="Cargo Type">
                  <Select value={formData.cargo_type} onChange={(value) => handleCargoFieldChange("cargo_type", value)}>
                    {cargoTypes.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </Select>
                </Field>
                {formData.cargo_type === "Hazardous Cargo" && (
                  <Field label="Hazard Class">
                    <Select value={formData.hazard_class || hazardClasses[0]} onChange={(value) => handleCargoFieldChange("hazard_class", value)}>
                      {hazardClasses.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="Packaging Type">
                  <Select value={formData.packaging_type} onChange={(value) => handleCargoFieldChange("packaging_type", value)}>
                    {packagingTypes.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Quantity">
                  <Input value={formData.quantity} onChange={(event) => handleCargoFieldChange("quantity", event.target.value)} type="number" min="0" placeholder="0" />
                </Field>
                <Field label="Weight (kg)">
                  <Input value={formData.weight} onChange={(event) => handleCargoFieldChange("weight", event.target.value)} type="number" min="0" step="0.01" placeholder="0.00" />
                </Field>
                <Field label="Volume (m³)">
                  <Input value={formData.volume} onChange={(event) => handleCargoFieldChange("volume", event.target.value)} type="number" min="0" step="0.01" placeholder="0.00" />
                </Field>
                <Field label="Cargo Condition">
                  <Select value={formData.cargo_condition} onChange={(value) => handleCargoFieldChange("cargo_condition", value)}>
                    {cargoConditions.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Cargo Description" className="md:col-span-2 xl:col-span-3">
                  <Textarea value={formData.cargo_description} onChange={(event) => handleCargoFieldChange("cargo_description", event.target.value)} placeholder="Describe received cargo, markings, handling notes, or visible identifiers." />
                </Field>
              </div>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={PackageCheck}>Inspection & Receiving</SectionTitle>} defaultOpen>
              <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
                <Field label="Inspection Notes">
                  <Textarea value={formData.inspection_notes} onChange={(event) => handleCargoFieldChange("inspection_notes", event.target.value)} placeholder="Record inspection findings after unloading." />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <Field label="Received By">
                    <Input value={formData.received_by} onChange={(event) => handleCargoFieldChange("received_by", event.target.value)} />
                  </Field>
                  <Field label="Received Date & Time">
                    <Input value={receivedAt} readOnly />
                  </Field>
                  <Field label="Delivery Note Number">
                    <Input value={formData.delivery_note_number} onChange={(event) => handleCargoFieldChange("delivery_note_number", event.target.value)} placeholder="DN-2026-..." />
                  </Field>
                </div>
              </div>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={FileText}>Supporting Documents</SectionTitle>} defaultOpen>
              <div className="space-y-3">
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOver(false);
                    addFiles(event.dataTransfer.files);
                  }}
                  onClick={() => fileInput.current?.click()}
                  className={cn(
                    "cursor-pointer rounded-md border-2 border-dashed p-5 text-center transition-colors",
                    dragOver ? "border-info bg-info/5" : "border-border bg-muted/30 hover:bg-muted/50"
                  )}
                >
                  <Upload className="mx-auto h-6 w-6 text-info" />
                  <div className="mt-2 text-xs font-semibold">Drop files or click to upload</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">PDF, DOCX, JPG</div>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.jpg,.jpeg"
                    className="hidden"
                    onChange={(event) => addFiles(event.target.files)}
                  />
                </div>
                {files.length > 0 && (
                  <ul className="grid gap-2 md:grid-cols-2">
                    {files.map((file, index) => (
                      <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded border border-border bg-muted/20 px-3 py-2 text-xs">
                        <span className="truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${file.name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CollapsibleCard>

            <div className="rounded-md border border-info/30 bg-info/5 p-3">
              <div className="mb-2 text-xs font-semibold text-info">System-generated after save</div>
              <ReadonlyGrid
                columns="md:grid-cols-2 xl:grid-cols-5"
                items={[
                  { label: "Cargo ID", value: savedCargo?.cargo_id || "Pending save" },
                  { label: "Cargo Barcode", value: savedCargo?.barcode || "Generated on save" },
                  { label: "Reference Number", value: savedCargo?.reference_number || "Generated on save" },
                  { label: "Cargo Status", value: savedCargo?.status || "Pending Registration" },
                  { label: "Location", value: savedCargo ? savedCargo.location || "Not assigned" : "Not assigned" }
                ]}
              />
            </div>
          </div>
        )}

        {activeTab === 1 && (
          <div className="space-y-3 p-4">
            {placementNotice && (
              <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs font-semibold text-success">
                <CheckCircle2 className="h-4 w-4" />
                Placement confirmed. Cargo status and location are up to date.
              </div>
            )}
            {placementError && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {placementError}
              </div>
            )}

            <CollapsibleCard title={<SectionTitle icon={ScanLine}>Placement Scanning</SectionTitle>} defaultOpen>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="text-[11px] font-semibold text-muted-foreground">Last Scan Time</div>
                  <div className="mt-2 text-xs font-semibold">No scan received</div>
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-3 md:col-span-2">
                  <div className="text-[11px] font-semibold text-muted-foreground">Current Placement Work</div>
                  <div className="mt-2 text-xs font-semibold">{currentPlacementSession}</div>
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="text-[11px] font-semibold text-muted-foreground">Queued Scans</div>
                  <div className="mt-2 text-xs font-semibold">No scans queued</div>
                </div>
              </div>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={ScanLine}>Cargo Barcode Input</SectionTitle>} defaultOpen>
              <ScanInputPanel
                title="Cargo Scan Field"
                helper="Focused input for external hardware scanners."
                placeholder="Scan or enter cargo barcode"
                value={cargoBarcode}
                onChange={setCargoBarcode}
                inputRef={cargoScanRef}
                active={focusedScan === "cargo"}
                onFocus={() => setFocusedScan("cargo")}
              >
                <div className="mt-3 rounded-md border border-border bg-card p-3">
                  {cargoBarcode.trim() ? (
                    scannedCargo ? (
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <Field label="Cargo ID">
                          <Input value={scannedCargo.cargo_id || cargoBarcode.trim().toUpperCase()} readOnly />
                        </Field>
                        <Field label="Cargo Type">
                          <Input value={scannedCargo.cargo_type || "Not recorded"} readOnly />
                        </Field>
                        <Field label="Weight">
                          <Input value={formatMeasure(scannedCargo.weight, "kg")} readOnly />
                        </Field>
                        <Field label="Volume">
                          <Input value={formatMeasure(scannedCargo.volume, "m³")} readOnly />
                        </Field>
                        <Field label="Hazard Class">
                          <Input value={scannedCargo.hazard_class || "N/A"} readOnly />
                        </Field>
                        <div className="space-y-1.5">
                          <span className="block text-[11px] font-semibold text-foreground/80">Current Status</span>
                          <div className="flex flex-wrap gap-2 pt-1">
                            <StatusBadge tone={statusTone(cargoOperationalStatus(scannedCargo))}>{cargoOperationalStatus(scannedCargo)}</StatusBadge>
                            <StatusBadge tone={scannedCargo.location ? "success" : "warning"}>
                              {scannedCargo.location || "Unassigned"}
                            </StatusBadge>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No registered cargo record is loaded for this barcode yet.</div>
                    )
                  ) : (
                    <div className="text-xs text-muted-foreground">No cargo barcode entered yet.</div>
                  )}
                </div>
              </ScanInputPanel>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={Warehouse}>Storage Bin Barcode Input</SectionTitle>} defaultOpen>
              <ScanInputPanel
                title="Bin Scan Field"
                helper="Scan the physical storage bin barcode after cargo reaches the rack."
                placeholder="Scan or enter bin barcode"
                value={binBarcode}
                onChange={setBinBarcode}
                inputRef={binScanRef}
                active={focusedScan === "bin"}
                onFocus={() => setFocusedScan("bin")}
              >
                <div className="mt-3 rounded-md border border-border bg-card p-3">
                  {activeBin ? (
                    <ReadonlyGrid
                      columns="md:grid-cols-2 xl:grid-cols-4"
                      items={[
                        { label: "Zone", value: formatZoneLabel(activeBin, formatZoneLabel(selectedZoneRecord)) },
                        { label: "Rack", value: getRackCode(activeBin) || getRackCode(selectedRackRecord) },
                        { label: "Level", value: getLevelCode(activeBin) || getLevelCode(selectedLevelRecord) },
                        { label: "Bin", value: getBinBarcode(activeBin) },
                        { label: "Bin Status", value: getBinStatus(activeBin) },
                        { label: "Remaining Weight Capacity", value: formatMeasure(activeBinRemainingWeight, "kg") },
                        { label: "Remaining Volume Capacity", value: formatMeasure(activeBinRemainingVolume, "m³") },
                        { label: "Reserved For", value: activeBin.reserved_for_cargo_type || "None" }
                      ]}
                    />
                  ) : binBarcode.trim() ? (
                    <div className="text-xs text-muted-foreground">Bin details will appear after placement rules finish.</div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No bin barcode entered yet.</div>
                  )}
                </div>
              </ScanInputPanel>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={Warehouse}>Warehouse Storage Navigator</SectionTitle>} defaultOpen>
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Zone">
                    <Select value={selectedZone} onChange={handleZoneSelect} disabled={zones.length === 0}>
                      <option value="">Select zone</option>
                      {zones.map((zone) => (
                        <option key={getRecordId(zone, "zone_id")} value={getRecordId(zone, "zone_id")}>
                          {formatZoneLabel(zone, "Unnamed zone")}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Rack">
                    <Select value={selectedRack} onChange={handleRackSelect} disabled={!selectedZone || hierarchyLoading.racks || racks.length === 0}>
                      <option value="">{hierarchyLoading.racks ? "Loading racks..." : "Select rack"}</option>
                      {racks.map((rack) => (
                        <option key={getRecordId(rack, "rack_id")} value={getRecordId(rack, "rack_id")}>
                          {getRackCode(rack)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Level">
                    <Select value={selectedLevel} onChange={handleLevelSelect} disabled={!selectedRack || hierarchyLoading.levels || levels.length === 0}>
                      <option value="">{hierarchyLoading.levels ? "Loading levels..." : "Select level"}</option>
                      {levels.map((level) => (
                        <option key={getRecordId(level, "level_id")} value={getRecordId(level, "level_id")}>
                          {formatLevelLabel(level)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Bin">
                    <Select value={selectedBin} onChange={handleBinSelect} disabled={!selectedLevel || hierarchyLoading.bins || bins.length === 0}>
                      <option value="">{hierarchyLoading.bins ? "Loading bins..." : "Select bin"}</option>
                      {bins.map((bin) => (
                        <option key={getRecordId(bin, "bin_id")} value={getRecordId(bin, "bin_id")}>
                          {getBinBarcode(bin)} - {getBinStatus(bin)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                {(hierarchyError || zonesError) && (
                  <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    {hierarchyError || zonesError}
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {[
                    { label: "Zone", value: formatZoneLabel(selectedZoneRecord, "Select zone") },
                    { label: "Rack", value: getRackCode(selectedRackRecord) || "Select rack" },
                    { label: "Level", value: getLevelCode(selectedLevelRecord) || "Select level" },
                    { label: "Bin", value: getBinBarcode(activeBin) || "Select bin" },
                    { label: "Available Capacity", value: activeBin ? `${formatMeasure(activeBinRemainingWeight, "kg")} / ${formatMeasure(activeBinRemainingVolume, "m³")}` : "Select bin" }
                  ].map((item) => (
                    <div key={item.label} className="rounded-md border border-border bg-muted/20 p-3">
                      <div className="text-[11px] font-semibold text-muted-foreground">{item.label}</div>
                      <div className="mt-1 min-h-5 truncate text-xs font-semibold">{item.value}</div>
                    </div>
                  ))}
                </div>

                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {bins.length > 0 ? (
                    bins.map((bin) => {
                      const binId = getRecordId(bin, "bin_id");
                      const isSelected = selectedBin === binId;
                      const remainingWeight = getRemainingCapacity(bin, "weight");
                      const remainingVolume = getRemainingCapacity(bin, "volume");

                      return (
                        <button
                          key={binId}
                          type="button"
                          onClick={() => handleBinSelect(binId)}
                          className={cn(
                            "rounded-md border p-3 text-left transition hover:bg-muted/40",
                            isSelected ? "border-info bg-info/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.18)]" : "border-border bg-card"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-semibold">{getBinBarcode(bin)}</span>
                            <StatusBadge tone={binStatusTone(getBinStatus(bin))}>{getBinStatus(bin)}</StatusBadge>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                            <span>Bin {getBinCode(bin)}</span>
                            <span>{formatMeasure(remainingWeight, "kg")}</span>
                            <span>{getLevelCode(selectedLevelRecord) || getLevelCode(bin)}</span>
                            <span>{formatMeasure(remainingVolume, "m³")}</span>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground md:col-span-2 xl:col-span-4">
                      {selectedLevel ? "No bins found for the selected level." : "Select a zone, rack, and level to load bins."}
                    </div>
                  )}
                </div>
              </div>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={Warehouse}>Warehouse Storage Structure</SectionTitle>}>
              <div className="overflow-auto rounded border border-border">
                <table className="w-full min-w-[620px] text-xs">
                  <thead className="bg-panel-header text-panel-header-foreground">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold">Zone Code</th>
                      <th className="px-2 py-2 text-left font-semibold">Zone Name</th>
                      <th className="px-2 py-2 text-left font-semibold">Racks</th>
                      <th className="px-2 py-2 text-left font-semibold">Levels</th>
                      <th className="px-2 py-2 text-left font-semibold">Bins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zones.length > 0 ? (
                      zones.map((zone) => (
                        <tr key={getRecordId(zone, "zone_id")} className="border-t border-border">
                          <td className="px-2 py-2 font-mono font-semibold">{getZoneCode(zone)}</td>
                          <td className="px-2 py-2">{getZoneName(zone)}</td>
                          <td className="px-2 py-2 text-muted-foreground">{zone.rack_total || zone.rack_count} racks</td>
                          <td className="px-2 py-2 text-muted-foreground">{zone.level_count} levels per rack</td>
                          <td className="px-2 py-2 text-muted-foreground">{zone.bin_total || 0} bins</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="border-t border-border">
                        <td colSpan={5} className="px-2 py-3 text-muted-foreground">
                          {zonesError || "No storage hierarchy records loaded yet."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={ListChecks}>Automatic Placement Validation</SectionTitle>} defaultOpen>
              <div className="grid gap-3 lg:grid-cols-3">
                {validationCards.map((card) => (
                  <div
                    key={card.title}
                    className={cn(
                      "rounded-md border p-3",
                      card.passed ? "border-success/35 bg-success/10" : "border-warning/35 bg-warning/10"
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
                      {card.passed ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
                      {card.title}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{card.body}</div>
                  </div>
                ))}
              </div>
              <div
                className={cn(
                  "mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold",
                  validation.approved ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive"
                )}
              >
                {validation.approved ? <CheckCircle2 className="h-4 w-4" /> : <FileWarning className="h-4 w-4" />}
                {validation.reason}: {validation.detail}
              </div>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={MapPin}>Placement Summary</SectionTitle>} defaultOpen>
              <ReadonlyGrid
                columns="md:grid-cols-2 xl:grid-cols-4"
                items={[
                  { label: "Selected Zone", value: formatZoneLabel(activeBin, formatZoneLabel(selectedZoneRecord)) },
                  { label: "Selected Rack", value: getRackCode(activeBin) || getRackCode(selectedRackRecord) || "Awaiting selection" },
                  { label: "Selected Level", value: getLevelCode(activeBin) || getLevelCode(selectedLevelRecord) || "Awaiting selection" },
                  { label: "Selected Bin", value: getBinBarcode(activeBin) || "Awaiting selection" },
                  { label: "Bin Status", value: activeBin ? getBinStatus(activeBin) : "Awaiting selection" },
                  { label: "Remaining Capacity", value: activeBin ? `${formatMeasure(activeBinRemainingWeight, "kg")} / ${formatMeasure(activeBinRemainingVolume, "m³")}` : "Awaiting selection" },
                  { label: "Placement Time", value: placementTime || "Pending confirmation" },
                  { label: "Assigned By", value: formData.received_by || "Warehouse Staff" }
                ]}
              />
            </CollapsibleCard>
          </div>
        )}

        {activeTab === 2 && (
          <div className="space-y-3 p-4">
            <CollapsibleCard title={<SectionTitle icon={Search}>Cargo Search</SectionTitle>} defaultOpen>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Field label="Cargo ID">
                  <Input value={trackingFilters.cargoId} onChange={(event) => handleTrackingFilterChange("cargoId", event.target.value)} placeholder="CARGO-2026-00001" />
                </Field>
                <Field label="Barcode">
                  <Input value={trackingFilters.barcode} onChange={(event) => handleTrackingFilterChange("barcode", event.target.value)} placeholder="Scan or enter barcode" />
                </Field>
                <Field label="Consignee">
                  <Input value={trackingFilters.consignee} onChange={(event) => handleTrackingFilterChange("consignee", event.target.value)} placeholder="Enter consignee" />
                </Field>
                <Field label="Cargo Type">
                  <Select value={trackingFilters.cargoType} onChange={(value) => handleTrackingFilterChange("cargoType", value)}>
                    <option>All</option>
                    {cargoTypes.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={trackingFilters.status} onChange={(value) => handleTrackingFilterChange("status", value)}>
                    <option>All</option>
                    <option>Pending Registration</option>
                    <option>Registered</option>
                    <option>Pending Placement</option>
                    <option>Stored</option>
                    <option>Blocked</option>
                    <option>Released</option>
                  </Select>
                </Field>
              </div>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={ClipboardList}>Cargo Records</SectionTitle>} defaultOpen>
              <div className="overflow-auto rounded border border-border">
                <table className="w-full min-w-[780px] text-xs">
                  <thead className="bg-panel-header text-panel-header-foreground">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold">Cargo ID</th>
                      <th className="px-2 py-2 text-left font-semibold">Consignee</th>
                      <th className="px-2 py-2 text-left font-semibold">Cargo Type</th>
                      <th className="px-2 py-2 text-left font-semibold">Barcode</th>
                      <th className="px-2 py-2 text-left font-semibold">Status</th>
                      <th className="px-2 py-2 text-left font-semibold">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCargoRecords.length > 0 ? (
                      filteredCargoRecords.map((record) => (
                        <tr key={record.id} className="border-t border-border">
                          <td className="px-2 py-2 font-mono font-semibold">{record.cargo_id}</td>
                          <td className="px-2 py-2">{record.consignee_name}</td>
                          <td className="px-2 py-2 text-muted-foreground">{record.cargo_type}</td>
                          <td className="px-2 py-2 font-mono text-muted-foreground">{record.barcode}</td>
                          <td className="px-2 py-2"><StatusBadge tone={statusTone(cargoOperationalStatus(record))}>{cargoOperationalStatus(record)}</StatusBadge></td>
                          <td className="px-2 py-2 text-muted-foreground">{record.location || "Unassigned"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="border-t border-border">
                        <td colSpan={6} className="px-2 py-3 text-muted-foreground">
                          {cargoLoading ? "Loading cargo records..." : cargoError || "No cargo records found."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={MapPin}>Current Location</SectionTitle>} defaultOpen>
              <ReadonlyGrid
                columns="md:grid-cols-2 xl:grid-cols-4"
                items={[
                  { label: "Zone", value: formatZoneLabel(trackingCargo, "Unassigned") },
                  { label: "Rack", value: getRackCode(trackingCargo) || "Not assigned" },
                  { label: "Level", value: getLevelCode(trackingCargo) || "Not assigned" },
                  { label: "Bin", value: getBinBarcode(trackingCargo) || trackingCargo?.location || "Not assigned" }
                ]}
              />
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={History}>Movement History</SectionTitle>} defaultOpen>
              <div className="overflow-auto rounded border border-border">
                <table className="w-full min-w-[620px] text-xs">
                  <thead className="bg-panel-header text-panel-header-foreground">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold">Date</th>
                      <th className="px-2 py-2 text-left font-semibold">From Location</th>
                      <th className="px-2 py-2 text-left font-semibold">To Location</th>
                      <th className="px-2 py-2 text-left font-semibold">Moved By</th>
                      <th className="px-2 py-2 text-left font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementRows.length > 0 ? (
                      movementRows.map((row) => (
                        <tr key={row.id} className="border-t border-border">
                          <td className="px-2 py-2 text-muted-foreground">{formatDateTime(row.created_at)}</td>
                          <td className="px-2 py-2">{row.from_location || "NULL"}</td>
                          <td className="px-2 py-2">{row.to_location || "NULL"}</td>
                          <td className="px-2 py-2 text-muted-foreground">{row.moved_by || "System"}</td>
                          <td className="px-2 py-2 font-semibold">{row.action}</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="border-t border-border">
                        <td colSpan={5} className="px-2 py-3 text-muted-foreground">
                          {trackingDetailError || "No movement history loaded for the selected cargo."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={PackageCheck}>Cargo Status</SectionTitle>} defaultOpen>
              <div className="flex flex-wrap gap-2">
                {["Pending Registration", "Registered", "Pending Placement", "Stored", "Blocked", "Released"].map((status) => (
                  <StatusBadge key={status} tone={statusTone(status)}>
                    {status} ({statusCounts[status] || 0})
                  </StatusBadge>
                ))}
              </div>
            </CollapsibleCard>
          </div>
        )}

        {activeTab === 3 && (
          <div className="space-y-3 p-4">
            <CollapsibleCard title={<SectionTitle icon={ListChecks}>Placement Logs</SectionTitle>} defaultOpen>
              <div className="space-y-2">
                {placementLogs.length > 0 ? (
                  placementLogs.map((log) => (
                    <div key={log.id} className="grid gap-2 rounded border border-border bg-muted/20 p-2 text-xs sm:grid-cols-[120px_92px_1fr]">
                      <span className="font-mono text-muted-foreground">{formatDateTime(log.created_at)}</span>
                      <StatusBadge tone={log.approved ? "success" : "destructive"}>
                        {log.approved ? "Success" : "Rejected"}
                      </StatusBadge>
                      <span>{log.reason}: {log.detail}</span>
                    </div>
                  ))
                ) : (
                  <div className="rounded border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
                    {logsError || "No placement validation logs recorded yet."}
                  </div>
                )}
              </div>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={FileWarning}>Validation Errors</SectionTitle>} defaultOpen>
              <div className="grid gap-2 md:grid-cols-2">
                {failedValidationLogs.length > 0 ? (
                  failedValidationLogs.map((log) => (
                    <div key={log.id} className="flex items-center gap-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      {log.reason}
                    </div>
                  ))
                ) : (
                  <div className="rounded border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground md:col-span-2">
                    No validation errors recorded.
                  </div>
                )}
              </div>
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={ClipboardList}>Audit Information</SectionTitle>} defaultOpen>
              <ReadonlyGrid
                columns="md:grid-cols-2 xl:grid-cols-4"
                items={[
                  { label: "Created By", value: trackingCargo?.received_by || "System" },
                  { label: "Created Date", value: formatDateTime(trackingCargo?.created_at) },
                  { label: "Updated By", value: trackingCargo?.received_by || "System" },
                  { label: "Updated Date", value: formatDateTime(trackingCargo?.updated_at) }
                ]}
              />
            </CollapsibleCard>

            <CollapsibleCard title={<SectionTitle icon={ScanLine}>Barcode Information</SectionTitle>} defaultOpen>
              <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                <ReadonlyGrid
                  columns="md:grid-cols-3"
                  items={[
                    { label: "Cargo Barcode", value: trackingCargo?.barcode || "No cargo selected" },
                    { label: "Barcode Type", value: trackingCargo?.barcode ? "Code 128" : "Not generated" },
                    { label: "Generated Timestamp", value: formatDateTime(trackingCargo?.created_at) }
                  ]}
                />
                <div className="flex items-end">
                  <button className="inline-flex h-9 items-center justify-center gap-1.5 rounded bg-info px-4 text-xs font-semibold text-info-foreground transition hover:opacity-90">
                    <Printer className="h-3.5 w-3.5" />
                    Reprint Barcode
                  </button>
                </div>
              </div>
            </CollapsibleCard>
          </div>
        )}
      </div>

      {(activeTab === 0 || activeTab === 1) && (
        <div className="border-t border-border bg-card px-4 py-3">
          {activeTab === 0 ? (
            <div className="flex justify-end">
              <button
                onClick={saveCargo}
                disabled={savingCargo}
                className="inline-flex items-center gap-1.5 rounded bg-success px-4 py-2 text-xs font-semibold text-success-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {savingCargo ? "Saving..." : "Save Cargo"}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={handleConfirmPlacement}
                disabled={placementSaving || !cargoBarcode.trim() || !binBarcode.trim() || !validation.approved}
                className="inline-flex items-center gap-1.5 rounded bg-success px-4 py-2 text-xs font-semibold text-success-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {placementSaving ? "Confirming..." : "Confirm Placement"}
              </button>
              <button
                onClick={() => setPlacementNotice(false)}
                className="inline-flex items-center gap-1.5 rounded border border-border bg-secondary px-4 py-2 text-xs font-semibold text-secondary-foreground transition hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                onClick={clearScanSession}
                className="inline-flex items-center gap-1.5 rounded bg-warning px-4 py-2 text-xs font-semibold text-warning-foreground transition hover:opacity-90"
              >
                <ScanLine className="h-3.5 w-3.5" />
                Clear Scan Session
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export {
  DetailForm
};
