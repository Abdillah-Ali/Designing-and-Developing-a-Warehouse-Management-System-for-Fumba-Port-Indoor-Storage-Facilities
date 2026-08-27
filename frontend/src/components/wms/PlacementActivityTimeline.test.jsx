import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlacementActivityPanel } from "./PlacementActivityTimeline";

describe("Warehouse Staff placement activity", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders operational events and requests the next page from the backend", async () => {
    const fetchMock = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/placement/activity/summary")) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { activity_count: 26, placement_confirmed_count: 1, relocation_count: 0, validation_failed_count: 1, confirmation_failed_count: 0 } }) };
      }
      if (url.includes("/placement/activity?")) {
        return { ok: true, status: 200, json: async () => ({ success: true, total: 26, data: [{ id: "validation:1", timestamp: "2026-08-15T08:00:00.000Z", activity_type: "PLACEMENT_VALIDATION_FAILED", result: "failed", cargo_identifier: "CARGO-2026-00001", performed_by_name: "Warehouse Staff", from_location: null, to_location: "BIN-A", detail: "Destination bin capacity is insufficient." }] }) };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PlacementActivityPanel title="My Placement Activity" />);
    expect(await screen.findByText("Validation Failed")).toBeInTheDocument();
    expect(screen.getByText("CARGO-2026-00001")).toBeInTheDocument();
    expect(screen.getByText("1–10 of 26 activity records")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("page=2"), expect.any(Object)));
  });

  it("distinguishes an empty activity feed from an API failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/summary")) return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) };
      return { ok: true, status: 200, json: async () => ({ success: true, total: 0, data: [] }) };
    }));
    render(<PlacementActivityPanel />);
    expect(await screen.findByText("No activity in this view")).toBeInTheDocument();
  });
});
