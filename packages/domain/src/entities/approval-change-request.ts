// What an approver asked to be changed, and whether it still stands. A change
// request routes work back to an earlier step (ADR-044 §1), and that step then
// regenerates its document — so the request has to survive as an instruction the
// regeneration can act on, not just as a line in the chat thread.

import { isApproved, type ApprovalStatus } from "./approval";

// The projection of an approval this rule needs. Narrow on purpose: the caller
// may hold full rows or a repository projection, and neither should have to
// match `Approval` exactly to ask this question.
export interface ChangeRequestApproval {
  nodeId: string;
  status: ApprovalStatus;
  comment: string | null;
  decidedAt: Date | null;
}

export interface ApprovalChangeRequest {
  nodeId: string;
  // The approval step that asked, so the instruction can be attributed in the
  // prompt — "Finance sign-off asked for…" is actionable, a bare comment is not.
  stepName: string;
  comment: string;
}

const FALLBACK_STEP_NAME = "An approval step";

// Outstanding means: the latest *decision* on that approval step asked for a
// change, and no later decision on the same step approved it. Derived rather
// than stored, so a re-raised approval supersedes its predecessor with nothing
// to clear by hand, and a pending row leaves the request standing — undecided is
// not satisfied.
//
// Rejection is treated exactly like a change request. A rejection that closed
// the request cancels the session, so nothing regenerates behind it; the only
// rejection this rule can see on a live session is one that routed the work
// back, and its comment binds the same way.
export const outstandingChangeRequests = (input: {
  approvals: readonly ChangeRequestApproval[];
  nodeNames: ReadonlyMap<string, string>;
}): ApprovalChangeRequest[] => {
  const latestByNode = new Map<string, ChangeRequestApproval>();

  for (const approval of input.approvals) {
    if (!approval.decidedAt) continue;
    const current = latestByNode.get(approval.nodeId);
    if (current && current.decidedAt! >= approval.decidedAt) continue;
    latestByNode.set(approval.nodeId, approval);
  }

  return [...latestByNode.values()]
    .filter((approval) => !isApproved(approval.status))
    .filter((approval) => (approval.comment ?? "").trim().length > 0)
    .sort((first, second) => first.decidedAt!.getTime() - second.decidedAt!.getTime())
    .map((approval) => ({
      nodeId: approval.nodeId,
      stepName: input.nodeNames.get(approval.nodeId) ?? FALLBACK_STEP_NAME,
      comment: approval.comment!.trim(),
    }));
};
