import { describe, expect, it } from "vitest";
import { approverStageLabel } from "./approver-label";

describe("approverStageLabel", () => {
  it("names the structural levels so an approver knows which signature they are", () => {
    expect(approverStageLabel({ approverSource: "first_level_supervisor", roleHint: null })).toBe(
      "First-level supervisor",
    );
    expect(approverStageLabel({ approverSource: "second_level_supervisor", roleHint: null })).toBe(
      "Second-level supervisor",
    );
  });

  // A dynamic approver is named by policy, not by the reporting chain, so the
  // author's role steer is the only meaningful description of who is wanted.
  it("prefers the author's role hint when one was given", () => {
    expect(
      approverStageLabel({ approverSource: "dynamic", roleHint: "SES Band 1 delegate" }),
    ).toBe("SES Band 1 delegate");
  });

  it("uses the role hint over the structural level too", () => {
    expect(
      approverStageLabel({ approverSource: "first_level_supervisor", roleHint: "Hiring manager" }),
    ).toBe("Hiring manager");
  });

  // Never empty: the label is always rendered, so an unconfigured dynamic node
  // has to resolve to something a person can read.
  it("falls back to a generic label when a dynamic node has no hint", () => {
    expect(approverStageLabel({ approverSource: "dynamic", roleHint: null })).toBe(
      "Nominated approver",
    );
  });

  it("ignores a blank role hint", () => {
    expect(approverStageLabel({ approverSource: "dynamic", roleHint: "   " })).toBe(
      "Nominated approver",
    );
  });
});
