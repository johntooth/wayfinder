# Phase — Approval Flow Fixes

- **Status**: Awaiting review
- **Target version**: 0.22.2  (bump: PATCH — no schema change, no new step type,
  no new feature; seven defects and affordance gaps in an already-shipped flow)
- **Base branch**: `release/alpha-2` (stabilisation only — see CLAUDE.md
  *Release Branching*)
- **ADRs**: ADR-018 (approver grant / email-only assignment), ADR-026 (chat turn
  orchestration + confirmation), ADR-040 (approval subject + frozen record),
  ADR-043 (attestation), ADR-044 (change-request routing), ADR-045 (approver
  edit-before-deciding)
- **Depends on**: the shipped approval node, the pre-generation readiness gate,
  and the chat stream route as they stand on `release/alpha-2`

## 1. Problem

Seven separate defects, all reported from one run through a two-approval flow.
They are grouped here because five of the seven touch the same three files and
fixing them independently would mean three passes over the same code.

1. **The readiness gate fails silently.** When the end-of-step cross-check
   fails, the pass path's explicit note has no counterpart: the only thing the
   user sees is a model-written follow-up, which is free to omit both what the
   review found and what it now needs.
2. **The `/approvals` decision modal is a bare comment box.** It shows neither
   what is being approved nor who the approver is, and it offers no way to
   nominate the next approver, so a two-approval flow stalls the moment the
   first decision is recorded.
3. **Hydration mismatch on the chats list.** React re-renders the whole tree on
   the client, logging a recoverable error naming `EmptyState`.
4. **"Edit before deciding" is refused** — *"The document is locked after
   approval."* — for the second approver in a chain, and for the originator
   after a change request routes work back to them.
5. **The approver is unnamed** in the approval selection input, in the chat gate
   and in the modal alike, whenever the node carries no `roleHint`.
6. **Decision messages read as if the AI wrote them.** They carry the AI avatar
   and no decider, no email and no decision time.
7. **The chat turn crashes after an approval decision** with
   `AI_UnsupportedFunctionalityError: 'Multiple system messages that are
   separated by user/assistant messages'`, leaving the user on "The assistant
   couldn't reply". The approver's comment is also absent from the thread the
   model reasons over, so it never reaches gathered insights.

## 2. Root causes

Each is named here because several of the reported symptoms are two steps
removed from the line that causes them.

1. `executeTurn`'s fail path streams `streamGapFollowup` and nothing else. The
   pass path calls `writeCrossCheckPassNote`; the fail path has no sibling, so
   the outstanding items reach the user only if the model chooses to repeat
   them.
2. `DecisionModal` in `apps/web/src/app/(user)/approvals/_content.tsx` renders a
   `Textarea` and the decision buttons. The approver-selection UI it would need
   lives in `ApprovalGate` and is not extractable as written — it is fused to
   the chat gate's own layout and lifecycle.
3. `useQuery(...).isLoading` is `isPending && isFetching`. During SSR no fetch is
   in flight, so it is **false** and the server renders `EmptyState`; on the
   client's first render the query mounts and begins fetching, so it is **true**
   and the client renders `CardSkeletonGrid`. The two class strings in the
   reported diff are exactly those two components' roots.
4. `IApprovalRepository.hasRecordedSnapshot(sessionId)` is **session-wide**. One
   decided approval anywhere on the session locks every document on it. The
   server already exempts the pending approver (`editedAsPendingApprover`, ADR-045
   §6), but `documentEditability` — which drives the affordance the dialog reads
   — does not, so the UI refuses an edit the server would have allowed. The
   originator after a routed-back change request is blocked by both.
5. `ApprovalGate` renders its role line under `roleHint &&`. Nothing falls back
   to the node's `approverSource`, which is always set.
6. `recordDecisionMessage` writes `role: "system"`. `MessageFeed` renders every
   non-`user` row with the bot avatar, and the row carries no `senderUserId`.
7. `route.ts` maps persisted rows to model messages 1:1, `role` included. Every
   stored `system` row — decision notes, the cross-check pass note, auto/scheduled
   status lines, the approver-edit announcement — is handed to the SDK as a
   system message positioned mid-conversation, which several providers reject
   outright. The same rows are the ones whose content never reaches insights.

## 3. Goals

- The readiness gate always names what it found and what it still needs.
- One approver-selection component, used by the chat gate and the decision
  modal, always naming the approver stage.
- An approver can nominate the next approver without leaving `/approvals`.
- A record is editable while work is genuinely in flight, and frozen after.
- Approval decisions read as messages from the approver, and participate in the
  thread the model reasons over.
- No interleaved system message ever reaches the model.

## 4. Non-goals

No schema change. No change to who may decide an approval, to the frozen
`recordSnapshot`, to the attestation block, or to change-request routing
targets. The approver's read-only session grant (ADR-018) is untouched.

## 5. Approach

