// A branch rule states *when* a fork should take a given edge. It lives on the
// edge because that is what the condition is about — the destination node's
// `doneWhen`/`aiInstruction` describe what that step does once reached, which is
// a different question and often an unrelated sentence.

const BRANCH_RULE_KEY = "branchRule";

// `doneWhen` may hold a sentinel meaning "the template is complete". That string
// is not guidance for choosing a branch, so it falls through to the instruction.
const TEMPLATE_COMPLETE_SENTINEL = "__TEMPLATE_COMPLETE__";

export const readBranchRule = (config: Record<string, unknown>): string | undefined => {
  const stored = config[BRANCH_RULE_KEY];
  if (typeof stored !== "string") return undefined;
  const trimmed = stored.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

// Returns a new config; a blank or null rule removes the key entirely rather
// than storing an empty string, so "has a rule" is a single check everywhere.
export const withBranchRule = (
  config: Record<string, unknown>,
  rule: string | null,
): Record<string, unknown> => {
  const trimmed = rule?.trim() ?? "";
  const { [BRANCH_RULE_KEY]: _removed, ...rest } = config;
  if (trimmed.length === 0) return rest;
  return { ...rest, [BRANCH_RULE_KEY]: trimmed };
};

// What the branch-choice prompt is built from. Exactly one of `rule`/`purpose`
// is populated: a rule states the condition for taking the branch, a purpose is
// the destination step's own description standing in for one.
export interface BranchDescriptor {
  id: string;
  name: string;
  rule?: string;
  purpose?: string;
}

interface BranchCandidateNode {
  id: string;
  name: string;
  config: Record<string, unknown>;
}

interface BranchCandidateEdge {
  toNodeId: string;
  config: Record<string, unknown>;
}

const describeDestination = (config: Record<string, unknown>): string | undefined => {
  const { doneWhen, aiInstruction, instruction } = config as {
    doneWhen?: string;
    aiInstruction?: string;
    instruction?: string;
  };
  const doneWhenPurpose =
    doneWhen && doneWhen !== TEMPLATE_COMPLETE_SENTINEL ? doneWhen : undefined;
  return doneWhenPurpose ?? aiInstruction ?? instruction;
};

// The single definition of how a fork is described to the model: the edge's own
// rule wins, and an edge without one falls back to the destination step's
// metadata so flows authored before rules existed route exactly as they did.
// Order follows the edges, so the prompt lists branches as the graph holds them.
export const buildBranchDescriptors = (
  nodes: BranchCandidateNode[],
  outgoingEdges: BranchCandidateEdge[],
): BranchDescriptor[] =>
  outgoingEdges.map((edge) => {
    const destination = nodes.find((node) => node.id === edge.toNodeId);
    const name = destination?.name ?? edge.toNodeId;

    const rule = readBranchRule(edge.config);
    if (rule) return { id: edge.toNodeId, name, rule };

    const purpose = describeDestination(destination?.config ?? {});
    if (purpose) return { id: edge.toNodeId, name, purpose };

    return { id: edge.toNodeId, name };
  });
