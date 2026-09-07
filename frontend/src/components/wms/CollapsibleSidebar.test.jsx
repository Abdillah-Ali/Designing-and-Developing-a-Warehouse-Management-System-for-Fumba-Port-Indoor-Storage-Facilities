import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { LayoutDashboard, Package } from "lucide-react";
import { CollapsibleSidebar } from "./CollapsibleSidebar";

const navigation = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/role" },
  { label: "Cargo", icon: Package, children: [{ label: "Cargo Records", icon: Package, to: "/role/cargo" }] }
];

describe("CollapsibleSidebar", () => {
  it("keeps navigation available as icons with names as hover tooltips when collapsed", () => {
    render(<MemoryRouter initialEntries={["/role/cargo"]}><CollapsibleSidebar navigation={navigation} basePath="/role" role="Test Role" consoleName="Test Console" /></MemoryRouter>);

    expect(screen.getByText("Cargo Records")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation menu" }));

    expect(screen.queryByText("Cargo Records")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Cargo Records")).toHaveAttribute("title", "Cargo Records");
    expect(screen.getByLabelText("Cargo Records")).toHaveClass("bg-sidebar-accent");
    expect(screen.getByRole("button", { name: "Expand navigation menu" })).toBeInTheDocument();
  });
});
