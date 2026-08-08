// Which actions the "Awaiting approval" card offers, and to whom. Pure so the
// rule is testable without rendering, and so the card can show only what the
// viewer can actually do — a button that fails with FORBIDDEN is worse than no
// button at all.

export interface SentApprovalActionsInput {
  viewerUserId: string | null;
  sessionOwnerUserId: string | null;
  // Who raised the row. On a chained approval this is the *previous approver*,
  // who nominated the next signer from their decision modal (ADR-018, v0.22.2).
  requestedByUserId: string | null;
  isAdmin: boolean;
  // The card is also mounted in the approver's decision modal, where the viewer
  // is the approver and the request is not theirs to manage.
  inChat: boolean;
}

export interface SentApprovalActions {
  canEmail: boolean;
  canUpdateApprover: boolean;
  canWithdraw: boolean;
}

export const sentApprovalActions = (input: SentApprovalActionsInput): SentApprovalActions => {
  if (!input.inChat) {
    return { canEmail: false, canUpdateApprover: false, canWithdraw: false };
  }

  const known = input.viewerUserId !== null;
  const ownsSession = known && input.viewerUserId === input.sessionOwnerUserId;
  const raisedRequest = known && input.viewerUserId === input.requestedByUserId;

  return {
    // Chasing a stalled request is not privileged — anyone looking at the card
    // in the chat can nudge the approver.
    canEmail: true,
    // Gated on the session, not the row: on a chained approval the requester is
    // the previous approver, and the person who needs to fix a wrong assignment
    // is the one watching the chat.
    canUpdateApprover: ownsSession || input.isAdmin,
    // Gated on the row, matching the server. Withdrawing a chained approval
    // would drag the session back past a completed signature, which is not what
    // "this is with the wrong person" means — Update approver is that answer.
    canWithdraw: raisedRequest || input.isAdmin,
  };
};
