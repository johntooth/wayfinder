# Phase — Withdrawing an Approval, and the Gate in the Chat (v0.25.0)

- **Version**: 0.25.0 (bump: **MINOR** — one new nullable column on `app_session_approvals`)
- **Base branch**: `release/alpha-2`
- **Type**: `/enhance`

## Why

Two problems with the approval gate as it stands, both reported from the
operator's seat.

1. **A sent request is a one-way door.** Once the operator confirms an approver,
   the session is parked on the approval node until that approver acts. If the
   request went to the wrong person, or the operator spots a mistake in the work
   a moment after sending, there is nothing they can do: no button withdraws it,
   and the only routes out of `pending` belong to the approver. The originator
   raised the request and cannot take it back.

2. **The gate reads as something laid over the chat.** `ApprovalGate` renders a
   full-bleed amber band between the message feed and the composer, at a width
   nothing else in the chat column uses. It looks like an interruption of the
   conversation rather than a step in it.

There is also a gap in what the approver receives. `ConfirmAndSend` sends the
approver a resolved subject and the node's authored `instructions`, but nothing
from the person actually asking. The operator knows why *this* request is going
to *this* approver now, and has no field to say so.

## 1. Withdrawing a request

### The decision to record

Withdrawal is a state change, not an undo. `ApprovalStatus` gains a fifth value,
`withdrawn`, and the row stays: who raised it, who it went to, and that it was
pulled before a decision. Deleting the row would leave the node looking as
though no request was ever made, which is exactly the history an approval trail
exists to keep.

`APPROVED_STATUSES` is untouched, so nothing downstream begins counting a
withdrawal as an approval. The five exhaustive `Record<ApprovalStatus, …>` maps
each gain an entry — the compiler names every one, which is the point of ADR-045
§4's rule against comparing a status to a literal outside the domain.

### Who may withdraw

The originator (`requestedByUserId`), or an admin — mirroring how
`DecideApproval` already lets an admin act on an approver's behalf. Anyone else
gets `FORBIDDEN`. A row that is not `pending` gets `VALIDATION_FAILED`: an
approval already decided cannot be withdrawn, and the guard must be the same
atomic one a decision uses, or a withdraw racing a decision could undo a
recorded outcome.

### Where the session goes

Back to the nearest prior **conversational** step, resolved by the domain's
existing `nearestEditableNodeId`. That resolver already skips approval, auto,
scheduled and MCP nodes, which is precisely "the previous conversational chat
that was part of the flow".

The node's authored `changesRequestedTargetOf` is deliberately **not** consulted.
That target answers a different question — where an *approver* wants work sent
back to — and a withdrawal is the originator's own move.

If no conversational step resolves, the session is **held on the approval node**,
not cancelled, with the reason named in the thread. This is the ADR-044 §3
posture: a routing gap must not become data loss.

### Atomicity and side effects

The status update and the session move share one `unitOfWork.withTransaction`,
using `updateIfPending` so a concurrent decision wins cleanly and the whole
transaction fails rather than leaving a withdrawn row on a session that moved.

After the commit, best-effort and in the order `DecideApproval` already
establishes:

| Effect | Failure posture |
|---|---|
| Audit `approval.withdrawn` | logged; `core_audit_log.action` is plain text, so no schema change |
| Withdrawal message in the thread | swallowed — the row is the source of truth |
| `approval_withdrawn` email to the approver | fire-and-forget via the outbox |

The email matters because the approver may already be part-way through a review.
A request that silently vanishes from their queue is worse than one they are told
was pulled. `NotificationTrigger` is a plain text column with a TypeScript-level
refinement, so the new trigger is additive at the database — the same reasoning
that made `approved_with_edits` migration-free (ADR-045 §4).

### The thread message

A new `approval-withdrawal-message.ts` in the domain, alongside
`approval-decision-message.ts` and for the same reason: the feed parses these
messages back out, and a format agreed in two places is a format that drifts.

Written as the originator's own message, not a system aside — matching the
decision message, and for the identical reason. It leaves no system row
mid-conversation (which several providers reject outright), and the withdrawal
note joins the transcript the next turn reasons over, so "pulled this — the
figures were stale" reaches the step that has to act on it.

## 2. The gate, in the chat

The gate stops being a full-bleed band. It becomes a card constrained to the
composer's own `max-w-[760px]`, rendered in the composer's stack directly above
the input, so it sits in the chat column with everything else rather than
spanning past it.

**The composer stays disabled while an approval is pending.** The gate's own
message field is the only thing typeable. A pending approval means the session
is parked; letting the operator send turns into a step nobody is executing would
be a different change, and not this one.

What does not change: the gate still renders only for `type === "approval"` on an
active, non-read-only session, and `MessageFeed` keeps scrolling behind it.

## 3. A message to the approver

A new nullable `request_message` column on `app_session_approvals`, captured by
an optional textarea above **Confirm & send** and carried into
`ConfirmAndSend`.

It is stored separately from `comment` rather than sharing it. `comment` holds
the *approver's* decision comment, and `DecideApproval` writes it on the same
row — sharing the column would have the decision overwrite the request note and
lose it from the record.

