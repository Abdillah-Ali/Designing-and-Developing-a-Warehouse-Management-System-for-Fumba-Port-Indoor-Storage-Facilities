import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RegisteredCargoPage } from "./RegisteredCargoPage";
import { getCargo, getCargoById } from "@/services/api";
vi.mock("@/services/api", () => ({ getCargo: vi.fn(), getCargoById: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it("lists all status types and opens fresh cargo details in a closable popup", async () => {
  getCargo.mockResolvedValue({ total: 1, data: [{ cargo_id: "CARGO-1", registration_status: "Approved", placement_status: "Placed", customs_status: "Cleared", financial_status: "Paid", management_release_status: "Not Requested", dispatch_status: "Authorized", gate_out_status: "Not Released" }] });
  getCargoById.mockResolvedValue({ data: { cargo_id: "CARGO-1", received_by: "Staff Member", warehouse_name: "Warehouse A", inspection_notes: "Packaging intact", documents: [{ id: 1, file_name: "delivery.pdf" }] } });
  render(<RegisteredCargoPage />);
  fireEvent.click(await screen.findByRole("button", { name: "View CARGO-1" }));
  const dialog = screen.getByRole("dialog", { name: "Cargo Details: CARGO-1" });
  expect(await within(dialog).findByText("Packaging intact")).toBeInTheDocument();
  expect(within(dialog).getByText("Staff Member")).toBeInTheDocument();
  expect(within(dialog).getByText("delivery.pdf")).toBeInTheDocument();
  expect(getCargoById).toHaveBeenCalledWith("CARGO-1");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close window" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  for (const value of ["Approved", "Placed", "Cleared", "Paid", "Not Requested", "Authorized", "Not Released"]) expect(screen.getByText(value)).toBeInTheDocument();
});

it("loads later pages from the server and resets pagination when searching", async () => {
  getCargo.mockImplementation(({ page }) => Promise.resolve({ total: 41, data: [{ cargo_id: `CARGO-PAGE-${page}` }] }));
  render(<RegisteredCargoPage />);
  await screen.findByText("CARGO-PAGE-1");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("CARGO-PAGE-2");
  expect(getCargo).toHaveBeenLastCalledWith({ page: 2, limit: 20 });
  fireEvent.change(screen.getByRole("textbox", { name: "Search registered cargo" }), { target: { value: "delivery" } });
  await waitFor(() => expect(getCargo).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: "delivery" }));
});

it("shows errors for failed list requests", async () => {
  getCargo.mockRejectedValue(new Error("Unable to retrieve cargo"));
  render(<RegisteredCargoPage />);
  expect(await screen.findByText("Unable to retrieve cargo")).toBeInTheDocument();
});
