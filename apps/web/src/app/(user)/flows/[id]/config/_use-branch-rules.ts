import { useCallback, useMemo, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { BranchRuleTarget } from "@/components/canvas/branch-rule-modal";

// Everything the canvas needs to show and edit branch rules on forked
// connectors. Extracted from the config page so that file stays under the
// source-size ceiling; the memo and callback bodies are unchanged.

export interface BranchRules {
  // Edges with the badge's click handler attached, ready for the canvas.
  displayEdges: Edge[];
  // The edge whose rule is being edited, resolved to step names, or null.
  branchRuleTarget: BranchRuleTarget | null;
  saveBranchRule: (edgeId: string, rule: string | null) => void;
  closeBranchRule: () => void;
}

export const useBranchRules = (
  rfNodes: Node[],
  rfEdges: Edge[],
  setRfEdges: React.Dispatch<React.SetStateAction<Edge[]>>,
  persistRule: (edgeId: string, rule: string | null) => void,
  markEdited: () => void,
): BranchRules => {
  const [branchRuleEdgeId, setBranchRuleEdgeId] = useState<string | null>(null);

  // The badge's click handler is attached here rather than stored on the edge,
  // so an edge freshly created by a drag carries it without the create path
  // having to remember to.
  const displayEdges = useMemo(
    () =>
      rfEdges.map((edge) => ({
        ...edge,
        data: { ...edge.data, onOpenRule: setBranchRuleEdgeId },
      })),
    [rfEdges],
  );

  const branchRuleTarget = useMemo((): BranchRuleTarget | null => {
    if (!branchRuleEdgeId) return null;
    const edge = rfEdges.find((candidate) => candidate.id === branchRuleEdgeId);
    if (!edge) return null;

    const stepName = (nodeId: string): string => {
      const name = (rfNodes.find((node) => node.id === nodeId)?.data as { name?: string } | undefined)
        ?.name;
      return name && name.trim().length > 0 ? name : "an unnamed step";
    };

    return {
      edgeId: edge.id,
      fromStepName: stepName(edge.source),
      toStepName: stepName(edge.target),
      rule: (edge.data as { branchRule?: string } | undefined)?.branchRule ?? "",
    };
  }, [branchRuleEdgeId, rfEdges, rfNodes]);

  const saveBranchRule = useCallback(
    (edgeId: string, rule: string | null) => {
      const trimmed = rule?.trim() ?? "";
      const stored = trimmed.length > 0 ? trimmed : undefined;
      setRfEdges((eds) =>
        eds.map((edge) =>
          edge.id === edgeId ? { ...edge, data: { ...edge.data, branchRule: stored } } : edge,
        ),
      );
      setBranchRuleEdgeId(null);
      markEdited();
      persistRule(edgeId, stored ?? null);
    },
    [setRfEdges, markEdited, persistRule],
  );

  const closeBranchRule = useCallback(() => setBranchRuleEdgeId(null), []);

  return { displayEdges, branchRuleTarget, saveBranchRule, closeBranchRule };
};
