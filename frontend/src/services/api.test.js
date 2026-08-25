import { afterEach, describe, expect, it, vi } from "vitest";
import { createCargo, getCargo, getCargoById, recommendBin } from "./api";
import { clearStoredAuthToken, setStoredAuthToken, setStoredSessionSelector } from "../lib/portal-access";

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
    setStoredSessionSelector("SES-AAAAAAAAAAAAAAAAAAAAAAAA");
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

  it("uses backend search pagination and stable cargo references", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, total: 0, data: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    await getCargo({ search: "CRG-2026-00421", placement_status: "Placed", page: 3, limit: 25 });
    await getCargoById("CRG-2026-00421");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/cargo?search=CRG-2026-00421&placement_status=Placed&page=3&limit=25"), expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/cargo/CRG-2026-00421"), expect.any(Object));
  });

  it("preserves the explicit no-compatible-bin recommendation conflict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ success: false, code: "NO_COMPATIBLE_BIN", message: "No compatible normal bin is available." }) }));
    await expect(recommendBin("CRG-2026-00421")).rejects.toMatchObject({ code: "NO_COMPATIBLE_BIN", status: 409 });
  });
});
