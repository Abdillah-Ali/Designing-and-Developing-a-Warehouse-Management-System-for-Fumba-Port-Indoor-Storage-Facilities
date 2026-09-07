import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ManagementPortal from "./ManagementPortal";
import { getCargo, getManagementTariffApprovals } from "@/services/api";

vi.mock("@/services/api", () => ({
  getCargo: vi.fn(), getCargoById: vi.fn(), getManagementTariffApprovals: vi.fn(),
  getManagementDashboard: vi.fn(), getManagementReleaseRequests: vi.fn(),
  approveManagementRelease: vi.fn(), rejectManagementRelease: vi.fn(),
  approveManagementTariff: vi.fn(), rejectManagementTariff: vi.fn(), logout: vi.fn(),
}));
vi.mock("@/components/wms/HeaderActions", () => ({ HeaderActions: () => null }));
vi.mock("@/components/wms/CollapsibleSidebar", () => ({ CollapsibleSidebar: () => null }));
vi.mock("@/components/wms/NotificationsPage", () => ({ NotificationsPage: () => null }));
vi.mock("@/components/wms/ProfilePage", () => ({ AccountProfilePage: () => null }));
vi.mock("@/components/wms/ManagementReports", () => ({ ManagementReports: () => null }));

describe.each([
  { path: "cargo", title: "Cargo Oversight", load: getCargo, empty: "No cargo records", row: { cargo_id: "CARGO-001" } },
  { path: "tariff-approvals", title: "Tariff Approval Requests", load: getManagementTariffApprovals, empty: "No pending tariffs", row: { public_reference: "TARIFF-001" } },
])("Management $path", ({ path, title, load, empty, row }) => {
  beforeEach(() => vi.clearAllMocks());

  const open = () => render(
    <MemoryRouter initialEntries={[`/management/${path}`]}>
      <Routes><Route path="/management/*" element={<ManagementPortal />} /></Routes>
    </MemoryRouter>,
  );

  it("renders while the request is pending and then displays records", async () => {
    let resolve;
    load.mockReturnValue(new Promise((done) => { resolve = done; }));
    open();
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText("Loading operational data...")).toBeInTheDocument();
    await act(async () => resolve({ data: [row] }));
    expect(screen.getByText(Object.values(row)[0])).toBeInTheDocument();
  });

  it.each([[], null, undefined])("renders an empty state for data %s", async (data) => {
    load.mockResolvedValue({ data });
    open();
    expect(await screen.findByText(empty)).toBeInTheDocument();
  });

  it("shows request failures without losing the page", async () => {
    load.mockRejectedValue(new Error("Unable to load records"));
    open();
    expect(await screen.findByText("Unable to load records")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  });
});
