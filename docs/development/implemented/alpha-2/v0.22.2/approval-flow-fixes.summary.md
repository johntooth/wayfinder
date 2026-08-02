# Implementation Summary — Approval Flow Fixes (v0.22.2)

- **Version**: 0.22.2 (bump: **PATCH** — no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Phase**: `approval-flow-fixes.phase.md` (this folder)
- **E2E**: `apps/web/e2e/enhance-approval-flow-fixes.spec.ts`

## What was built

| # | Reported item | Where |
|---|---|---|
| 1 | A failed cross-check names what it found | `stream/turn-helpers.ts`, `stream/execute-turn.ts` |
| 2 | Decision modal carries the selector's content, and the next approver | `chat/approver-picker.tsx`, `(user)/approvals/_content.tsx`, `routers/approval.ts` |
| 3 | Hydration mismatch on the list pages | 19 `_content.tsx` files |
| 4 | "Edit before deciding" is no longer refused | `domain/entities/approval-lock.ts`, `routers/document.ts`, both edit guards |
| 5 | The approver stage is always shown | `chat/approver-label.ts`, both surfaces |
| 6 | Decisions read as the approver's, with name, email and local time | `domain/entities/approval-decision-message.ts`, `chat/message-feed.tsx` |
| 7 | `AI_UnsupportedFunctionalityError` on the turn after a decision | `stream/model-messages.ts`, `stream/route.ts` |

## 1. A failed cross-check now says what failed

The pass path has streamed an explicit note since it shipped; the fail path
streamed only `streamGapFollowup`'s model-written reply. That reply is free to
soften or omit what the review found, so a user could be held on a step with no
statement of why.

`buildCrossCheckGapNote` renders the outstanding items deterministically, and
`executeTurn` streams and persists it between the overruled reply and the
follow-up. When the grader fails on confidence alone and names nothing, the note
says that rather than presenting an empty bullet list.

## 2. One approver selector, and the next approver

`ApproverPicker` is the chat gate's selection UI, extracted whole.
`ApprovalGate` is now only the chat panel's framing around it, and the
`/approvals` decision modal mounts the same component.

`approval.decide` gained `nextApproval`, resolved from the `newNodeId` the
decision returned: when a decision advances the session onto another approval
node, the modal reveals the picker inline so the approver who just decided
nominates who signs next. A chained approval previously sat idle until the
originator reopened the session.

The modal also now shows the stage, the subject statement and the previous-step
preview — the three things the chat gate shows — instead of a bare comment box.

**ADR-018 note.** That ADR says *the operator* confirms the approver. The
confirming human here is the preceding approver. Every guarantee it names still
holds — a human confirms, "Someone else" is always offered, and the suggestion
and any override are both recorded — but the ADR's wording should gain a line.
Raised in doc review and recorded in the phase doc's risks.

## 3. Hydration mismatch

Reported against `EmptyState`, but the mismatch was two components:

`useQuery(...).isLoading` is `isPending && isFetching`. During SSR no fetch is in
flight, so it is **false** and the server rendered `EmptyState`
(`flex flex-col items-center gap-4 py-24 …`). On the client's first render the
query mounts and begins fetching, so it is **true** and the client rendered
`CardSkeletonGrid` (`flex flex-col gap-3`) — the two class strings in the
reported diff.

`isPending` is true in both places, so the gates now agree. Applied to all 19
first-paint list gates, since the bug was identical in every one.
`knowledge/_content.tsx:274` and `errors/_content.tsx:136` are deliberately
untouched: both queries are `enabled`-gated, where `isPending` never resolves
and the skeleton would be permanent.

## 4. The edit lock

`hasRecordedSnapshot(sessionId)` is **session-wide**, so one decided approval
locked every document on the session. Two callers disagreed about what to do
with it: `UpdateDocumentFields` exempted a pending approver
(`editedAsPendingApprover`), while `documentEditability` — which drives the
affordance the dialog actually reads — did not. The dialog therefore refused an
edit the server would have allowed.

`isRecordLocked` in the domain is now the single rule:

```
locked = hasRecordedSnapshot && !hasPendingApproval && !sessionIsOnStep
```

Both thaw conditions are load-bearing. A pending approval means an approver is
still deciding and may fix their own subject (ADR-045 §5). The session sitting
on the step means a change request routed work back there for someone to change
(ADR-044 §1). The affordance and both guards call the same function.

`editedAsPendingApprover` was deleted rather than kept: a pending approver
implies a pending approval, so the flag could no longer change any outcome, and
CLAUDE.md forbids code that cannot.

What was signed is untouched — each decided approval keeps the `recordSnapshot`
and verification hash it froze, and the signed revision is retained. This is the
behaviour ADR-045 §6 already specifies; the session-wide lock was preventing it.

**Consequence worth stating:** a pending second approval now lets the originator
edit a document the first approver signed. That is the ask, and the record
survives it, but it also makes ADR-045 §6's open question live — a reader of the
latest revision can now meet a signature that predates the content around it.
Resolving that (a "superseded by a later edit" note beside the block) is left
open; the hash is never recomputed, so nothing is forged in the meantime.

## 5. The approver stage

`approverStageLabel` maps `approverSource` to "First-level supervisor" /
"Second-level supervisor" / "Nominated approver", with the author's `roleHint`
winning wherever one was given. It is rendered unconditionally in both surfaces;
the gate previously rendered nothing at all when a node carried no hint.

## 6. Decisions are the approver's messages

`buildApprovalDecisionMessage` in the domain is the sole writer of the decision
message's text — outcome, then `Decided by <name> (<email>) at <ISO>.`, then the
comment and any routing note. `parseApprovalDecisionMessage` in the web app
reads it back; `MessageFeed` renders it with the approver's name, email and the
decision moment on the **reader's** clock (the server only knows UTC). Anything
that does not parse renders verbatim, so an operator who happens to type
"Approval granted" is never dressed up as an approver.

The row is written `role: "user"` with `senderUserId` set to the decider, so it
reads as theirs rather than the assistant's — and joins the transcript the next
turn reasons over, which is what puts the approver's comment ("start on Monday
the 3rd") in front of the step that has to act on it.

## 7. The streaming crash

```
AI_UnsupportedFunctionalityError: 'Multiple system messages that are
separated by user/assistant messages' functionality not supported.
```

`route.ts` mapped persisted rows to model messages 1:1, `role` included. Every
stored `system` row — cross-check notes, auto/scheduled step results, quota
messages, the approver-edit announcement, and (before item 6) decision messages —
reached the SDK as a system message positioned mid-conversation.

`toModelMessages` folds those rows into the conversation as marked
`[System note]` user turns. The role is the problem, not the content: these rows
carry outcomes the next turn needs. The genuine system prompt is passed
separately and is untouched. `ExecuteTurnInput.messagesWithNew` and
`StreamGapFollowupInput.messages` were narrowed to `ModelMessage[]` so the
invariant is in the type, not just the mapping.

Item 6 removes the other half of the cause: a decision no longer writes a system
row at all.

## Tests

Written before each implementation file, per CLAUDE.md.

| Layer | File | Covers |
|---|---|---|
| domain | `approval-lock.test.ts` | the lock rule and each thaw condition |
| domain | `approval-decision-message.test.ts` | the message shape, including null name/email |
| application | `approvals.test.ts` | the row is the approver's; no system row is written; the stage name and role hint |
| application | `update-document-fields.test.ts`, `update-structured-output.test.ts` | both guards thaw and refuse correctly |
| web | `model-messages.test.ts` | no system role reaches the model; content survives |
| web | `turn-helpers.test.ts`, `execute-turn.test.ts` | the gap note, and that it precedes the follow-up |
| web | `document.test.ts` | the affordance now matches the guard |
| web | `approver-label.test.ts` | every source, the hint override, the fallback |
| web | `approval-decision-message.test.ts` | round-trips the real domain builder |

`apps/web/e2e/enhance-approval-flow-fixes.spec.ts` covers items 2, 3, 4 and 5
end-to-end. Items 1, 6 and 7 stay at the unit level: each needs a failing
cross-check, a recorded decision or a following model turn, none of which are
deterministic against a live model in the sandbox.
