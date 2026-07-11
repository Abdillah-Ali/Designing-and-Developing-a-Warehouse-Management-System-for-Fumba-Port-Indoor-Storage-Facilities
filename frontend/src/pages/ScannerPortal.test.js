import { describe, expect, it } from "vitest";
import {
  getSessionStepKey,
  readCurrentStepError,
  shouldSuppressDuplicate
} from "@/lib/scanner-workflow";

describe("scanner input gating", () => {
  it("suppresses the same submitted barcode only during the cooldown", () => {
    const lastSubmission = { value: "CARGO-001", at: 1000 };

    expect(shouldSuppressDuplicate("CARGO-001", lastSubmission, 2000)).toBe(true);
    expect(shouldSuppressDuplicate("CARGO-001", lastSubmission, 3000)).toBe(false);
    expect(shouldSuppressDuplicate("BIN-001", lastSubmission, 1100)).toBe(false);
  });

  it("changes the scan key when the workflow advances", () => {
    expect(getSessionStepKey({ id: 12, status: "active", current_step_index: 0 })).toBe("12:0");
    expect(getSessionStepKey({ id: 12, status: "active", current_step_index: 1 })).toBe("12:1");
    expect(getSessionStepKey({ id: 12, status: "completed", current_step_index: 2 })).toBe("");
  });
});

describe("staff scan error visibility", () => {
  const session = {
    id: 12,
    status: "active",
    current_step_index: 1,
    last_error: "Invalid bin barcode.",
    context: {
      last_scan_attempt: {
        step_index: 1,
        accepted: false
      }
    }
  };

  it("shows an error after a failed attempt on the current step", () => {
    expect(readCurrentStepError(session)).toBe("Invalid bin barcode.");
  });

  it("hides stale errors from a previous step or sessions without an attempt", () => {
    expect(readCurrentStepError({
      ...session,
      context: { last_scan_attempt: { step_index: 0, accepted: false } }
    })).toBe("");
    expect(readCurrentStepError({ ...session, context: {} })).toBe("");
  });
});
