import { describe, expect, it } from "vitest";
import { buildBranchDescriptors, readBranchRule, withBranchRule } from "./branch-rule";

describe("readBranchRule", () => {
  it("reads the rule from an edge config", () => {
    expect(readBranchRule({ branchRule: "The supplier is overseas" })).toBe(
      "The supplier is overseas",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(readBranchRule({ branchRule: "  spend is over £50k  " })).toBe("spend is over £50k");
  });

  it("returns undefined for a missing key", () => {
    expect(readBranchRule({})).toBeUndefined();
  });

  it("returns undefined for a blank rule, so whitespace never counts as authored", () => {
    expect(readBranchRule({ branchRule: "   " })).toBeUndefined();
  });

  it("returns undefined when the stored value is not a string", () => {
    expect(readBranchRule({ branchRule: 42 })).toBeUndefined();
  });
});

describe("withBranchRule", () => {
  it("sets the rule on an empty config", () => {
    expect(withBranchRule({}, "the applicant is a returning customer")).toEqual({
      branchRule: "the applicant is a returning customer",
    });
  });

  it("leaves unrelated config keys untouched", () => {
    const config = { label: "fast track", weight: 3 };

    expect(withBranchRule(config, "spend is under £1k")).toEqual({
      label: "fast track",
      weight: 3,
      branchRule: "spend is under £1k",
    });
  });

  it("trims the stored rule", () => {
    expect(withBranchRule({}, "  needs legal review  ")).toEqual({ branchRule: "needs legal review" });
  });

  it("removes the key when the rule is cleared", () => {
    expect(withBranchRule({ branchRule: "old rule", label: "keep me" }, null)).toEqual({
      label: "keep me",
    });
  });

  it("removes the key when the rule is blank, so a cleared input does not store whitespace", () => {
    expect(withBranchRule({ branchRule: "old rule" }, "   ")).toEqual({});
  });

  it("does not mutate the config it is given", () => {
    const config = { branchRule: "original" };

    withBranchRule(config, "replacement");

    expect(config).toEqual({ branchRule: "original" });
  });
});

describe("buildBranchDescriptors", () => {
  const node = (id: string, name: string, config: Record<string, unknown> = {}) => ({
    id,
    name,
    config,
  });

  const edge = (toNodeId: string, config: Record<string, unknown> = {}) => ({ toNodeId, config });

  it("uses the edge rule when one is set", () => {
    const descriptors = buildBranchDescriptors(
      [node("a", "Escalate", { doneWhen: "the escalation is logged" })],
      [edge("a", { branchRule: "the claim is over £10,000" })],
    );

    expect(descriptors).toEqual([
      { id: "a", name: "Escalate", rule: "the claim is over £10,000" },
    ]);
  });

  it("falls back to doneWhen when the edge carries no rule", () => {
    const descriptors = buildBranchDescriptors(
      [node("a", "Escalate", { doneWhen: "the escalation is logged" })],
      [edge("a")],
    );

    expect(descriptors).toEqual([
      { id: "a", name: "Escalate", purpose: "the escalation is logged" },
    ]);
  });

  it("falls back to aiInstruction when doneWhen holds the template-complete sentinel", () => {
    const descriptors = buildBranchDescriptors(
      [
        node("a", "Draft", {
          doneWhen: "__TEMPLATE_COMPLETE__",
          aiInstruction: "draft the letter",
        }),
      ],
      [edge("a")],
    );

    expect(descriptors).toEqual([{ id: "a", name: "Draft", purpose: "draft the letter" }]);
  });

  it("falls back to instruction when there is no doneWhen or aiInstruction", () => {
    const descriptors = buildBranchDescriptors(
      [node("a", "Call the API", { instruction: "post the record" })],
      [edge("a")],
    );

    expect(descriptors).toEqual([{ id: "a", name: "Call the API", purpose: "post the record" }]);
  });

  it("carries neither rule nor purpose when the step describes itself nowhere", () => {
    const descriptors = buildBranchDescriptors([node("a", "Next")], [edge("a")]);

    expect(descriptors).toEqual([{ id: "a", name: "Next" }]);
  });

  it("mixes ruled and un-ruled branches in one fork, in edge order", () => {
    const descriptors = buildBranchDescriptors(
      [
        node("fast", "Fast track", { doneWhen: "the order is placed" }),
        node("slow", "Full review", { doneWhen: "the review is signed off" }),
      ],
      [edge("slow", { branchRule: "spend is over £50k" }), edge("fast")],
    );

    expect(descriptors).toEqual([
      { id: "slow", name: "Full review", rule: "spend is over £50k" },
      { id: "fast", name: "Fast track", purpose: "the order is placed" },
    ]);
  });

  it("falls back to the node id as a name when the destination node is missing", () => {
    const descriptors = buildBranchDescriptors([], [edge("ghost")]);

    expect(descriptors).toEqual([{ id: "ghost", name: "ghost" }]);
  });
});
