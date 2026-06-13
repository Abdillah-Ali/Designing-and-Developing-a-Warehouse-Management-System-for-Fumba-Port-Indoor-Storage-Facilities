import { afterEach, describe, expect, it, vi } from "vitest";
import { createCargo } from "./api";

describe("cargo registration API errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves duplicate warning details for the registration form", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        success: false,
        code: "DUPLICATE_CARGO",
        message: "Possible duplicate cargo detected.",
        details: {
          matches: [{
            cargo_id: "CARGO-2026-00001",
            matched_field_labels: ["Delivery Note Number"]
          }]
        }
      })
    }));

    await expect(createCargo({ delivery_note_number: "DN-100" })).rejects.toMatchObject({
      code: "DUPLICATE_CARGO",
      status: 409,
      details: {
        matches: [{
          cargo_id: "CARGO-2026-00001",
          matched_field_labels: ["Delivery Note Number"]
        }]
      }
    });
  });
});
