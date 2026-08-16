import { describe, expect, it } from "vitest";
import {
  NEXT_STEP_GAP,
  STEP_NODE_HEIGHT,
  STEP_NODE_WIDTH,
  findDisconnectedNodeIds,
  findForksMissingBranchRule,
  findNextStepAnchor,
  findUnclaimedSignatureSlots,
  isForkedEdge,
  type GuidanceEdge,
  type GuidanceNode,
} from "./canvas-guidance";

const step = (
  id: string,
  x: number,
  y = 0,
  overrides: Partial<GuidanceNode> = {},
): GuidanceNode => ({
  id,
  position: { x, y },
  type: "conversationalNode",
  data: {},
  ...overrides,
});

const neverDoneStep = (id: string, x: number, y = 0): GuidanceNode =>
  step(id, x, y, { data: { neverDone: true, config: { neverDone: true } } });

const edge = (source: string, target: string): GuidanceEdge => ({ source, target });

describe("findDisconnectedNodeIds", () => {
  it("returns nothing for an empty canvas", () => {
    expect(findDisconnectedNodeIds([], [])).toEqual([]);
  });

  it("returns nothing for a single step, even with no edges", () => {
    expect(findDisconnectedNodeIds([step("a", 0)], [])).toEqual([]);
  });

  it("finds the step with no edges among connected ones", () => {
    const nodes = [step("a", 0), step("b", 280), step("loose", 560)];
    expect(findDisconnectedNodeIds(nodes, [edge("a", "b")])).toEqual(["loose"]);
  });

  it("treats a step with only an incoming edge as connected", () => {
    const nodes = [step("a", 0), step("b", 280)];
    expect(findDisconnectedNodeIds(nodes, [edge("a", "b")])).toEqual([]);
  });

  it("treats a step with only an outgoing edge as connected", () => {
    const nodes = [step("a", 0), step("b", 280), step("c", 560)];
    expect(findDisconnectedNodeIds(nodes, [edge("b", "c"), edge("c", "a")])).toEqual([]);
  });

  it("returns every loose step in input order", () => {
    const nodes = [step("loose1", 0), step("a", 280), step("loose2", 560), step("b", 840)];
    expect(findDisconnectedNodeIds(nodes, [edge("a", "b")])).toEqual(["loose1", "loose2"]);
  });

  it("reports both steps when two steps share a canvas with no edge at all", () => {
    expect(findDisconnectedNodeIds([step("a", 0), step("b", 280)], [])).toEqual(["a", "b"]);
  });
});

