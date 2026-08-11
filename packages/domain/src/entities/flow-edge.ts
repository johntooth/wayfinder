export interface FlowEdge {
  id: string;
  flowId: string;
  fromNodeId: string;
  toNodeId: string;
  // Per-edge authoring data, currently the branch rule (see `branch-rule.ts`).
  // jsonb rather than a dedicated column so a later edge property does not need
  // another migration.
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewFlowEdge {
  flowId: string;
  fromNodeId: string;
  toNodeId: string;
  config?: Record<string, unknown>;
}
