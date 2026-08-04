// The text of the message an approver's pre-decision edit posts into the
// session thread. It lives in the domain for the same reason
// `approval-decision-message.ts` does: the web feed parses it back out — to
// show the originator the document that was changed, right beside the notice
// that it was — and a format agreed in two places is a format that drifts.

export interface ApproverEditMessageInput {
  // Null for a deleted or half-populated account. The notice still has to go
  // out: silent third-party mutation of someone's document is the failure mode
  // this exists to prevent (ADR-045 §3).
  editorName: string | null;
  // Field *labels*, not keys. The originator reads "Start date"; `start_date`
  // is an implementation detail they have never been shown anywhere else.
  changedLabels: readonly string[];
}

export const APPROVER_EDIT_PHRASE = "edited this step before deciding the approval:";

const FALLBACK_EDITOR_NAME = "The approver";

// Returns null when nothing changed — an announcement that names no field tells
// the originator only that something happened, which is worse than silence.
export const buildApproverEditMessage = (input: ApproverEditMessageInput): string | null => {
  if (input.changedLabels.length === 0) return null;
  const editor = input.editorName?.trim() || FALLBACK_EDITOR_NAME;
  return `${editor} ${APPROVER_EDIT_PHRASE} ${input.changedLabels.join(", ")}.`;
};