The message reaches the approver twice: in the request email, as a block
attributed to the requester alongside the existing subject and instructions; and
in `list-approvals-with-context`, so it is on screen when they decide.

Not folded into the frozen `recordSnapshot`. The snapshot is what was true at
*decision* time (ADR-040 §3); the request message is an input to the request, and
it is queryable in a column.

## 4. Bringing the docs back in line

Withdrawal is a fourth transition out of `pending`, initiated by a different
actor than the three ADR-018 enumerates. That is an architectural decision, and
the PRD it belongs to currently contradicts it. Two doc edits land with the code:

- **`docs/development/adr/018-approval-step-and-approver-resolution.adr.md`** —
  extended (not superseded) with a *Withdrawal* section under *Decisions and
  effects*: who may withdraw, that the row is recorded rather than deleted, where
  the session returns, and that re-entering the node raises a fresh row exactly as
  ADR-044 §5 already specifies for re-approval after changes. Dated in the header
  alongside the existing 2026-08-02 extension.
- **`docs/development/prd/step-approvals.prd.md`** — a user story ("As an
  operator, I can withdraw a request I raised before it is decided, and pick the
  work back up at the step I was on"), the `status` enum in §8 corrected to
  include both `withdrawn` and the `approved_with_edits` value ADR-045 added
  without updating the PRD, and a matching acceptance criterion.

The `approved_with_edits` correction is in scope because it is the same line of
the same table; leaving one of two known divergences behind would be a choice to
re-do this work later.

## Contract changes

| Layer | Change |
|---|---|
| `domain/entities/approval.ts` | `ApprovalStatus` gains `withdrawn`; `requestMessage` on `Approval`, `NewApproval`, `ApprovalUpdate` |
| `domain/entities/approval-withdrawal-message.ts` | new |
| `domain/entities/notification-log.ts` | `NotificationTrigger` gains `approval_withdrawn` |
| `application/use-cases/approvals/withdraw-approval.ts` | new |
| `application/use-cases/approvals/confirm-and-send.ts` | `requestMessage` input |
| `application/use-cases/notifications/` | withdrawal notifier; request email carries the message |
| `adapters/db/schema/wayfinder.ts` | `request_message` column; `withdrawn` and `approval_withdrawn` enum refinements |
| `adapters/drizzle/0042_*.sql` | `ADD COLUMN request_message text` |
| `apps/web/server/routers/approval.ts` | `withdraw` mutation; `requestMessage` on `confirmAndSend` |
| `docs/adr/018-…` | extended with a *Withdrawal* section |
| `docs/prd/step-approvals.prd.md` | withdrawal user story, §8 status enum, acceptance criterion |

## Risks

| Risk | Mitigation |
|---|---|
| A withdraw racing a decision could undo a recorded outcome | `updateIfPending` inside the transaction — the same atomic guard `DecideApproval` uses. A decision that lands first makes the withdraw fail with `VALIDATION_FAILED` and roll back the session move. |
| Adding a fifth `ApprovalStatus` silently changes a status comparison somewhere | ADR-045 §4's ESLint rule forbids comparing a status to a literal outside the domain, and the five exhaustive `Record<ApprovalStatus, …>` maps fail to compile until each is given a `withdrawn` entry. |
| An approver mid-review loses the request without explanation | The `approval_withdrawn` email, plus the withdrawal message in the session thread. |
| The new column is additive but the migration still runs on a live database | One nullable `ADD COLUMN` with no default and no backfill — non-blocking on Postgres, and existing rows read back as `null`. |
| A flow whose approval has no prior conversational step | The session is held on the approval node with the reason in the thread (ADR-044 §3), never cancelled. Same gap ADR-044 already names for `nearest_editable`. |

## Testing

The `WithdrawApproval` unit tests live in the existing
`approvals.test.ts` rather than a new `withdraw-approval.test.ts`: that file owns
the in-memory repository doubles every approval use case is tested against, and a
second file would have to duplicate ~400 lines of them.

| Change | Unit | E2E |
|---|---|---|
| Withdraw guards | `approvals.test.ts` — originator allowed, admin allowed, third party `FORBIDDEN`, decided row `VALIDATION_FAILED`, missing row `NOT_FOUND` | `enhance-chat-approval-withdraw-inline.spec.ts` |
| Withdraw routing | `approvals.test.ts` — lands on nearest conversational step; holds on the approval node when none resolves | same |
| Withdraw atomicity | `approvals.test.ts` — one transaction; `updateIfPending` returning null leaves the session, the thread and the audit log untouched | — |
| Thread message | `approval-withdrawal-message.test.ts` — attribution line, optional reason | same |
| Request message | `confirm-and-send` persists it; `approval-templates.test.ts` renders and escapes it | same |
| Inline gate | — | same spec asserts the gate is inside the composer stack at the composer's width, and that the input stays disabled |

## Out of scope

- Letting the operator keep chatting while an approval is pending. The composer
  stays disabled; only the gate's framing changes.
- Reassigning an approval to a different approver in place. Withdraw-and-resend
  covers it, and an in-place reassignment has its own audit questions.
- Withdrawing from the `/approvals` list. The button belongs where the
  originator is watching the work, which is the chat.
