# Phase — The Document Through an Approval, and Changing the Approver (v0.26.0)

- **Version**: 0.26.0 (bump: **MINOR** — `ReassignApproval` is a new capability)
- **Base branch**: `release/alpha-2`
- **Type**: `/enhance`
- **Follows**: v0.25.0 (withdrawal + the inline gate), same branch

## Why

Operator feedback on the v0.25.0 gate, once withdrawal existed to walk through.
Five reports, four of which are the same underlying fault seen from different
angles: **the generated document disappears exactly when the operator needs it.**

## 1. The document is shown whenever there is one

### What is wrong

`MessageFeed` renders the `DocumentCard` inside the `isAdvancingMsg` branch,
beside the milestone pill. `resolveMilestoneState` only reports `isAdvancing`
for a step the session has **left** (`stepNodeId !== currentNodeId`).

That coupling is invisible until something moves the session *back* onto a
document step — which is exactly what withdrawal now does. The moment a request
is withdrawn, `currentNodeId` becomes the document step again, `isAdvancing`
goes false, and **the document card vanishes from the history**. The file is
still there; the thread simply stops offering it.

The pill and the card were never answering the same question. The pill asks
"did this turn complete a step?". The card asks "does this message carry a
document?" — and that answer does not change because the session came back.

### The change

The card renders whenever `msg.document` exists. The pill stays gated on
`isAdvancingMsg`. A small pure helper (`documentCardState`) carries the rule so
it is testable without a DOM, matching how `milestone-state.ts` already works.

This is what makes items 3 and 4 below true as well; they are the same fault.

## 2. No editing once it has been sent

While the session is parked on an approval node, the author must not be editing
the thing under review. `canEditDocuments` in the chat gains `&& !isApprovalGate`
and the Edit affordance is **hidden**, not disabled — there is nothing the author
can do about it, so a greyed button is only a question they cannot answer.

**Deliberately UI-only, on the author's surface.** ADR-045 §5 keeps the record
*thawed* while an approval is pending so the approver can fix their own subject,
and `isRecordLocked` is unchanged. The approver edits from `/approvals`, a
different surface, and still can. Two different actors, two different answers —
which is why this is not a domain rule change.

## 3. A withdrawal returns the document *and* the ability to edit it

Falls out of 1 and 2 together: back on the conversational step, `isApprovalGate`
is false, so the card returns and Edit reappears with it. That is the
"a withdrawer may want to edit the document directly rather than chat" path — it
needs no separate affordance, only for §1 to stop hiding the card.

## 4. Chatting on after a completed step regenerates the document

No server change. `applyAdvanceSideEffects` already resolves the **newest**
assistant milestone on the completed node and generates into it, so a step
re-completed after a withdrawal produces a fresh document on the new milestone.
The gap was never generation; it was §1 refusing to render the result. Covered
by a test so it cannot regress into a real gap later.

## 5. The composer is hidden while the gate is up

v0.25.0 left the input disabled. A disabled input still occupies the place the
operator's attention goes, and still invites a click that does nothing. While
the session is parked on an approval node the composer is **not rendered**; it
returns when the session leaves the node, which withdrawal now makes reachable.

This reverses the v0.25.0 decision deliberately and at the reporter's
instruction; it is recorded here so the reversal is not read as drift.

## 6. Changing the approver on a request already sent

### What is wrong

On a chained approval — `conversational → approval A → approval B` — the row for
B is raised by **approver A**, who nominates the next signer from their decision
modal (ADR-018, v0.22.2). So B's `requestedByUserId` is A, not the chat's author.

Two consequences for the author watching the chat:

- The gate shows "Awaiting approval" but cannot name the approver. `sentTo` is
  derived from `approverEmail ?? suggestedApprover`, and a row assigned by user
  id has neither — so it reads "the approver", and the mailto has no address.
- **Withdraw does not apply to them.** The v0.25.0 guard is requester-or-admin,
  and the author is neither. The button renders and fails.

### The change

**`approval.suggest` returns `assignedApprover`** — the identity actually on the
row, resolved server-side. Without it the card cannot name the approver or build
a mailto.

**The sent card shows each action only when the viewer can use it:**

| Button | Shown to | Does |
|---|---|---|
| Email approver | anyone on the card | mailto, pre-filled with flow name + approval link. Previously only shown when email was unconfigured; the request stalling is a separate problem from email being unconfigured, and chasing it is the answer to both |
| Update approver | session owner, admin | reopens the picker with the current assignee and request message pre-filled |
| Withdraw | the row's requester, admin | as v0.25.0 |

On a chained row the author sees Email and Update approver, not Withdraw. That
is the correct answer rather than a gap: withdrawing B would drag the session
back past A's completed signature, which is not what "this is with the wrong
person" means.

### `ReassignApproval`

A new use case, because **withdraw-and-resend is the wrong shape for a wrong
recipient** — it moves the session back a step it has no reason to leave, and
discards a signature chain that is still valid.

