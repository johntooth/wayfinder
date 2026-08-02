import { describe, expect, it } from "vitest";
import { lastCompletedNodeId, nearestEditableNodeId, takenPathNodeIds } from "./taken-path";

const at = (iso: string) => new Date(iso);

const output = (nodeId: string, iso: string) => ({ nodeId, createdAt: at(iso) });

describe("takenPathNodeIds", () => {
  it("returns the nodes that produced output, most recent first", () => {
    const path = takenPathNodeIds([
      output("intake", "2026-08-01T10:00:00Z"),
      output("draft", "2026-08-01T11:00:00Z"),
      output("review", "2026-08-01T12:00:00Z"),
    ]);

    expect(path).toEqual(["review", "draft", "intake"]);
  });

  it("keeps a node once, at its most recent output", () => {
    const path = takenPathNodeIds([
      output("draft", "2026-08-01T10:00:00Z"),
      output("intake", "2026-08-01T11:00:00Z"),
      output("draft", "2026-08-01T12:00:00Z"),
    ]);

    expect(path).toEqual(["draft", "intake"]);
  });

  it("omits a branch that never ran", () => {
    const path = takenPathNodeIds([
      output("intake", "2026-08-01T10:00:00Z"),
      output("branch_a", "2026-08-01T11:00:00Z"),
    ]);

    expect(path).not.toContain("branch_b");
  });

  it("returns nothing when no step has produced output yet", () => {
    expect(takenPathNodeIds([])).toEqual([]);
  });
});

describe("lastCompletedNodeId", () => {
  const nodeTypes = new Map([
    ["intake", "conversational" as const],
    ["draft", "conversational" as const],
    ["enrich", "auto" as const],
    ["approval_a", "approval" as const],
  ]);

  const outputs = [
    output("intake", "2026-08-01T10:00:00Z"),
    output("draft", "2026-08-01T11:00:00Z"),
    output("approval_a", "2026-08-01T12:00:00Z"),
  ];

  it("returns the step whose output most recently preceded the approval", () => {
    const withoutApproval = [
      output("intake", "2026-08-01T10:00:00Z"),
      output("draft", "2026-08-01T11:00:00Z"),
    ];

    expect(lastCompletedNodeId(withoutApproval, nodeTypes, "approval_b")).toBe("draft");
  });

  it("skips a preceding approval so the next approver sees the artefact, not a decision", () => {
    expect(lastCompletedNodeId(outputs, nodeTypes, "approval_b")).toBe("draft");
  });

  it("never returns the approval node asking the question", () => {
    expect(lastCompletedNodeId(outputs, nodeTypes, "approval_a")).toBe("draft");
  });

  it("accepts a non-conversational step that genuinely produced the output", () => {
    const outputs = [
      output("intake", "2026-08-01T10:00:00Z"),
      output("enrich", "2026-08-01T11:00:00Z"),
    ];

    expect(lastCompletedNodeId(outputs, nodeTypes, "approval_a")).toBe("enrich");
  });

  it("returns null when nothing has completed", () => {
    expect(lastCompletedNodeId([], nodeTypes, "approval_a")).toBeNull();
  });
});

describe("nearestEditableNodeId", () => {
  // Only a conversational step gives the operator something to change, so the
  // walk back skips approval, auto, scheduled and MCP nodes.
  const nodeTypes = new Map([
    ["intake", "conversational" as const],
    ["draft", "conversational" as const],
    ["enrich", "auto" as const],
    ["approval_a", "approval" as const],
    ["reminder", "scheduled" as const],
    ["lookup", "mcp" as const],
  ]);

  it("skips approval, auto, scheduled and MCP nodes on the way back", () => {
    const outputs = [
      output("intake", "2026-08-01T09:00:00Z"),
      output("draft", "2026-08-01T10:00:00Z"),
      output("enrich", "2026-08-01T11:00:00Z"),
      output("lookup", "2026-08-01T11:30:00Z"),
      output("reminder", "2026-08-01T11:40:00Z"),
      output("approval_a", "2026-08-01T12:00:00Z"),
    ];

    expect(nearestEditableNodeId(outputs, nodeTypes, "approval_b")).toBe("draft");
  });

  it("returns null when no editable step precedes the approval", () => {
    const outputs = [output("approval_a", "2026-08-01T12:00:00Z")];

    expect(nearestEditableNodeId(outputs, nodeTypes, "approval_b")).toBeNull();
  });

  it("never returns the approval node asking the question", () => {
    const outputs = [
      output("draft", "2026-08-01T10:00:00Z"),
      output("approval_a", "2026-08-01T12:00:00Z"),
    ];

    expect(nearestEditableNodeId(outputs, nodeTypes, "approval_a")).toBe("draft");
  });
});
