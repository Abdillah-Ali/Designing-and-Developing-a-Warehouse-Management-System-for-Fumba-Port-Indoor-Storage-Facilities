import { describe, expect, it } from "vitest";
import {
  correctionValueChanged,
  normalizeCorrectionDisplayValue
} from "./cargo-correction-fields";

describe("cargo correction field comparison", () => {
  it("treats equivalent numeric values as unchanged", () => {
    expect(correctionValueChanged("weight", "500.00", 500)).toBe(false);
    expect(correctionValueChanged("quantity", "4", 5)).toBe(true);
  });

  it("trims text values before comparison", () => {
    expect(correctionValueChanged("consignee_name", "Fumba Port", " Fumba Port ")).toBe(false);
    expect(correctionValueChanged("inspection_notes", "Dry", "Wet")).toBe(true);
  });

  it("displays missing values clearly", () => {
    expect(normalizeCorrectionDisplayValue(null)).toBe("Empty");
    expect(normalizeCorrectionDisplayValue("Updated")).toBe("Updated");
  });
});
