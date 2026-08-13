import { afterEach, describe, expect, it, vi } from "vitest";
import { createCargo } from "./api";
import { clearStoredAuthToken, setStoredAuthToken } from "../lib/portal-access";

describe("cargo registration API errors", () => {
  afterEach(() => {
    clearStoredAuthToken();
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

  it("uses one refresh rotation for simultaneous expired-access responses", async () => {
    setStoredAuthToken("expired.access.token");
    let cargoAttempts = 0;
    let refreshAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/auth/refresh")) {
        refreshAttempts += 1;
        await Promise.resolve();
        return { ok: true, status: 200, json: async () => ({ success: true, token: "new.access.token" }) };
      }
      cargoAttempts += 1;
      if (cargoAttempts <= 2) {
        return { ok: false, status: 401, json: async () => ({ success: false, code: "AUTH_SESSION_EXPIRED" }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) };
    }));

    await Promise.all([createCargo({}), createCargo({})]);
    expect(refreshAttempts).toBe(1);
    expect(cargoAttempts).toBe(4);
  });
});
