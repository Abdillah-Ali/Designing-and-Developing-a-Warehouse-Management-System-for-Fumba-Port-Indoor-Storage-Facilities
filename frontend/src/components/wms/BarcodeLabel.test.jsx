import { describe, expect, it } from "vitest";
import { encodeCode128B } from "./BarcodeLabel";

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
});