Bottom-up (domain → application → adapters → web), writing the test file before
the implementation file for each sub-component (CLAUDE.md). Every new decision
is expressed as a pure function so it is testable without a database: the lock
rule, the stage label, the decision-message builder/parser, and the transcript
mapping.

Two decisions are worth stating because they widen existing behaviour:

**Decision messages become the approver's own turn.** `role: "user"` with
`senderUserId` set to the decider. This is what puts the approver's comment into
the transcript the model sees and into gathered insights, and it is why item 7's
crash cannot recur through this path: no new interleaved system row is written.

**The record lock thaws while work is in flight.** Locked only when a decided
approval snapshotted the session *and* no approval is pending *and* the session
is not parked on the step. A second approver may therefore edit a document the
first approver already signed. That is deliberate and is the ask: the frozen
`recordSnapshot` still preserves exactly what each approver signed, the edit is
appended to `editHistory`, and `ApproverEditSubjectFields` already announces it
in the thread. Nothing about what was signed is rewritten by a later edit.

## 6. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/approval.ts` | add pure `isRecordLocked({ hasRecordedSnapshot, hasPendingApproval, sessionIsOnStep })` |
| domain | `packages/domain/src/entities/approval-decision-message.ts` *(new)* | `buildApprovalDecisionMessage(...)` — the one writer of the decision message's text |
| application | `packages/application/src/use-cases/approvals/decide-approval.ts` | `recordDecisionMessage` writes `role: "user"` + `senderUserId`, content from the domain builder |
| application | `packages/application/src/use-cases/approvals/list-pending-approvals-with-context.ts` | add `approvalStepName`, `roleHint` to `PendingApprovalContext` |
| application | `packages/application/src/use-cases/document/update-document-fields.ts` | guard uses `isRecordLocked` instead of the bare snapshot flag |
| application | `packages/application/src/use-cases/document/update-structured-output.ts` | same |
| web | `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` | `buildCrossCheckGapNote` / `writeCrossCheckGapNote` / `persistCrossCheckGapNote` |
| web | `apps/web/src/app/api/chat/[sessionId]/stream/execute-turn.ts` | stream + persist the gap note on a failed gate |
| web | `apps/web/src/app/api/chat/[sessionId]/stream/model-messages.ts` *(new)* | pure `toModelMessages(rows)` — collapses stored system rows into bracketed user notes |
| web | `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` | build `coreMessages` through `toModelMessages` |
| web | `apps/web/src/server/routers/document.ts` | `documentEditability` takes the three lock inputs; `getFields` supplies them |
| web | `apps/web/src/server/routers/approval.ts` | `decide` returns `nextApproval` resolved from `newNodeId` |
| web | `apps/web/src/components/chat/approver-label.ts` *(new)* | pure `approverStageLabel({ approverSource, roleHint })` |
| web | `apps/web/src/components/chat/approver-picker.tsx` *(new)* | the shared selector: stage label, suggestion, search, confirm & send, manual fallback |
| web | `apps/web/src/components/chat/approval-gate.tsx` | rewired onto `ApproverPicker` |
| web | `apps/web/src/lib/approval-decision-message.ts` *(new)* | parser + local-time formatter for the decision message |
| web | `apps/web/src/components/chat/message-feed.tsx` | render a parsed decision as an approver-attributed bubble |
| web | `apps/web/src/app/(user)/approvals/_content.tsx` | modal gains subject, preview, stage label, and the inline next-approver picker |
| web | `apps/web/src/app/(user)/chats/_content.tsx` *(and sibling list pages)* | `isLoading` → `isPending` |

## 7. Implementation steps (test-first per CLAUDE.md)

1. **Domain — lock rule.** `approval.test.ts` first: locked only with a
   snapshot, no pending approval and the session off the step; each of the three
   thaw conditions unlocks independently. Then implement `isRecordLocked`.

2. **Domain — decision message.** `approval-decision-message.test.ts` first:
   name/email/ISO timestamp present; comment appended when set; routing error
   appended when set; a null name falls back to the email, and a null email is
   omitted rather than printed empty. Then implement the builder.

3. **Application — decision message row.** Extend `approvals.test.ts`: the
   recorded row is `role: "user"` with `senderUserId` equal to the decider, and
   its content is the builder's output. Then change `recordDecisionMessage`.

4. **Application — lock rule adoption.** Extend `update-document-fields.test.ts`
   and `update-structured-output.test.ts`: a snapshot alone no longer refuses
   when an approval is pending or the session sits on the step; the fully
   settled case still refuses. Then thread the new inputs through both guards.

5. **Application — pending-approval context.** Extend the list use-case's tests
   for `approvalStepName` / `roleHint`, including the missing-node fallback.
   Then implement.

6. **Web — transcript mapping.** `model-messages.test.ts` first: user and
   assistant rows pass through unchanged; a system row becomes a bracketed user
   note; several system rows separated by user/assistant rows produce **no**
   system-role message at all. Then implement and wire into `route.ts`.

