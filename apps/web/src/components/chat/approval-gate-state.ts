// Pure state for the approver gate: when the picker opens by itself, and what
// the panel's small "info" affordance says. Kept out of the component so both
// can be asserted without rendering.

export interface SetupNotice {
  // Accessible name of the icon button, and the heading of the explanation.
  readonly label: string;
  // The explanation itself, one paragraph per thing that is not configured.
  readonly paragraphs: readonly string[];
}

// No suggestion is what an unconfigured directory looks like from the
// operator's seat, and their next move is the same either way: pick someone.
// So the picker opens itself rather than making them ask for it.
export const picksApproverManually = (hasSuggestion: boolean): boolean => !hasSuggestion;

// The part of the pending row the gate's mode depends on.
export interface GateRow {
  readonly approverUserId: string | null;
  readonly approverEmail: string | null;
}

export interface AssignedApprover {
  readonly userId: string | null;
  readonly name: string | null;
  readonly email: string | null;
}

export type GateMode = "loading" | "choose" | "sent";

// Which face the gate shows, derived from the row every time rather than latched
// when the component mounted.
//
// Latching was the bug: on a chained approval the row is confirmed by the
// *previous approver* from their decision modal, which happens after the
// originator's gate has already mounted and read it. A gate that remembers what
// it saw offers to choose an approver for a request that has already been sent —
// and its Confirm button would overwrite the approver someone else set.
export const gateMode = (input: {
  row: GateRow | null;
  assignedApprover: AssignedApprover | null;
}): GateMode => {
  if (!input.row) return "loading";
  const assigned =
    Boolean(input.row.approverUserId) ||
    Boolean(input.row.approverEmail) ||
    input.assignedApprover !== null;
  return assigned ? "sent" : "choose";
};

// Who the card names. Resolved from the identity actually on the row, not from
// the resolver's suggestion — a chained approval is assigned by user id and
// carries no email of its own, so the suggestion could name the wrong person or
// nobody at all.
export const sentApproverLabel = (assigned: AssignedApprover | null): string =>
  assigned?.name ?? assigned?.email ?? "the approver";

const NO_SUGGESTION =
  "Wayfinder suggests an approver from your reporting line, which an administrator loads from your HR data. Without it — or when the line does not name one person — you choose the approver yourself. Everything after that is unchanged.";

const NO_EMAIL =
  "Sending email is not set up, so Wayfinder records who is approving and gives you a link to pass on yourself. The approver still records their decision in Wayfinder, and the audit record is the same.";

// Absent when nothing needs explaining — the panel then carries no notice at
// all, rather than a reassuring one nobody needs to read.
export const setupNotice = (input: {
  emailConfigured: boolean;
  hasSuggestion: boolean;
}): SetupNotice | null => {
  const paragraphs = [
    ...(input.hasSuggestion ? [] : [NO_SUGGESTION]),
    ...(input.emailConfigured ? [] : [NO_EMAIL]),
  ];
  if (paragraphs.length === 0) return null;
  return {
    label: input.hasSuggestion ? "How this request is sent" : "Why you are choosing the approver",
    paragraphs,
  };
};