- Guards: the row is `pending`; the caller is the **session owner or an admin**.
  Not the requester: on a chained row the requester is the previous approver,
  and the person who needs this is the one watching the chat.
- Records the new approver and `isOverride`, and keeps `request_message` —
  editable in the same panel, so a note naming the old approver can be revised
  rather than silently forwarded.
- Audits `approval.reassigned` carrying **both** identities. This is the answer
  to the audit question that put in-place reassignment out of scope in v0.25.0:
  the trail names who moved it, from whom, to whom.
- Posts a thread message, so the author's own chat says who it is with now.
- Emails the new approver (`approval_requested`, a new recipient so the outbox's
  `existsFor` dedupe does not swallow it) and tells the old approver they are off
  it (`approval_reassigned`). Both triggers are TypeScript refinements on a plain
  text column — additive at the database, no migration, the same reasoning as
  `approval_withdrawn`.

The v0.25.0 phase doc lists in-place reassignment as out of scope. That line is
corrected there rather than left to contradict the code.

## 7. Bringing the docs along

Reassignment is a new transition on a pending row, by an actor the PRD does not
mention. Two doc edits land with the code, matching how v0.25.0 handled
withdrawal:

- **ADR-018** — the *Withdrawal* section gains a *Reassignment* sibling: who may
  reassign and why it is the session owner rather than the requester, that only
  an open request can move, that the audit entry names both approvers, and that
  the decided chain behind it is untouched.
- **`step-approvals.prd.md`** — a user story ("As an operator, I can change who
  a still-open request is with, without pulling the work back a step"), a
  matching acceptance criterion, and `approval.reassign` added to the §7 tRPC
  list.

The v0.25.0 phase doc's out-of-scope line ("Reassigning an approval to a
different approver in place") is corrected in place, with a pointer here.

## Contract changes

| Layer | Change |
|---|---|
| `domain/entities/approval-reassignment-message.ts` | new |
| `domain/entities/notification-log.ts` | `NotificationTrigger` gains `approval_reassigned` |
| `application/use-cases/approvals/reassign-approval.ts` | new |
| `application/use-cases/approvals/suggest-approver.ts` | returns `assignedApprover` |
| `application/use-cases/notifications/notify-on-approval-reassigned.ts` | new |
| `adapters/db/schema/wayfinder.ts` | `approval_reassigned` enum refinement (no SQL) |
| `apps/web/server/routers/approval.ts` | `reassign` mutation |
| `apps/web/components/chat/message-feed.tsx` | document card decoupled from the milestone |
| `apps/web/components/chat/approver-picker.tsx` | three-button sent state, update panel |
| `apps/web/chats/[sessionId]/_content.tsx` | composer hidden; `canEditDocuments` |

**No migration.** Nothing in this phase adds a column.

## Testing

| Change | Unit | E2E |
|---|---|---|
| 1 | `document-card-state.test.ts` — a message with a document shows the card whether or not its step is current; the pill still needs an advance | `enhance-chat-approval-withdraw-inline.spec.ts` |
| 2 | — (a rendering condition; asserted in e2e) | same — Edit hidden while pending |
| 3 | `document-card-state.test.ts` — the card survives the session returning to the step | same — document still downloadable after withdrawal |
| 4 | `approvals.test.ts` — a step re-completed after a withdrawal generates onto the newest milestone | same |
| 5 | — | same — composer absent while the gate is up, present after withdrawal |
| 6 | `approvals.test.ts` — reassign guards (owner ok, admin ok, third party `FORBIDDEN`, decided row `VALIDATION_FAILED`); both identities audited; request message carried and revisable; old and new approver both notified; `suggest` names the assigned approver | `enhance-chat-approval-reassign.spec.ts` |

## Risks

| Risk | Mitigation |
|---|---|
| Decoupling the card from the milestone double-renders a document | The approver-edit card resolves a *different* message's document onto a system announcement and is unchanged; the pure helper is tested for the one-card-per-document-message case |
| Reassignment races a decision | Same `updateIfPending` guard the decision and withdrawal use — a decision landing first makes the reassign fail with `VALIDATION_FAILED` |
| The old approver keeps a stale queue entry | The row stays `pending` but is no longer assigned to them, so `listPendingForApprover` stops matching; they are emailed as well |
| Reassignment is mistaken for a governance bypass | It cannot change *what* is approved or any decided row — only who the open request is addressed to, audited with both identities and announced in the thread |
| Hiding the composer strands an operator on a stuck approval | The gate itself carries every action: Email, Update approver, Withdraw. That is what §6 widens the button set for |

## Out of scope

- Reassigning a **decided** approval. An immutable decision record (ADR-040 §3)
  cannot have its approver rewritten after the fact.
- Letting the author edit the document while a request is pending. §2 hides the
  affordance; the way to edit is to withdraw, which §3 makes a first-class path.
- Any change to `isRecordLocked` or ADR-045 §5's approver-edit thaw.
