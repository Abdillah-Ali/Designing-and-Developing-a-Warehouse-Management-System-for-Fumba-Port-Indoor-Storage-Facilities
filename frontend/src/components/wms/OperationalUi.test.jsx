import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable } from "@/components/wms/OperationalUi";

const rows = Array.from({ length: 27 }, (_, index) => ({ id: index + 1, name: `Record ${index + 1}` }));
const columns = [{ key: "name", label: "Name" }];

describe("DataTable pagination", () => {
  it("paginates records with ranges, page numbers, and previous/next navigation", () => {
    render(<DataTable rows={rows} columns={columns} />);

    expect(screen.getByText("1–10 of 27 records")).toBeInTheDocument();
    expect(screen.getByText("Record 1")).toBeInTheDocument();
    expect(screen.queryByText("Record 11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(screen.getByText("11–20 of 27 records")).toBeInTheDocument();
    expect(screen.getByText("Record 11")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("21–27 of 27 records")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("11–20 of 27 records")).toBeInTheDocument();
  });

  it("offers all required page sizes and resets to the first page when size changes", () => {
    render(<DataTable rows={rows} columns={columns} />);
    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));

    const selector = screen.getByRole("combobox", { name: "Rows per page" });
    expect(within(selector).getAllByRole("option").map((option) => option.value)).toEqual(["10", "20", "50", "100"]);
    fireEvent.change(selector, { target: { value: "20" } });

    expect(screen.getByText("1–20 of 27 records")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  });
});
