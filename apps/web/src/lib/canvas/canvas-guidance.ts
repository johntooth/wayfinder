// Onboarding guidance derived from the canvas graph: which steps are stranded,
// and where the "create the next step" prompt belongs. Kept free of React and of
// React Flow's runtime so the rules can be unit-tested on their own.

// Every step component renders at w-56, and a two-line card lands near 78px
// tall. Used until React Flow reports measurements for the node, which it only
// does after the first layout pass.
export const STEP_NODE_WIDTH = 224;
export const STEP_NODE_HEIGHT = 78;

// Clear air between the right-most step and the next-step prompt.
export const NEXT_STEP_GAP = 56;

export interface GuidanceNode {
  id: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  type?: string;
  data: Record<string, unknown>;
}

export interface GuidanceEdge {
  source: string;
  target: string;
  // Mirrors the edge's stored config onto the React Flow edge. Optional because
  // every other guidance rule reads only the graph shape.
  data?: Record<string, unknown>;
}

export interface NextStepAnchor {
  // Where the new step's top-left corner goes, which is what persistence stores.
  position: { x: number; y: number };
  // The height of the step being followed, so the prompt can sit centred in the
  // band the new step will occupy rather than clipped to its top edge.
  nodeHeight: number;
  connectFromNodeId: string | null;
}

/**
 * Steps with no edge in either direction. A stranded step never runs, because
 * the runtime walks edges — so this is the signal behind the canvas warning.
 * A lone step on a fresh canvas is not stranded, it is simply the beginning,
 * hence the two-step floor.
 */
export function findDisconnectedNodeIds(
  nodes: GuidanceNode[],
  edges: GuidanceEdge[],
): string[] {
  if (nodes.length < 2) return [];

  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  return nodes.filter((node) => !connected.has(node.id)).map((node) => node.id);
}

export interface UnclaimedSignatureSlot {
  nodeId: string;
  stepName: string;
  label: string;
}

interface CanvasTemplateField {
  key: string;
  label: string;
  type: string;
}

const configOf = (node: GuidanceNode): Record<string, unknown> =>
  (node.data.config as Record<string, unknown> | undefined) ?? {};

const signatureFieldsOf = (node: GuidanceNode): CanvasTemplateField[] => {
  const fields = configOf(node).documentTemplateFields;
  if (!Array.isArray(fields)) return [];
  return (fields as CanvasTemplateField[]).filter((field) => field?.type === "signature");
};

// Which step an approval signs on, as the canvas can tell. A named subject is
// taken as given. The "last completed step" default stores no subject at all —
// `decodeApprovalSubject` returns undefined for the empty choice — so it is
// resolved the way the runtime will resolve it: the nearest step upstream of the
// approval that declares signatures. Without this, an approval correctly bound
// while sitting on the default claimed nothing, and the advisory fired on a flow
// that was already signed.
//
// Walked backwards only. A step downstream of the approval has not run when it
// decides, so its signature is never the one being signed.
const subjectStepOf = (
  approvalNodeId: string,
  namedSubjectNodeId: string | undefined,
  signatureSteps: Set<string>,
  incoming: Map<string, string[]>,
): string | null => {
  if (namedSubjectNodeId) return namedSubjectNodeId;

  const seen = new Set<string>([approvalNodeId]);
  let frontier = [approvalNodeId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const predecessor of incoming.get(nodeId) ?? []) {
        if (seen.has(predecessor)) continue;
        seen.add(predecessor);
        if (signatureSteps.has(predecessor)) return predecessor;
        next.push(predecessor);
      }
    }
    frontier = next;
  }
  return null;
};

/**
 * Signature slots that no approval step signs. A slot nothing claims renders as
 * an empty line on the finished document — the step completes, the document is
 * produced, and the signature block is simply blank, with nothing at run time to
 * say it was meant to be filled. That makes it a canvas-time warning rather than
 * a runtime one: it is only fixable while the flow is being authored.
 *
 * Claiming mirrors what actually signs at decision time: an approval step whose
 * `signatureFieldKey` names the slot, or — matching the v0.26.2 fallback — an
 * approval step subject to a document step that declares exactly one signature,
 * which is bound even when the config never named it (ADR-043 §5, amended).
 */
export function findUnclaimedSignatureSlots(
  nodes: GuidanceNode[],
  edges: GuidanceEdge[],
): UnclaimedSignatureSlot[] {
  const approvals = nodes.filter((node) => node.type === "approvalNode");

  const signatureSteps = new Set(
    nodes.filter((node) => signatureFieldsOf(node).length > 0).map((node) => node.id),
  );
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  }

  const claimedKeys = new Set<string>();
  const subjectNodeIds = new Set<string>();
  for (const approval of approvals) {
    const config = configOf(approval);
    const subject = config.approvalSubject as { kind?: string; nodeId?: string } | undefined;
    // A described subject names no step, but an explicit key still signs at
    // decision time, so it resolves through the same walk rather than nothing.
    const namedSubjectNodeId = subject?.kind === "step" ? subject.nodeId : undefined;
    const subjectNodeId =
      subjectStepOf(approval.id, namedSubjectNodeId, signatureSteps, incoming) ?? undefined;
    if (subjectNodeId) subjectNodeIds.add(subjectNodeId);

    const key = config.signatureFieldKey;
    // Scoped to the subject step, so an approval signing "signature" on one
    // document cannot silently claim a same-named slot on another.
    if (typeof key === "string" && key && subjectNodeId) {
      claimedKeys.add(`${subjectNodeId}:${key}`);
    }
  }

  const unclaimed: UnclaimedSignatureSlot[] = [];
  for (const node of nodes) {
    const signatures = signatureFieldsOf(node);
    if (signatures.length === 0) continue;

    // The decide-time fallback binds a lone slot for any approval subject to the
    // step. It stops at one — with several, an unnamed key stays unbound — so
    // only the single-slot case is claimed this way.
    const loneSlotBound = signatures.length === 1 && subjectNodeIds.has(node.id);

    for (const signature of signatures) {
      if (claimedKeys.has(`${node.id}:${signature.key}`)) continue;
      if (loneSlotBound) continue;
      unclaimed.push({
        nodeId: node.id,
        stepName: (node.data.name as string | undefined) ?? "a step",
        label: signature.label,
      });
    }
  }

  return unclaimed;
}

