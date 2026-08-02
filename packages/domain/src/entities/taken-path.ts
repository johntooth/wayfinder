// The path a session actually took, derived from the steps that produced output.
// A node that never ran has no output and a branch not taken contributes
// nothing, so this is the record of the taken path without a visit history on
// the checkpoint. One resolver serves both "last completed step" (ADR-040 §1)
// and `nearest_editable` (ADR-044 §2) — two would drift.

import type { FlowNodeType } from "./flow-node";

// The only part of a step output this needs. Declared structurally so a caller
// can pass rows straight from the repository.
export interface CompletedStep {
  readonly nodeId: string;
  readonly createdAt: Date;
}

// Node ids most recent first, each appearing once at its latest output — a step
// revisited after a change request should sit at its new position, not its old.
export const takenPathNodeIds = (steps: readonly CompletedStep[]): string[] => {
  const ordered = [...steps].sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime());
  const seen = new Set<string>();
  const path: string[] = [];
  for (const step of ordered) {
    if (seen.has(step.nodeId)) continue;
    seen.add(step.nodeId);
    path.push(step.nodeId);
  }
  return path;
};

// The step whose output most recently preceded the approval and has something to
// approve. Every approval node is skipped, not just the one asking: an approval's
// output is a decision, so resolving to one shows the next approver the previous
// approver's outcome instead of the artefact they are meant to sign (ADR-040 §2).
export const lastCompletedNodeId = (
  steps: readonly CompletedStep[],
  nodeTypes: ReadonlyMap<string, FlowNodeType>,
  approvalNodeId: string,
): string | null =>
  takenPathNodeIds(steps).find(
    (nodeId) => nodeId !== approvalNodeId && nodeTypes.get(nodeId) !== "approval",
  ) ?? null;

// The nearest prior step an operator can actually change. Approval, auto,
// scheduled and MCP nodes are skipped — returning work to one of them is never a
// useful outcome.
export const nearestEditableNodeId = (
  steps: readonly CompletedStep[],
  nodeTypes: ReadonlyMap<string, FlowNodeType>,
  approvalNodeId: string,
): string | null =>
  takenPathNodeIds(steps).find(
    (nodeId) => nodeId !== approvalNodeId && nodeTypes.get(nodeId) === "conversational",
  ) ?? null;
