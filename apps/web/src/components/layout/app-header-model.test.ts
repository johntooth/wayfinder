import { describe, expect, it } from "vitest";
import { hasStepLine, stepState } from "./app-header-model";
import type { StepRailItem } from "@/lib/flow-utils";

const step = (nodeId: string | null, label: string): StepRailItem => ({
  key: nodeId ?? label,
  label,
  title: `Step ${label}`,
  nodeId,
});

// The header folds the step rail in as a second line. Pages without steps must
// collapse to a single line rather than render an empty 30px band — that
// reclaimed vertical space is the point of the consolidation.
describe("hasStepLine", () => {
  it("is false when there are no steps", () => {
    expect(hasStepLine([])).toBe(false);
  });

  it("is true once there is at least one step", () => {
    expect(hasStepLine([step("a", "1")])).toBe(true);
  });
});

describe("stepState", () => {
  const steps = [step("a", "1"), step("b", "2"), step("c", "3")];

  it("marks completed nodes complete", () => {
    expect(stepState(steps[0]!, "b", ["a"])).toBe("complete");
  });

  it("marks the session's current node current", () => {
    expect(stepState(steps[1]!, "b", ["a"])).toBe("current");
  });

  it("marks everything else pending", () => {
    expect(stepState(steps[2]!, "b", ["a"])).toBe("pending");
  });

  it("treats a placeholder step with no node id as pending", () => {
    expect(stepState(step(null, "?"), "b", ["a"])).toBe("pending");
  });

  it("prefers complete over current when a node is both", () => {
    // A never-done step can be the current node while already counted complete;
    // showing it as still-running would contradict the tick beside it.
    expect(stepState(steps[1]!, "b", ["b"])).toBe("complete");
  });
});
