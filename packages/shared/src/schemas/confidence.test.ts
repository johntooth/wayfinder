import { describe, expect, it } from "vitest";
import { branchChoiceSchema } from "./confidence";

describe("branchChoiceSchema", () => {
  it("parses a rationale alongside the branch choice", () => {
    const result = branchChoiceSchema.safeParse({
      rationale: "The request exceeds the approval limit, so escalation applies.",
      branchChoice: "node-b",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.rationale).toBe(
      "The request exceeds the approval limit, so escalation applies.",
    );
    expect(result.data.branchChoice).toBe("node-b");
  });

  it("rejects a payload missing the rationale", () => {
    const result = branchChoiceSchema.safeParse({ branchChoice: "node-b" });

    expect(result.success).toBe(false);
  });
});
