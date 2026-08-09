import { describe, expect, it } from "vitest";
import { APPROVAL_OUTCOMES, approvalOutcome, isDecided } from "./approval-outcome";

describe("approvalOutcome", () => {
  it("covers every approval status", () => {
    // Exhaustive by construction: a new status added to the domain union fails
    // the typecheck here before it can reach the UI as a blank chip.
    for (const status of Object.keys(APPROVAL_OUTCOMES)) {
      expect(approvalOutcome(status as never).label.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes an approval the approver also edited", () => {
    // ADR-045 §4: derived, never selected. It has to read differently from a
    // plain approval or the distinction is worthless where it matters.
    expect(approvalOutcome("approved").label).toBe("Approved");
    expect(approvalOutcome("approved_with_edits").label).toBe("Approved with edits");
    expect(approvalOutcome("approved_with_edits").tone).toBe(approvalOutcome("approved").tone);
  });

  it("gives the three non-approving states their own labels", () => {
    expect(approvalOutcome("pending").label).toBe("Awaiting decision");
    expect(approvalOutcome("changes_requested").label).toBe("Changes requested");
    expect(approvalOutcome("rejected").label).toBe("Rejected");
  });
});

describe("isDecided", () => {
  it("is false only while pending", () => {
    expect(isDecided("pending")).toBe(false);
    expect(isDecided("approved")).toBe(true);
    expect(isDecided("approved_with_edits")).toBe(true);
    expect(isDecided("changes_requested")).toBe(true);
    expect(isDecided("rejected")).toBe(true);
  });
});
