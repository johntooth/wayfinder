import type { Approval, ApprovalListScope, ApprovalUpdate, NewApproval } from "../entities/approval";
import type { Result } from "../result";

// How an approver is matched to their approvals. An email-only assignment
// (ADR-018) is raised before the recipient has an account, so both keys are
// needed and `approverEmail` may legitimately be null for a caller who has not
// been assigned anything by address.
export interface ApproverQuery {
  approverUserId: string;
  approverEmail: string | null;
}

export interface IApprovalRepository {
  create(input: NewApproval): Promise<Result<Approval>>;
  findById(id: string): Promise<Result<Approval | null>>;
  // The one open approval gating a node in a session, if any. Used to keep the
  // pending row idempotent — reaching a node twice must not raise two requests.
  findPendingByNode(sessionId: string, nodeId: string): Promise<Result<Approval | null>>;
  // Matches approvals routed by user id and approvals routed only by email. An
  // approval can be assigned by email before the recipient has a user account
  // (ADR-018), so the logged-in user must claim it once their email matches.
  // Excludes approvals whose session was discarded: the originator abandoning a
  // chat must clear the request it raised, not leave it awaiting a decision
  // nobody can act on.
  listPendingForApprover(input: ApproverQuery): Promise<Result<Approval[]>>;
  // The same match widened past `pending`, for the approver's own history.
  // `decided` additionally matches approvals this user decided but is no longer
  // the assignee of — their decision is theirs regardless of later reassignment.
  listForApprover(input: ApproverQuery & { scope: ApprovalListScope }): Promise<Result<Approval[]>>;
  // Every approval raised on a session, newest first. Used to grant an approver
  // read-only access to the session they were asked to sign off on.
  listBySession(sessionId: string): Promise<Result<Approval[]>>;
  update(id: string, patch: ApprovalUpdate): Promise<Result<Approval>>;
  // Applies a patch only while the approval is still pending, returning null
  // when it was already decided. The atomic guard against a double-decide race:
  // two approvers acting at once must not both run the decision side effects.
  updateIfPending(id: string, patch: ApprovalUpdate): Promise<Result<Approval | null>>;
  // True once any *decided* approval in the session has recorded a snapshot —
  // the point after which the snapshot, not the live document, is the governed
  // record. A pending row's `recordSnapshot` holds the resolved subject cache
  // (ADR-040 §2) and is deliberately not counted.
  hasRecordedSnapshot(sessionId: string): Promise<Result<boolean>>;
}
