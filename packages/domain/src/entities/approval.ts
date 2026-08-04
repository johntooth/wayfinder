// An approval request raised when a session reaches an `approval` node. The row
// is the source of truth for the decision; the resolver only ever *suggests* an
// approver, and the operator must confirm (or override) before it is sent.

export type ApproverSource =
  | "first_level_supervisor"
  | "second_level_supervisor"
  | "dynamic";

// What is *recorded*. `approved_with_edits` is derived by the system at decision
// time, never selected: an approval earns it when the approver who signed it also
// changed their own subject step while it was pending (ADR-045 §4). A
// self-declared "approved with edits" could be claimed without editing and
// withheld after editing, which makes it worthless exactly where it matters.
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "approved_with_edits"
  | "rejected"
  | "changes_requested";

// The three terminal decisions an approver can *choose*. `pending` is excluded —
// a decision always moves the row out of `pending` — and so is
// `approved_with_edits`, which is not a button. Widening `ApprovalStatus` is
// therefore free at every branch point, because control flow reads the decision.
export type ApprovalDecision = "approved" | "rejected" | "changes_requested";

// Every status that means "this approval approved". The single definition, so a
// caller never has to enumerate the literals itself — an ESLint rule forbids
// comparing an approval status to a literal outside the domain for exactly that
// reason (ADR-045 §4). A future `status === "approved"` would silently exclude
// edited approvals, and no compiler would object.
export const APPROVED_STATUSES: readonly ApprovalStatus[] = ["approved", "approved_with_edits"];

export const isApproved = (status: ApprovalStatus): boolean => APPROVED_STATUSES.includes(status);

// Which slice of an approver's approvals to read. `pending` is their queue —
// what still needs them. `decided` is their history: everything they have
// already ruled on. A flow can hold several decisions for one approval step,
// because a change request routes work back and re-entering the node raises a
// fresh row, so history lists rows rather than steps.
export type ApprovalListScope = "pending" | "decided" | "all";

export interface Approval {
  readonly id: string;
  readonly sessionId: string;
  readonly flowId: string;
  readonly nodeId: string;
  readonly messageId: string | null;
  readonly requestedByUserId: string;
  readonly approverSource: ApproverSource;
  readonly suggestedApproverUserId: string | null;
  readonly approverUserId: string | null;
  readonly approverEmail: string | null;
  readonly isOverride: boolean;
  readonly status: ApprovalStatus;
  readonly decidedByUserId: string | null;
  readonly decidedAt: Date | null;
  readonly comment: string | null;
  // Frozen at decision time and never recomputed (ADR-040 §3). Carries the
  // session's `stepOutputs` alongside a flat, dot-separated record whose keys are
  // prefixed by the approval step's key — `<step_key>.decision`,
  // `.approver_name`, `.approver_email`, `.decided_at` and `.comment` are the
  // guaranteed minimum. Built by `buildApprovalRecord` in `approval-record.ts`.
  readonly recordSnapshot: Record<string, unknown> | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewApproval {
  sessionId: string;
  flowId: string;
  nodeId: string;
  messageId?: string | null;
  requestedByUserId: string;
  approverSource: ApproverSource;
  suggestedApproverUserId?: string | null;
  approverUserId?: string | null;
  approverEmail?: string | null;
  isOverride?: boolean;
  status?: ApprovalStatus;
  recordSnapshot?: Record<string, unknown> | null;
}

export interface ApprovalUpdate {
  approverUserId?: string | null;
  approverEmail?: string | null;
  isOverride?: boolean;
  status?: ApprovalStatus;
  decidedByUserId?: string | null;
  decidedAt?: Date | null;
  comment?: string | null;
  recordSnapshot?: Record<string, unknown> | null;
}
