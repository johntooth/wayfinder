import { describe, expect, it } from "vitest";
import { picksApproverManually, setupNotice } from "./approval-gate-state";

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