7. **Web — gap note.** Extend `turn-helpers.test.ts` (note names each item;
   empty list yields the generic line) and `execute-turn.test.ts` (a failed gate
   streams and persists the note before the follow-up). Then implement.

8. **Web — document editability.** Extend `document.test.ts`: `getFields`
   reports `editable` for a pending approver's subject step and for a step the
   session has been routed back to; still locked once settled. Then implement.

9. **Web — stage label.** `approver-label.test.ts` first, covering all three
   `approverSource` values plus the `roleHint` override and the fallback. Then
   implement.

10. **Web — shared picker.** Extract `ApproverPicker` from `ApprovalGate` and
    rewire the gate onto it, keeping `approval-gate-state.ts` as the pure
    seam it already is. The gate's existing behaviour must not change beyond
    the stage label always rendering.

11. **Web — decision modal.** `decide` returns `nextApproval`; the modal renders
    the subject, the step preview and the stage label, and on an approve that
    lands on another approval node reveals `ApproverPicker` inline before the
    queue refreshes.

12. **Web — approver-attributed messages.** `approval-decision-message.test.ts`
    (web parser) first: round-trips the domain builder's output, and returns
    null for anything else so unrelated messages render verbatim. Then render
    it in `MessageFeed`.

13. **Web — hydration.** Switch the affected list pages from `isLoading` to
    `isPending` so server and first client render agree.

14. **E2E.** `apps/web/e2e/enhance-approval-flow-fixes.spec.ts` — written, not
    run (CI runs it).

15. **Version + validate.** Bump `VERSION` and root `package.json#version` to
    `0.22.2`; run `./validate.sh`; move this doc to
    `docs/development/implemented/alpha-2/v0.22.2/` with an implementation
    summary.

## 8. Acceptance criteria

- [ ] A failed end-of-step cross-check always streams and persists a note naming
      the outstanding items, before the model's follow-up.
- [ ] The `/approvals` decision modal shows what is being approved, the previous
      step, and the approver stage.
- [ ] Approving into a second approval step offers the next-approver picker
      inline; confirming sends the request without leaving `/approvals`.
- [ ] The approver stage is always shown in both surfaces, `roleHint` or not.
- [ ] "Edit before deciding" opens for a pending approver, and for the
      originator after a change request routes work back.
- [ ] A settled session's record is still locked.
- [ ] Decision messages show the decider's name, email and local decision time,
      and are attributed to the approver, not the assistant.
- [ ] A chat turn taken after an approval decision completes; no system-role
      message is ever emitted mid-conversation.
- [ ] The chats list hydrates without a recoverable error.
- [ ] `VERSION` = `package.json#version` = `0.22.2`; `./validate.sh` passes.

## 9. Risks

- **Widened edit window (item 4).** A pending second approval now lets the
  originator edit a document the first approver signed. Mitigated by the frozen
  `recordSnapshot`, `editHistory`, and the existing in-thread announcement — but
  it is a real widening and is called out here rather than buried. Note this is
  the behaviour ADR-045 §6 already specifies ("a later edit … by the originator
  after a change request, or by a second approver"); the session-wide lock was
  preventing what that ADR describes.
- **Superseded attestations become reachable (ADR-045 §6, open for build).**
  Post-signature edits are refused today, so the open question of whether a
  later edit should mark an earlier attestation block as superseded has never
  had to be answered. Unblocking the edit makes it live: a reader of the latest
  revision can now see a signature that predates the content around it. Out of
  scope for a patch — the hash is never recomputed, so nothing is forged — but
  it should be resolved before this ships beyond alpha, and is flagged here so
  it is not discovered in an audit.
- **Decision messages entering the model transcript (item 6).** They now count
  as user turns, so they reach the readiness grader, the gathered-context
  aggregation and the title generator's user-message count. Intended (it is what
  puts the approver's comment into insights), but it means a decision message
  can influence a later step's extraction.
- **ADR-018 names *the operator* as the confirming human** ("Resolution always
  ends in human confirmation"; `step-approvals.prd.md` §74, §145). Item 2 lets
  the deciding approver confirm the *next* approval's approver, so the request
  continues without bouncing back to the originator. Every ADR-018 guarantee
  survives — a human confirms, "Someone else" is offered, and the suggestion and
  any override are both recorded — but the ADR's wording should gain a line
  saying the confirming human may be the preceding approver. Raised in review;
  recorded here rather than silently widened.
- **Pre-existing PRD drift.** `step-approvals.prd.md` lists multi-stage approval
  chains as out of scope, while `approval-subject.prd.md`, ADR-040 §2, ADR-043
  §6 and ADR-044 all design for consecutive approvals. The newer line governs
  and this phase follows it; the older non-goal is stale and wants a strike-
  through. Not introduced by this phase and not fixed by it.
