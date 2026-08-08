// The text of the message an approval withdrawal posts into the session thread.
// It lives beside `approval-decision-message.ts` and for the same reason: the
// web feed parses these messages back out, and a format agreed in two places is
// a format that drifts.

export interface ApprovalWithdrawalMessageInput {
  // Copied from the row rather than joined at read time (ADR-040 §5). Either
  // may be null for a half-populated or deleted account.
  originatorName: string | null;
  originatorEmail: string | null;
  // Both null when the request was pulled before an approver was confirmed.
  approverName: string | null;
  approverEmail: string | null;
  withdrawnAt: Date;
  reason: string | null;
  // The step the session returned to, or null when none could be resolved.
  returnedToStepName: string | null;
  // Set when no step could be returned to. The withdrawal still stands and the
  // session is held on the approval node, not cancelled (ADR-044 §3).
  routingError: string | null;
}

// `Name (email)`, or whichever half is known, or null when neither is.
const identity = (name: string | null, email: string | null): string | null => {
  if (name && email) return `${name} (${email})`;
  return name ?? email;
};

const openingLine = (input: ApprovalWithdrawalMessageInput): string => {
  const approver = identity(input.approverName, input.approverEmail);
  return approver
    ? `Approval request withdrawn — taken back from ${approver}.`
    : "Approval request withdrawn.";
};

// The timestamp is written in ISO so the reader can render it in their own
// timezone — the server only knows UTC, and a time shown in the wrong zone is
// worse than one shown as a raw stamp.
const attributionLine = (input: ApprovalWithdrawalMessageInput): string => {
  const at = `at ${input.withdrawnAt.toISOString()}`;
  const originator = identity(input.originatorName, input.originatorEmail);
  return originator ? `Withdrawn by ${originator} ${at}.` : `Withdrawn ${at}.`;
};

export const buildApprovalWithdrawalMessage = (
  input: ApprovalWithdrawalMessageInput,
): string => {
  const parts = [`${openingLine(input)}\n${attributionLine(input)}`];
  if (input.returnedToStepName) parts.push(`Returned to: ${input.returnedToStepName}`);
  if (input.reason) parts.push(`Reason: ${input.reason}`);
  if (input.routingError) parts.push(input.routingError);
  return parts.join("\n\n");
};
