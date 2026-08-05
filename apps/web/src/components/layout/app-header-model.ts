import type { StepRailItem } from "@/lib/flow-utils";

export type StepState = "pending" | "current" | "complete";

// Line two of the header exists only when there are steps to draw. A page
// without them renders a single-line header rather than an empty band.
export const hasStepLine = (steps: readonly StepRailItem[]): boolean => steps.length > 0;

export const stepState = (
  step: StepRailItem,
  currentNodeId: string | null,
  completedNodeIds: readonly string[],
): StepState => {
  if (step.nodeId === null) return "pending";
  if (completedNodeIds.includes(step.nodeId)) return "complete";
  if (step.nodeId === currentNodeId) return "current";
  return "pending";
};
