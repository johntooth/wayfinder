// When a step's generated record stops being editable. The rule is shared by the
// affordance the edit dialog reads and the guards that enforce it, because the
// two disagreeing is what made an approver's permitted edit look forbidden.

export interface RecordLockInput {
  // True once any *decided* approval on the session has frozen a snapshot. A
  // pending row's `recordSnapshot` holds the resolved subject cache (ADR-040 §2)
  // and does not count.
  hasRecordedSnapshot: boolean;
  // True while any approval on the session is still awaiting a decision.
  hasPendingApproval: boolean;
  // True when the session is parked on the step the record belongs to.
  sessionIsOnStep: boolean;
}

// A record freezes once its approval chain has settled, and thaws whenever the
// work is genuinely back in flight. Both thaw conditions are load-bearing:
// an approver still deciding may fix their own subject (ADR-045 §5), and a
// change request routes the session back to a step the operator is expected to
// change (ADR-044 §1). Testing only the snapshot — as this used to — locked the
// second approver out of the very document they were asked to sign.
//
// What was signed is never at risk: each decided approval keeps the
// `recordSnapshot` and verification hash it froze, and the signed revision is
// retained, so a later edit revises the document without rewriting the record
// (ADR-045 §6).
export const isRecordLocked = (input: RecordLockInput): boolean =>
  input.hasRecordedSnapshot && !input.hasPendingApproval && !input.sessionIsOnStep;
