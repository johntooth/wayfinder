// Whether a message's document card and its edit affordance are shown. Pure so
// the rules can be unit-tested without a DOM, matching `milestone-state.ts`.

export interface DocumentCardInput {
  hasDocument: boolean;
  // Whether the message also marks a completed-step milestone. Kept as an input
  // so the coupling is visible and deliberately unused: see below.
  isAdvancing: boolean;
}

// A document card asks "does this message carry a document?" — nothing more.
//
// It used to render inside the milestone branch, which additionally required the
// session to have *left* the step. That coupling was invisible until something
// moved the session back onto a document step, which is exactly what a
// withdrawal does: `currentNodeId` returns to the step, the milestone goes
// false, and the document disappeared from the history. The file was still
// there; the thread simply stopped offering it.
//
// The milestone pill still needs the advance. The card never did.
export const showsDocumentCard = (input: DocumentCardInput): boolean => input.hasDocument;

export interface EditAffordanceInput {
  // The session is live, writable and not read-only for this viewer.
  canEditDocuments: boolean;
  // The node permits manual edits at all.
  allowManualEdit: boolean;
  // The session is parked on an approval node, so a request is out for decision.
  isOnApprovalNode: boolean;
}

// The author's edit affordance in the chat. Hidden — not disabled — while a
// request is out: there is nothing the author can do about it until the approval
// resolves or is withdrawn, and a greyed button is only a question they cannot
// answer.
//
// This governs the author's chat surface alone. An approver may still edit their
// own subject step from `/approvals` while the request is pending (ADR-045 §5),
// and `isRecordLocked` is deliberately unchanged — two different actors, two
// different answers.
export const showsEditAffordance = (input: EditAffordanceInput): boolean =>
  input.canEditDocuments && input.allowManualEdit && !input.isOnApprovalNode;