describe("findNextStepAnchor", () => {
  it("returns null for an empty canvas", () => {
    expect(findNextStepAnchor([], [])).toBeNull();
  });

  it("anchors past the right-most step by x, not by insertion order", () => {
    const nodes = [step("far", 900, 40), step("near", 100, 200)];
    const anchor = findNextStepAnchor(nodes, []);
    expect(anchor?.position).toEqual({ x: 900 + STEP_NODE_WIDTH + NEXT_STEP_GAP, y: 40 });
  });

  it("offsets by the measured width when React Flow has reported one", () => {
    const nodes = [step("a", 100, 0, { measured: { width: 300 } })];
    expect(findNextStepAnchor(nodes, [])?.position.x).toBe(100 + 300 + NEXT_STEP_GAP);
  });

  it("reports the measured height so the prompt can centre against the step", () => {
    const nodes = [step("a", 0, 0, { measured: { width: 224, height: 120 } })];
    expect(findNextStepAnchor(nodes, [])?.nodeHeight).toBe(120);
  });

  it("falls back to the default step height before React Flow has measured", () => {
    expect(findNextStepAnchor([step("a", 0)], [])?.nodeHeight).toBe(STEP_NODE_HEIGHT);
  });

  it("connects from the only step when the canvas holds one", () => {
    expect(findNextStepAnchor([step("a", 0)], [])?.connectFromNodeId).toBe("a");
  });

  it("connects from the single open end of a linear chain", () => {
    const nodes = [step("a", 0), step("b", 280), step("c", 560)];
    const edges = [edge("a", "b"), edge("b", "c")];
    expect(findNextStepAnchor(nodes, edges)?.connectFromNodeId).toBe("c");
  });

  it("leaves the new step unconnected when two branches are open", () => {
    const nodes = [step("a", 0), step("b", 280, -120), step("c", 280, 120)];
    const edges = [edge("a", "b"), edge("a", "c")];
    expect(findNextStepAnchor(nodes, edges)?.connectFromNodeId).toBeNull();
  });

  it("connects from the single open end even when it is not the right-most step", () => {
    // The author has dragged the terminal step to the left of an earlier one;
    // the button still sits past the right-most step but joins the real end.
    const nodes = [step("a", 900), step("b", 200)];
    const anchor = findNextStepAnchor(nodes, [edge("a", "b")]);
    expect(anchor?.connectFromNodeId).toBe("b");
    expect(anchor?.position.x).toBe(900 + STEP_NODE_WIDTH + NEXT_STEP_GAP);
  });

  it("leaves the new step unconnected when no step has an open end", () => {
    const nodes = [step("a", 0), step("b", 280)];
    expect(findNextStepAnchor(nodes, [edge("a", "b"), edge("b", "a")])?.connectFromNodeId).toBeNull();
  });

  it("returns null when the right-most step never completes", () => {
    expect(findNextStepAnchor([step("a", 0), neverDoneStep("b", 280)], [edge("a", "b")])).toBeNull();
  });

  it("reads never-done from the saved config when the flag is not mirrored on data", () => {
    const nodes = [step("a", 0, 0, { data: { config: { neverDone: true } } })];
    expect(findNextStepAnchor(nodes, [])).toBeNull();
  });

  it("does not suppress the button for a never-done step that is not right-most", () => {
    const nodes = [neverDoneStep("a", 0), step("b", 280)];
    expect(findNextStepAnchor(nodes, [edge("a", "b")])?.connectFromNodeId).toBe("b");
  });

  it("ignores never-done on step types that cannot carry the flag", () => {
    const nodes = [step("a", 0, 0, { type: "autoNode", data: { config: { neverDone: true } } })];
    expect(findNextStepAnchor(nodes, [])?.connectFromNodeId).toBe("a");
  });

  it("breaks a tie on x by y then id so the anchor never jitters", () => {
    const nodes = [step("b", 400, 300), step("a", 400, 100)];
    expect(findNextStepAnchor(nodes, [])?.position.y).toBe(300);
  });
});

// ── unclaimed signature slots ────────────────────────────────────────────────

const documentStep = (id: string, signatureKeys: string[]): GuidanceNode => ({
  id,
  position: { x: 0, y: 0 },
  type: "conversationalNode",
  data: {
    name: "Draft the instrument",
    config: {
      outputType: "generate_document",
      documentTemplateFields: [
        { key: "amount", label: "Amount", type: "text", optional: false, raw: "Amount" },
        ...signatureKeys.map((key) => ({
          key,
          label: key.replace(/_/g, " "),
          type: "signature",
          optional: true,
          raw: `${key} (approval)`,
        })),
      ],
    },
  },
});

const approvalStep = (id: string, subjectNodeId: string, signatureFieldKey?: string): GuidanceNode => ({
  id,
  position: { x: 300, y: 0 },
  type: "approvalNode",
  data: {
    name: "Sign-off",
    config: {
      approvalSubject: { kind: "step", nodeId: subjectNodeId },
      ...(signatureFieldKey ? { signatureFieldKey } : {}),
    },
  },
});

// An approval left on "the last completed step" — the default — stores no
// subject at all, because `decodeApprovalSubject` returns undefined for the
// empty choice. This is the shape the reported bug was authored in.
const defaultSubjectApprovalStep = (id: string, signatureFieldKey?: string): GuidanceNode => ({
  id,
  position: { x: 300, y: 0 },
  type: "approvalNode",
  data: {
    name: "Sign-off",
    config: { ...(signatureFieldKey ? { signatureFieldKey } : {}) },
  },
});

