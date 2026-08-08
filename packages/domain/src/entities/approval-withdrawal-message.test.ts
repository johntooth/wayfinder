import { describe, expect, it } from "vitest";
import { buildApprovalWithdrawalMessage } from "./approval-withdrawal-message";

const withdrawnAt = new Date("2026-08-07T09:30:00.000Z");

const base = {
  originatorName: "Dana Whitlock",
  originatorEmail: "dana.whitlock@example.com",
  approverName: "Rosa Okafor",
  approverEmail: "rosa.okafor@example.com",
  withdrawnAt,
  reason: null,
  returnedToStepName: "Draft the business case",
  routingError: null,
};

describe("buildApprovalWithdrawalMessage", () => {
  it("names who withdrew, who it was taken back from, and when", () => {
    const content = buildApprovalWithdrawalMessage(base);

    expect(content).toContain("withdrawn");
    expect(content).toContain("Dana Whitlock");
    expect(content).toContain("Rosa Okafor");
    expect(content).toContain(withdrawnAt.toISOString());
  });

  it("names the step the work returned to", () => {
    const content = buildApprovalWithdrawalMessage(base);

    expect(content).toContain("Draft the business case");
  });

  it("appends the originator's reason as its own paragraph", () => {
    const content = buildApprovalWithdrawalMessage({
      ...base,
      reason: "The salary figures were stale — pulling this back to fix them",
    });

    expect(content).toContain("Reason: The salary figures were stale");
  });

  // ADR-044 §3: a routing gap holds the session, it never cancels it. The
  // message is the only place the operator learns why nothing moved.
  it("explains a held session when no step could be returned to", () => {
    const content = buildApprovalWithdrawalMessage({
      ...base,
      returnedToStepName: null,
      routingError: "This flow has no earlier chat step to return to.",
    });

    expect(content).toContain("This flow has no earlier chat step to return to.");
    expect(content).not.toContain("Returned to");
  });

  // Identity is copied in rather than joined at read time (ADR-040 §5), so a
  // deleted or half-populated account yields nulls. The message must stay
  // readable rather than printing "null" or an empty parenthesis.
  it("falls back to the email when a party has no name", () => {
    const content = buildApprovalWithdrawalMessage({
      ...base,
      originatorName: null,
      approverName: null,
    });

    expect(content).toContain("dana.whitlock@example.com");
    expect(content).toContain("rosa.okafor@example.com");
    expect(content).not.toContain("null");
  });

  it("omits an identity clause entirely when neither name nor email is known", () => {
    const content = buildApprovalWithdrawalMessage({
      ...base,
      originatorName: null,
      originatorEmail: null,
      approverName: null,
      approverEmail: null,
    });

    expect(content).toContain("withdrawn");
    expect(content).not.toContain("null");
    expect(content).not.toContain("()");
  });

  // An approval withdrawn before an approver was ever confirmed is legitimate:
  // the operator can raise the row, think again, and pull it before sending.
  it("reads correctly when the request never reached an approver", () => {
    const content = buildApprovalWithdrawalMessage({
      ...base,
      approverName: null,
      approverEmail: null,
    });

    expect(content).toContain("Dana Whitlock");
    expect(content).not.toContain("null");
  });
});