const nodeWidth = (node: GuidanceNode): number => node.measured?.width ?? STEP_NODE_WIDTH;
const nodeHeight = (node: GuidanceNode): number => node.measured?.height ?? STEP_NODE_HEIGHT;

// Only conversational steps can be marked as never completing. `toRfNode`
// mirrors the flag onto `data`, but the saved config is the durable source, so
// read both.
const neverCompletes = (node: GuidanceNode): boolean => {
  if (node.type !== "conversationalNode") return false;
  if (node.data.neverDone === true) return true;
  const config = node.data.config as Record<string, unknown> | undefined;
  return config?.neverDone === true;
};

// Right-most on screen, tie-broken by y then id so two steps stacked at the same
// x resolve to the same anchor on every render rather than swapping places.
const rightMostNode = (nodes: GuidanceNode[]): GuidanceNode | null => {
  let rightMost: GuidanceNode | null = null;
  for (const node of nodes) {
    if (!rightMost) {
      rightMost = node;
      continue;
    }
    if (node.position.x !== rightMost.position.x) {
      if (node.position.x > rightMost.position.x) rightMost = node;
      continue;
    }
    if (node.position.y !== rightMost.position.y) {
      if (node.position.y > rightMost.position.y) rightMost = node;
      continue;
    }
    if (node.id > rightMost.id) rightMost = node;
  }
  return rightMost;
};

/**
 * Where the "create the next step" prompt sits, and what it should join to.
 *
 * The prompt is always placed past the right-most step, so it reads as the flow
 * continuing left to right. What it joins to is a separate question: a step is
 * only auto-connected when the graph has exactly one open end, because with
 * several open branches there is no single correct parent and guessing one would
 * silently rewrite the author's intent. The author then draws the edge, which is
 * the gesture the disconnected-steps warning teaches.
 *
 * Returns null when there is nothing to continue from — an empty canvas, or a
 * right-most step that never completes and so can have no successor.
 */
export function findNextStepAnchor(
  nodes: GuidanceNode[],
  edges: GuidanceEdge[],
): NextStepAnchor | null {
  const rightMost = rightMostNode(nodes);
  if (!rightMost) return null;
  if (neverCompletes(rightMost)) return null;

  const withOutgoing = new Set(edges.map((edge) => edge.source));
  const openEnds = nodes.filter((node) => !withOutgoing.has(node.id));

  return {
    position: {
      x: rightMost.position.x + nodeWidth(rightMost) + NEXT_STEP_GAP,
      y: rightMost.position.y,
    },
    nodeHeight: nodeHeight(rightMost),
    connectFromNodeId: openEnds.length === 1 ? openEnds[0]!.id : null,
  };
}

// ── branch rules ─────────────────────────────────────────────────────────────

export interface ForkMissingBranchRule {
  nodeId: string;
  stepName: string;
  missingCount: number;
}

/**
 * Whether this edge leaves a step that forks. A rule states which of several
 * paths to take, so an edge that is the only way out of its step has nothing to
 * decide and carries no indicator.
 */
export function isForkedEdge(edge: GuidanceEdge, edges: GuidanceEdge[]): boolean {
  return edges.filter((candidate) => candidate.source === edge.source).length > 1;
}

const branchRuleOf = (edge: GuidanceEdge): string | undefined => {
  const rule = edge.data?.branchRule;
  if (typeof rule !== "string") return undefined;
  const trimmed = rule.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const stepNameOf = (nodes: GuidanceNode[], nodeId: string): string => {
  const name = nodes.find((node) => node.id === nodeId)?.data.name;
  return typeof name === "string" && name.trim().length > 0 ? name : "this step";
};

/**
 * Forking steps with at least one outgoing edge that states no rule. Nothing
 * fails at run time — the model still picks a branch, but from the destination
 * steps' own descriptions, which say what each step does rather than when to go
 * there. That silent guess is what the advisory exists to prevent.
 */
export function findForksMissingBranchRule(
  nodes: GuidanceNode[],
  edges: GuidanceEdge[],
): ForkMissingBranchRule[] {
  const bySource = new Map<string, GuidanceEdge[]>();
  for (const edge of edges) {
    bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), edge]);
  }

  const forks: ForkMissingBranchRule[] = [];
  for (const [nodeId, outgoing] of bySource) {
    if (outgoing.length < 2) continue;

    const missingCount = outgoing.filter((edge) => branchRuleOf(edge) === undefined).length;
    if (missingCount === 0) continue;

    forks.push({ nodeId, stepName: stepNameOf(nodes, nodeId), missingCount });
  }
  return forks;
}
