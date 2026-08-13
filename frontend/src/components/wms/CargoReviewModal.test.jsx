import { describe, expect, it } from "vitest";
import { getAllowedCargoReviewActions } from "./CargoReviewModal";

describe("cargo workflow action metadata", () => {
  it("uses stable backend transition keys and does not infer actions from a status label", () => {
    const withoutMetadata = getAllowedCargoReviewActions({ registration_status: "Pending Review" });
    expect(withoutMetadata.size).toBe(0);

    const allowed = getAllowedCargoReviewActions({
      registration_status: "Renamed display label",
      allowed_actions: [
        { transition_key: "approve_registration" },
        { transition_key: "request_registration_correction" }
      ]
    });
    expect([...allowed]).toEqual(["approve_registration", "request_registration_correction"]);
    expect(allowed.has("reject_registration")).toBe(false);
  });
});
