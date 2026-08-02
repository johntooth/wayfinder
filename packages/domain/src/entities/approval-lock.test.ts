import { describe, expect, it } from "vitest";
import { isRecordLocked } from "./approval-lock";

const settled = {
  hasRecordedSnapshot: true,
  hasPendingApproval: false,
  sessionIsOnStep: false,
};

describe("isRecordLocked", () => {
  it("locks a record once its approval chain has settled", () => {
    expect(isRecordLocked(settled)).toBe(true);
  });

  it("leaves a record unlocked while no approval has ever snapshotted it", () => {
    expect(isRecordLocked({ ...settled, hasRecordedSnapshot: false })).toBe(false);
  });

  // ADR-045 §5: an approver still deciding must be able to fix their own subject
  // rather than send the whole thing back over a typo. An earlier approval's
  // snapshot must not take that away from the next approver in the chain.
  it("unlocks a record while an approval is still pending on the session", () => {
    expect(isRecordLocked({ ...settled, hasPendingApproval: true })).toBe(false);
  });

  // ADR-044 §1: a change request routes the session back to a step the operator
  // can act on. Arriving at a step you are forbidden to edit is not a return.
  it("unlocks a record the session has been routed back to", () => {
    expect(isRecordLocked({ ...settled, sessionIsOnStep: true })).toBe(false);
  });

  it("stays unlocked when work is both pending and returned", () => {
    expect(
      isRecordLocked({ hasRecordedSnapshot: true, hasPendingApproval: true, sessionIsOnStep: true }),
    ).toBe(false);
  });
});
