import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManualPlacementModal } from "./ManualPlacementModal";
import {
  confirmPlacement,
  getBins,
  getLevels,
  getPlacementSettings,
  getRacks,
  getZones,
  validatePlacement
} from "@/services/api";

vi.mock("@/services/api", () => ({
  confirmPlacement: vi.fn(),
  getBins: vi.fn(),
  getLevels: vi.fn(),
  getPlacementSettings: vi.fn(),
  getRacks: vi.fn(),
  getZones: vi.fn(),
  validatePlacement: vi.fn()
}));

const cargo = { id: 7, cargo_id: "CARGO-2026-00007", placement_status: "Unplaced" };

describe("ManualPlacementModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getZones.mockResolvedValue({ data: [{ id: 1, code: "Z-A", name: "General" }] });
    getRacks.mockResolvedValue({ data: [{ id: 2, code: "R-A" }] });
    getLevels.mockResolvedValue({ data: [{ id: 3, code: "L-1" }] });
    getBins.mockResolvedValue({ data: [{ id: 4, barcode: "BIN-A-01", status: "Available" }] });
  });

  it("blocks the workflow when the server setting is disabled", async () => {
    getPlacementSettings.mockResolvedValue({ data: { manual_placement_enabled: false, manual_placement_reasons: [] } });
    render(<ManualPlacementModal cargo={cargo} open onClose={vi.fn()} />);

    expect(await screen.findByText(/manual placement is currently disabled/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /validate placement/i })).not.toBeInTheDocument();
  });

  it("loads dependent hierarchy options, validates, and confirms through the backend", async () => {
    getPlacementSettings.mockResolvedValue({ data: { manual_placement_enabled: true, manual_placement_reasons: [{ value: "scanner_unavailable", label: "Barcode scanner unavailable" }] } });
    validatePlacement.mockResolvedValue({ data: { approved: true, detail: "Placement is valid.", checks: { availableBin: { passed: true, message: "Available" } } } });
    confirmPlacement.mockResolvedValue({ success: true, message: "Cargo placed successfully." });
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    render(<ManualPlacementModal cargo={cargo} open onClose={onClose} onCompleted={onCompleted} />);

    fireEvent.change(await screen.findByLabelText("Manual placement zone"), { target: { value: "1" } });
    await waitFor(() => expect(getRacks).toHaveBeenCalledWith("1"));
    fireEvent.change(screen.getByLabelText("Manual placement rack"), { target: { value: "2" } });
    await waitFor(() => expect(getLevels).toHaveBeenCalledWith("2"));
    fireEvent.change(screen.getByLabelText("Manual placement level"), { target: { value: "3" } });
    await waitFor(() => expect(getBins).toHaveBeenCalledWith("3"));
    fireEvent.change(screen.getByLabelText("Manual placement bin"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Manual placement reason"), { target: { value: "scanner_unavailable" } });
    fireEvent.click(screen.getByRole("button", { name: /validate placement/i }));

    expect(await screen.findByText(/validation passed/i)).toBeInTheDocument();
    expect(validatePlacement).toHaveBeenCalledWith({
      cargo_id: 7,
      bin_id: "4",
      placement_mode: "manual",
      manual_placement_reason: "scanner_unavailable",
      operation_type: "placement"
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm placement/i }));
    await waitFor(() => expect(confirmPlacement).toHaveBeenCalled());
    expect(onCompleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
