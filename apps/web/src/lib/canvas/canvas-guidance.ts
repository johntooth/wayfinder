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