describe("findUnclaimedSignatureSlots", () => {
  it("reports a signature no approval step signs", () => {
    const slots = findUnclaimedSignatureSlots(
      [documentStep("doc", ["supervisor_signature"])],
      [],
    );

    expect(slots).toEqual([
      { nodeId: "doc", stepName: "Draft the instrument", label: "supervisor signature" },
    ]);
  });

  it("reports nothing once an approval step names the slot", () => {
    expect(
      findUnclaimedSignatureSlots([
        documentStep("doc", ["supervisor_signature"]),
        approvalStep("appr", "doc", "supervisor_signature"),
      ], []),
    ).toEqual([]);
  });

  // Mirrors the decide-time fallback: a subject step with exactly one signature
  // is signed even when the config never named the key (ADR-043 §5, amended).
  it("treats a lone slot as claimed by an approval step subject to that step", () => {
    expect(
      findUnclaimedSignatureSlots([
        documentStep("doc", ["supervisor_signature"]),
        approvalStep("appr", "doc"),
      ], []),
    ).toEqual([]);
  });

  // The fallback stops at one, so the second slot is genuinely unsigned.
  it("still reports the extra slots when a step declares several", () => {
    const slots = findUnclaimedSignatureSlots([
      documentStep("doc", ["first_signature", "second_signature"]),
      approvalStep("appr", "doc", "first_signature"),
    ], []);

    expect(slots.map((slot) => slot.label)).toEqual(["second signature"]);
  });

  it("ignores a step that declares no signature", () => {
    expect(findUnclaimedSignatureSlots([documentStep("doc", [])], [])).toEqual([]);
  });

  // An approval step pointing somewhere else cannot claim this step's slot.
  it("does not let an approval step on another subject claim the slot", () => {
    const slots = findUnclaimedSignatureSlots([
      documentStep("doc", ["supervisor_signature"]),
      documentStep("other", []),
      approvalStep("appr", "other", "supervisor_signature"),
    ], []);

    expect(slots.map((slot) => slot.nodeId)).toEqual(["doc"]);
  });

  // The reported bug: the author picked the slot, but the approval sat on the
  // default subject, which stores no `approvalSubject` — so the claim was
  // scoped to nothing and the advisory fired on a flow that was already bound.
  it("reports nothing when a default-subject approval names the slot", () => {
    expect(
      findUnclaimedSignatureSlots(
        [documentStep("doc", ["supervisor_signature"]), defaultSubjectApprovalStep("appr", "supervisor_signature")],
        [edge("doc", "appr")],
      ),
    ).toEqual([]);
  });

  // The decide-time lone-slot fallback does not care how the subject was
  // resolved, so neither does this.
  it("treats a lone slot as claimed by a default-subject approval downstream of it", () => {
    expect(
      findUnclaimedSignatureSlots(
        [documentStep("doc", ["supervisor_signature"]), defaultSubjectApprovalStep("appr")],
        [edge("doc", "appr")],
      ),
    ).toEqual([]);
  });

  // "The last completed step" is the nearest one upstream, so a slot on an
  // earlier step is not signed by this approval and is still reported.
  it("resolves the default subject to the nearest upstream step declaring signatures", () => {
    const slots = findUnclaimedSignatureSlots(
      [
        documentStep("first", ["early_signature"]),
        documentStep("second", ["late_signature"]),
        defaultSubjectApprovalStep("appr", "late_signature"),
      ],
      [edge("first", "second"), edge("second", "appr")],
    );

    expect(slots.map((slot) => slot.nodeId)).toEqual(["first"]);
  });

  // A step downstream of the approval has not run when the approval decides,
  // so its signature is not the one being signed.
  it("does not resolve the default subject forwards to a later step", () => {
    const slots = findUnclaimedSignatureSlots(
      [defaultSubjectApprovalStep("appr", "supervisor_signature"), documentStep("doc", ["supervisor_signature"])],
      [edge("appr", "doc")],
    );

    expect(slots.map((slot) => slot.nodeId)).toEqual(["doc"]);
  });
});

// ── branch rules ─────────────────────────────────────────────────────────────

const named = (id: string, name: string): GuidanceNode =>
  step(id, 0, 0, { data: { name } });

const ruledEdge = (source: string, target: string, branchRule?: string): GuidanceEdge => ({
  source,
  target,
  data: branchRule === undefined ? {} : { branchRule },
});

