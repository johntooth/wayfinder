import { describe, expect, it } from "vitest";
import { toBranchOptions } from "./branch-options";

const edge = (fromNodeId: string, toNodeId: string, config: Record<string, unknown> = {}) => ({
  fromNodeId,
  toNodeId,
  config,
});

const node = (id: string, name: string) => ({ id, name });

describe("toBranchOptions", () => {
  it("offers only the branches leaving the current step", () => {
    const options = toBranchOptions(
      [edge("current", "a"), edge("current", "b"), edge("elsewhere", "c")],
      [node("a", "Fast track"), node("b", "Full review"), node("c", "Unrelated")],
      "current",
    );

    expect(options.map((option) => option.nodeId)).toEqual(["a", "b"]);
  });

  it("carries each branch's rule so the operator reads the stated condition", () => {
    const options = toBranchOptions(
      [
        edge("current", "a", { branchRule: "spend is under £1,000" }),
        edge("current", "b", { branchRule: "spend is £1,000 or more" }),
      ],
      [node("a", "Fast track"), node("b", "Full review")],
      "current",
    );

    expect(options).toEqual([
      { nodeId: "a", nodeName: "Fast track", rule: "spend is under £1,000" },
      { nodeId: "b", nodeName: "Full review", rule: "spend is £1,000 or more" },
    ]);
  });

  it("leaves the rule undefined for an un-ruled branch rather than inventing one", () => {
    const options = toBranchOptions(
      [edge("current", "a")],
      [node("a", "Fast track")],
      "current",
    );

    expect(options[0]!.rule).toBeUndefined();
  });

  it("treats a blank rule as no rule, so the picker shows no empty caption", () => {
    const options = toBranchOptions(
      [edge("current", "a", { branchRule: "   " })],
      [node("a", "Fast track")],
      "current",
    );

    expect(options[0]!.rule).toBeUndefined();
  });

  it("falls back to the node id when the destination step is missing", () => {
    const options = toBranchOptions([edge("current", "ghost")], [], "current");

    expect(options[0]).toEqual({ nodeId: "ghost", nodeName: "ghost", rule: undefined });
  });

  it("returns nothing when the session is parked on no step", () => {
    expect(toBranchOptions([edge("current", "a")], [node("a", "Fast track")], null)).toEqual([]);
  });

  it("tolerates an edge stored before edges carried config", () => {
    const legacy = { fromNodeId: "current", toNodeId: "a" };

    expect(toBranchOptions([legacy], [node("a", "Fast track")], "current")[0]!.rule).toBeUndefined();
  });
});
