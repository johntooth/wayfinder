import { describe, expect, it } from "vitest";
import {
  gateMode,
  picksApproverManually,
  sentApproverLabel,
  setupNotice,
  type GateRow,
} from "./approval-gate-state";

describe("picksApproverManually", () => {
  it("opens the picker when nothing could be suggested", () => {
    expect(picksApproverManually(false)).toBe(true);
  });

  it("leaves it closed when there is a suggestion to confirm", () => {
    expect(picksApproverManually(true)).toBe(false);
  });
});

describe("setupNotice", () => {
  it("says nothing when both email and the directory are configured", () => {
    expect(setupNotice({ emailConfigured: true, hasSuggestion: true })).toBeNull();
  });

  it("explains a missing suggestion without blaming the operator", () => {
    const notice = setupNotice({ emailConfigured: true, hasSuggestion: false });

    expect(notice?.label).toBe("Why you are choosing the approver");
    expect(notice?.paragraphs).toHaveLength(1);
    expect(notice?.paragraphs[0]).toContain("HR data");
  });

  it("explains manual sending when email is not configured", () => {
    const notice = setupNotice({ emailConfigured: false, hasSuggestion: true });

    expect(notice?.label).toBe("How this request is sent");
    expect(notice?.paragraphs).toHaveLength(1);
    expect(notice?.paragraphs[0]).toContain("link");
  });

  it("carries both explanations when neither is configured", () => {
    const notice = setupNotice({ emailConfigured: false, hasSuggestion: false });

    expect(notice?.paragraphs).toHaveLength(2);
    // The one that changes what the operator does next leads.
    expect(notice?.label).toBe("Why you are choosing the approver");
  });
});

// A pending approval row, as the gate reads it back.
const row = (overrides: Partial<GateRow> = {}): GateRow => ({
  approverUserId: null,
  approverEmail: null,
  ...overrides,
});

describe("gateMode", () => {
  it("asks for an approver while the row carries none", () => {
    expect(gateMode({ row: row(), assignedApprover: null })).toBe("choose");
  });

  // The bug this exists to stop. On a chained approval the row is confirmed by
  // the *previous approver* from their decision modal — so the originator's
  // gate, which mounted before that happened, must reflect the row rather than
  // whatever was true when it mounted.
  it("reports sent for a row someone else already confirmed", () => {
    expect(
      gateMode({
        row: row({ approverUserId: "grace-1" }),
        assignedApprover: { userId: "grace-1", name: "Grace Hopper", email: "grace@corp.test" },
      }),
    ).toBe("sent");
  });

  it("reports sent for an email-only assignment, which has no user id", () => {
    expect(
      gateMode({
        row: row({ approverEmail: "external@partner.test" }),
        assignedApprover: { userId: null, name: null, email: "external@partner.test" },
      }),
    ).toBe("sent");
  });

  // Until the row has been read there is nothing to decide between; flashing
  // the confirm form makes a re-opened session feel as if the approver must be
  // re-entered.
  it("waits while the row has not been read yet", () => {
    expect(gateMode({ row: null, assignedApprover: null })).toBe("loading");
  });
});

describe("sentApproverLabel", () => {
  it("prefers the assigned approver's name", () => {
    expect(
      sentApproverLabel({
        userId: "grace-1",
        name: "Grace Hopper",
        email: "grace@corp.test",
      }),
    ).toBe("Grace Hopper");
  });

  it("falls back to the address when the account has no name", () => {
    expect(sentApproverLabel({ userId: "grace-1", name: null, email: "grace@corp.test" })).toBe(
      "grace@corp.test",
    );
  });

  // Better than rendering "null" at the reader, which is what the old
  // suggestion-derived fallback did for a row assigned by user id.
  it("stays readable when neither is known", () => {
    expect(sentApproverLabel(null)).toBe("the approver");
  });
});
