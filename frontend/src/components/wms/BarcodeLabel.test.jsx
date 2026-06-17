import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BinBarcodeLabel, encodeCode128B } from "./BarcodeLabel";

describe("Code 128 cargo barcode", () => {
  it("encodes a generated cargo identifier with start, checksum, and stop codes", () => {
    const codes = encodeCode128B("CARGO-2026-00001");

    expect(codes[0]).toBe(104);
    expect(codes.at(-1)).toBe(106);
    expect(codes.length).toBe("CARGO-2026-00001".length + 3);
  });

  it("rejects unsupported non-printable values", () => {
    expect(() => encodeCode128B("CARGO\n1")).toThrow();
  });

  it("renders a bin label with its storage hierarchy", () => {
    render(
      <BinBarcodeLabel
        bin={{
          barcode: "BIN-D01-L1-02",
          zone_code: "Z-D",
          zone_name: "Food Products",
          rack_code: "R-D01",
          level_code: "L1"
        }}
      />
    );

    expect(screen.getAllByText("BIN-D01-L1-02").length).toBeGreaterThan(0);
    expect(screen.getByText("Food Products Zone")).toBeInTheDocument();
    expect(screen.getByText("Rack R-D01 / Level L1")).toBeInTheDocument();
  });
});
