import { describe, expect, it } from "vitest";
import { buildApprovalDecisionMessage } from "@rbrasier/domain";
import { formatDecisionMoment, parseApprovalDecisionMessage } from "./approval-decision-message";

const decidedAt = new Date("2026-08-02T10:14:00.000Z");

const built = (overrides: Partial<Parameters<typeof buildApprovalDecisionMessage>[0]> = {}) =>
  buildApprovalDecisionMessage({
    status: "approved",
    approverName: "Rosa Okafor",
    approverEmail: "rosa.okafor@example.com",
    decidedAt,
    comment: null,
    routedBack: false,
    routingError: null,
    ...overrides,
  });

describe("parseApprovalDecisionMessage", () => {
  // The domain builds it and this reads it back. Round-tripping the real builder
  // rather than a hand-written string is the point: a change to either side that
  // the other does not follow fails here instead of in the feed.
  it("round-trips what the domain builder wrote", () => {
    const parsed = parseApprovalDecisionMessage(built());

    expect(parsed?.approverName).toBe("Rosa Okafor");
    expect(parsed?.approverEmail).toBe("rosa.okafor@example.com");
    expect(parsed?.decidedAt.toISOString()).toBe(decidedAt.toISOString());
    expect(parsed?.outcome).toBe("Approval granted.");
  });

  it("keeps the approver's comment as part of the body", () => {
    const parsed = parseApprovalDecisionMessage(
      built({ status: "changes_requested", comment: "I think he should start on Monday 3rd" }),
    );

    expect(parsed?.body).toContain("I think he should start on Monday 3rd");
  });

  it("reads a decision that names no email", () => {
    const parsed = parseApprovalDecisionMessage(built({ approverEmail: null }));

    expect(parsed?.approverName).toBe("Rosa Okafor");
    expect(parsed?.approverEmail).toBeNull();
  });

  it("reads a decision that names nobody", () => {
    const parsed = parseApprovalDecisionMessage(
      built({ approverName: null, approverEmail: null }),
    );

    expect(parsed?.approverName).toBeNull();
    expect(parsed?.decidedAt.toISOString()).toBe(decidedAt.toISOString());
  });

  // Everything else the operator types must render verbatim — a message that
  // merely mentions an approval is not a decision record.
  it("returns null for an ordinary message", () => {
    expect(parseApprovalDecisionMessage("Approval granted, I think?")).toBeNull();
    expect(parseApprovalDecisionMessage("Decided by me at some point.")).toBeNull();
    expect(parseApprovalDecisionMessage("")).toBeNull();
  });

  it("returns null when the timestamp is not a real date", () => {
    expect(
      parseApprovalDecisionMessage("Approval granted.\nDecided by Rosa (r@e.com) at yesterday."),
    ).toBeNull();
  });
});

describe("formatDecisionMoment", () => {
  // The server only knows UTC; the reader wants their own clock. Asserting
  // against toLocaleString keeps this true under whatever timezone CI runs in.
  it("renders the decision moment in the viewer's local time", () => {
    expect(formatDecisionMoment(decidedAt)).toBe(decidedAt.toLocaleString());
  });
});
