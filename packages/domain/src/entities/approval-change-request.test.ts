import { describe, expect, it } from "vitest";
import { outstandingChangeRequests, type ChangeRequestApproval } from "./approval-change-request";

const approval = (
  overrides: Partial<ChangeRequestApproval> & Pick<ChangeRequestApproval, "nodeId" | "status">,
): ChangeRequestApproval => ({
  comment: "Set the start date to 03-03-2026.",
  decidedAt: new Date("2026-03-01T09:00:00.000Z"),
  ...overrides,
});

const nodeNames = new Map([
  ["node-a", "Manager sign-off"],
  ["node-b", "Finance sign-off"],
]);

describe("outstandingChangeRequests", () => {
  it("returns a change request that has not since been approved", () => {
    const requests = outstandingChangeRequests({
      approvals: [approval({ nodeId: "node-a", status: "changes_requested" })],
      nodeNames,
    });

    expect(requests).toEqual([
      {
        nodeId: "node-a",
        stepName: "Manager sign-off",
        comment: "Set the start date to 03-03-2026.",
      },
    ]);
  });

  // A rejection that closed the request cancels the session, so no generation
  // can run behind it — the only rejection that reaches this rule is one that
  // routed the work back, and its comment is exactly as binding.
  it("treats a rejection's comment as a change request", () => {
    const requests = outstandingChangeRequests({
      approvals: [approval({ nodeId: "node-a", status: "rejected" })],
      nodeNames,
    });

    expect(requests).toHaveLength(1);
  });

  it("clears a change request once the same step later approves", () => {
    const requests = outstandingChangeRequests({
      approvals: [
        approval({ nodeId: "node-a", status: "changes_requested" }),
        approval({
          nodeId: "node-a",
          status: "approved",
          comment: null,
          decidedAt: new Date("2026-03-02T09:00:00.000Z"),
        }),
      ],
      nodeNames,
    });

    expect(requests).toEqual([]);
  });

  it("clears a change request when the same step approves with edits", () => {
    const requests = outstandingChangeRequests({
      approvals: [
        approval({ nodeId: "node-a", status: "changes_requested" }),
        approval({
          nodeId: "node-a",
          status: "approved_with_edits",
          comment: null,
          decidedAt: new Date("2026-03-02T09:00:00.000Z"),
        }),
      ],
      nodeNames,
    });

    expect(requests).toEqual([]);
  });

  it("does not let a different step's approval clear it", () => {
    const requests = outstandingChangeRequests({
      approvals: [
        approval({ nodeId: "node-a", status: "changes_requested" }),
        approval({
          nodeId: "node-b",
          status: "approved",
          comment: null,
          decidedAt: new Date("2026-03-02T09:00:00.000Z"),
        }),
      ],
      nodeNames,
    });

    expect(requests.map((request) => request.nodeId)).toEqual(["node-a"]);
  });

  // A re-raised approval on the same step is undecided: the request stands
  // until someone signs it off.
  it("ignores a pending row, so a re-raised approval keeps the request outstanding", () => {
    const requests = outstandingChangeRequests({
      approvals: [
        approval({ nodeId: "node-a", status: "changes_requested" }),
        approval({ nodeId: "node-a", status: "pending", comment: null, decidedAt: null }),
      ],
      nodeNames,
    });

    expect(requests).toHaveLength(1);
  });

  it("skips a decision that carried no comment, having nothing to act on", () => {
    const requests = outstandingChangeRequests({
      approvals: [approval({ nodeId: "node-a", status: "changes_requested", comment: "   " })],
      nodeNames,
    });

    expect(requests).toEqual([]);
  });

  it("returns several outstanding steps oldest first", () => {
    const requests = outstandingChangeRequests({
      approvals: [
        approval({
          nodeId: "node-b",
          status: "changes_requested",
          comment: "Add the risk section.",
          decidedAt: new Date("2026-03-04T09:00:00.000Z"),
        }),
        approval({ nodeId: "node-a", status: "changes_requested" }),
      ],
      nodeNames,
    });

    expect(requests.map((request) => request.stepName)).toEqual([
      "Manager sign-off",
      "Finance sign-off",
    ]);
  });

  it("names a deleted step generically rather than by its id", () => {
    const requests = outstandingChangeRequests({
      approvals: [approval({ nodeId: "node-gone", status: "changes_requested" })],
      nodeNames,
    });

    expect(requests[0]!.stepName).toBe("An approval step");
  });
});