describe("isForkedEdge", () => {
  it("is false for the only edge leaving a step — there is nothing to choose between", () => {
    const edges = [ruledEdge("a", "b")];

    expect(isForkedEdge(edges[0]!, edges)).toBe(false);
  });

  it("is true for each edge leaving a step with two outgoing edges", () => {
    const edges = [ruledEdge("a", "b"), ruledEdge("a", "c")];

    expect(isForkedEdge(edges[0]!, edges)).toBe(true);
    expect(isForkedEdge(edges[1]!, edges)).toBe(true);
  });

  it("is false for an edge whose source forks nowhere, alongside a fork elsewhere", () => {
    const edges = [ruledEdge("a", "b"), ruledEdge("a", "c"), ruledEdge("b", "d")];

    expect(isForkedEdge(edges[2]!, edges)).toBe(false);
  });

  it("counts two edges to the same destination as a fork, since each still needs a rule", () => {
    const edges = [ruledEdge("a", "b"), ruledEdge("a", "b")];

    expect(isForkedEdge(edges[0]!, edges)).toBe(true);
  });
});

describe("findForksMissingBranchRule", () => {
  it("returns nothing for a linear flow", () => {
    const nodes = [named("a", "Collect details"), named("b", "Draft the letter")];

    expect(findForksMissingBranchRule(nodes, [ruledEdge("a", "b")])).toEqual([]);
  });

  it("names the forking step when its branches carry no rules", () => {
    const nodes = [named("a", "Triage"), named("b", "Fast track"), named("c", "Full review")];

    const forks = findForksMissingBranchRule(nodes, [ruledEdge("a", "b"), ruledEdge("a", "c")]);

    expect(forks).toEqual([{ nodeId: "a", stepName: "Triage", missingCount: 2 }]);
  });

  it("still reports the fork when only one of its branches is missing a rule", () => {
    const nodes = [named("a", "Triage"), named("b", "Fast track"), named("c", "Full review")];

    const forks = findForksMissingBranchRule(nodes, [
      ruledEdge("a", "b", "spend is under £1k"),
      ruledEdge("a", "c"),
    ]);

    expect(forks).toEqual([{ nodeId: "a", stepName: "Triage", missingCount: 1 }]);
  });

  it("is clean once every branch of the fork has a rule", () => {
    const nodes = [named("a", "Triage"), named("b", "Fast track"), named("c", "Full review")];

    const forks = findForksMissingBranchRule(nodes, [
      ruledEdge("a", "b", "spend is under £1k"),
      ruledEdge("a", "c", "spend is £1k or over"),
    ]);

    expect(forks).toEqual([]);
  });

  it("treats a blank rule as no rule, so whitespace never satisfies the warning", () => {
    const nodes = [named("a", "Triage"), named("b", "Fast track"), named("c", "Full review")];

    const forks = findForksMissingBranchRule(nodes, [
      ruledEdge("a", "b", "   "),
      ruledEdge("a", "c", "spend is £1k or over"),
    ]);

    expect(forks).toEqual([{ nodeId: "a", stepName: "Triage", missingCount: 1 }]);
  });

  it("ignores a single outgoing edge with no rule — a rule there decides nothing", () => {
    const nodes = [named("a", "Collect details"), named("b", "Draft the letter")];

    expect(findForksMissingBranchRule(nodes, [ruledEdge("a", "b")])).toEqual([]);
  });

  it("reports every incomplete fork on the canvas", () => {
    const nodes = [
      named("a", "Triage"),
      named("b", "Fast track"),
      named("c", "Full review"),
      named("d", "Sign off"),
      named("e", "Reject"),
    ];

    const forks = findForksMissingBranchRule(nodes, [
      ruledEdge("a", "b"),
      ruledEdge("a", "c"),
      ruledEdge("c", "d"),
      ruledEdge("c", "e"),
    ]);

    expect(forks.map((fork) => fork.nodeId)).toEqual(["a", "c"]);
  });

  it("falls back to a generic step label when the forking node has no name", () => {
    const nodes = [step("a", 0), named("b", "Fast track"), named("c", "Full review")];

    const forks = findForksMissingBranchRule(nodes, [ruledEdge("a", "b"), ruledEdge("a", "c")]);

    expect(forks[0]!.stepName).toBe("this step");
  });
});
