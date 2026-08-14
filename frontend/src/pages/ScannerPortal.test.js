import { describe, expect, it } from "vitest";
import {
  getSessionStepKey,
  isTerminalScannerSession,
  readCurrentStepError
} from "@/lib/scanner-workflow";
import * as scannerWorkflow from "@/lib/scanner-workflow";

describe("scanner input gating", () => {
  it("leaves duplicate acceptance exclusively to the server", () => {
    expect(scannerWorkflow.SCAN_COOLDOWN_MS).toBeUndefined();
    expect(scannerWorkflow.shouldSuppressDuplicate).toBeUndefined();
  });

  it("changes the scan key when the workflow advances", () => {
    expect(getSessionStepKey({ id: 12, status: "active", current_step_index: 0 })).toBe("12:0");
    expect(getSessionStepKey({ id: 12, status: "active", current_step_index: 1 })).toBe("12:1");
    expect(getSessionStepKey({ id: 12, status: "completed", current_step_index: 2 })).toBe("");
  });
});

describe("scanner session lifecycle", () => {
  it("treats completed, cancelled, and expired sessions as terminal", () => {
    expect(isTerminalScannerSession({ status: "active" })).toBe(false);
    expect(isTerminalScannerSession({ status: "completed" })).toBe(true);
    expect(isTerminalScannerSession({ status: "cancelled" })).toBe(true);
    expect(isTerminalScannerSession({ status: "expired" })).toBe(true);
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
