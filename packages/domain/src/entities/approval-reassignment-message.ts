// The text of the message an approver reassignment posts into the session
// thread. Beside `approval-decision-message.ts` and
// `approval-withdrawal-message.ts` for the same reason: the web feed parses
// these back out, and a format agreed in two places is a format that drifts.

export interface ApprovalReassignmentMessageInput {
  // Who moved it. Copied from the row rather than joined at read time
  // (ADR-040 §5), so either may be null for a deleted or half-populated account.
  actorName: string | null;
  actorEmail: string | null;
  // Both null when the request was reassigned before an approver was confirmed.
  previousApproverName: string | null;
  previousApproverEmail: string | null;
  newApproverName: string | null;
  newApproverEmail: string | null;
  reassignedAt: Date;
}

// `Name (email)`, or whichever half is known, or null when neither is.
const identity = (name: string | null, email: string | null): string | null => {
  if (name && email) return `${name} (${email})`;
  return name ?? email;
};

// Leads with the new approver: "who is this with now" is the question the
// author watching the chat is asking.
const openingLine = (input: ApprovalReassignmentMessageInput): string => {
  const next = identity(input.newApproverName, input.newApproverEmail) ?? "a new approver";
  const previous = identity(input.previousApproverName, input.previousApproverEmail);
  return previous
    ? `Approval request reassigned to ${next}, from ${previous}.`
    : `Approval request assigned to ${next}.`;
};

// The timestamp is written in ISO so the reader can render it in their own
// timezone — the server only knows UTC.
const attributionLine = (input: ApprovalReassignmentMessageInput): string => {
  const at = `at ${input.reassignedAt.toISOString()}`;
  const actor = identity(input.actorName, input.actorEmail);
  return actor ? `Reassigned by ${actor} ${at}.` : `Reassigned ${at}.`;
};

export const buildApprovalReassignmentMessage = (
  input: ApprovalReassignmentMessageInput,
): string => `${openingLine(input)}\n${attributionLine(input)}`;
