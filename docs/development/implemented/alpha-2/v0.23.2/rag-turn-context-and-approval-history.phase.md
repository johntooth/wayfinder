# Phase — Per-Turn RAG Context, Approval History & Notification Targets

- **Status**: Implemented
- **Target version**: 0.23.2  (bump: PATCH — no schema change, no migration, no
  new step type, no new node; six defects and read-path gaps in shipped
  behaviour)
- **Base branch**: `release/alpha-2` (stabilisation only — see CLAUDE.md
  *Release Branching*)
- **PRDs**: `step-approvals.prd.md` (amended by this phase — see §4.7),
  `approval-subject.prd.md`, `manual-document-editing.prd.md`
- **ADRs**: ADR-016 (pgvector retrieval strategy — Decision 5 revised, see §4.1),
  ADR-017 (configurable embedding providers), ADR-018 (approver resolution /
  federated people search), ADR-024 (manual document field editing), ADR-029
  (hybrid retrieval — Decision 5, inference retrieval stays semantic), ADR-040
  (approval subject + frozen record), ADR-044 (change-request routing), ADR-045
  (approver edit-before-deciding)
- **Depends on**: per-turn retrieval, the two-approval chain, `editHistory` and
  the pre-generation readiness gate as they stand on `release/alpha-2` (v0.23.1)

## 1. Problems

Six reports, all from one run through a guided onboarding flow with a policy
document attached as flow-wide context and two approval steps in sequence.

1. **The AI does not see the flow's policy during the conversation.** The flow
   carries an onboarding policy stating that all new employees must start on a
   Monday. Asked *"are there any options for a start date?"*, the assistant
   answered *"there are no set options — it can be any date that works for you"*.
   The policy is only ever consulted by the end-of-step cross-check.

2. **A discarded chat leaves its approval in the approver's queue.** The
   originator discarded the session; the approver's `/approvals` list still
   shows the request as awaiting them.

3. **An approver cannot see their own decision history.** `/approvals` shows
   only what is currently pending. Once decided, a request vanishes with no way
   to review what was signed, what was commented, or where the work went.

4. **The originator cannot open an approver's edits from the chat.** A second
   approver sees the edited document (and its history) in their queue; the
   author of the chat sees only a one-line system announcement.

5. **The post-decision "notify manually" modal names the wrong person.** On the
   final approval of a two-approval chain it told the second approver to notify
   *Ada Lovelace* — the **first approver**, not the originator, and not anyone
   who needed to act next.

6. **Approver search does not offer existing users.** The "Someone else" picker
   searches Entra and the HR upload. A person who already has a Wayfinder
   account, but is in neither directory, cannot be found by name.

## 2. Root causes

### 2.1 Per-turn retrieval is too narrow, and blind on the opening turn

Two code paths retrieve for a conversational turn, and both hand
`RetrieveDocumentChunks` a single weak query:

- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts:149` passes
  `query: lastUserMessage`.
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts:524`
  (`generateInitialMessage`) passes `query: gatheredContext`, which on the first
  step of a session is the empty string. `RetrieveDocumentChunks.execute`
  returns `ok([])` for a blank query, so **the opening turn of every session
  retrieves nothing at all**.

The flow scope is then searched at `DEFAULT_FLOW_MIN_SIMILARITY = 0.5` with
`DEFAULT_FLOW_LIMIT = 5`
(`packages/application/src/use-cases/session/retrieve-document-chunks.ts:14-17`).
Half a sentence of operator input — *"Joe Bloggs, are there any options for a
start date?"* — embeds to something that does not clear 0.5 against a chunk
whose subject is induction cadence and payroll cycles. Nothing reaches the
prompt, so the model answers from its own priors.

The cross-check catches the rule because it does not use retrieval at all:
`EvaluateStepReadiness` passes `input.flow.contextDocs` — the **full extracted
text** — to `extractStructuredFields` and `gradeDocumentFields`
(`packages/application/src/use-cases/session/evaluate-step-readiness.ts:87`).
So the flow's guidance is doing its job, one gate too late: the operator is led
through the whole step on a false premise and only corrected at the end.

The fix is not to widen the threshold alone. A conversational turn has a second,
better retrieval key that is never used: **the step itself**. The node's
`aiInstruction`, `doneWhen` and declared field labels describe what this step is
about ("capture the new employee's name and start date") in exactly the
vocabulary the guidance document uses. That query would have hit the policy on
turn one, before the operator asked anything.

### 2.2 Discarding a session does not touch its approvals

`session.close` sets `status: "abandoned"` and nothing else
(`apps/web/src/server/routers/session.ts:399`).
`DrizzleApprovalRepository.listPendingForApprover` filters on assignment and
`status = 'pending'` only
(`packages/adapters/src/repositories/drizzle-approval-repository.ts:123`), so a
pending row on a dead session stays in the queue indefinitely.

### 2.3 The approver has one query, and it is pending-only

There is exactly one read path for an approver — `approval.listPending` →
`ListPendingApprovalsWithContext` → `listPendingForApprover` — and every layer
of it is hardcoded to `pending`. A decided approval is unreachable through the
UI even though the row, its comment, its frozen `recordSnapshot` and its
projected step output are all still there.

Note that several decisions on one approval step already exist as separate
rows: `findPendingByNode` matches only `status = 'pending'`, so when a change
request routes work back and the session re-enters the approval node,
`SuggestApprover` raises a **new** row. Listing rows, not steps, therefore gives
the requested "multiple decisions for one approval step" for free.

### 2.4 The document card is rendered only on the advancing message

`message-feed.tsx:290` renders `DocumentCard` inside the `isAdvancingMsg`
branch — beside the milestone pill of the message that completed the step. The
card already carries `DocumentEditHistoryModal` whenever `document.editedAt` is
set (`document-card.tsx:95`), and `document.getFields` already returns a
resolved `editSummary` to any session participant.

So the author *has* the data and *has* the component. What they do not have is
either of them next to the announcement: `ApproverEditSubjectFields.announce`
posts a plain system line
(`approver-edit-subject-fields.ts:120`) far below the card it refers to. The
approver's queue does not have this problem because
`ListPendingApprovalsWithContext.resolvePreviousDocument` re-resolves the latest
document for the subject node and renders a fresh card next to the decision.

A second, smaller defect sits in the same method: `latestEditKeys` returns
`change.key`, so the announcement names raw field keys (`start_date`) rather
than labels (`Start date`).

### 2.5 "Originator" is read off the wrong column

The modal renders `approval.originatorName`
(`apps/web/src/app/(user)/approvals/_content.tsx:273`), which
`ListPendingApprovalsWithContext.buildContext` resolves from
`approval.requestedByUserId`.

For the **first** approval of a session that is the originator. For every
approval after it, it is not: a chained approval is raised through the
`ApproverPicker` mounted inside the previous approver's own decision modal, so
`requestedByUserId` is **the previous approver**. Hence Ada Lovelace — who had
already signed and had nothing left to do — being named as the person to chase.

The modal also assumes there is always someone to hand back to. On the final
approval of a flow the session completes; there is no "pick the request back
up", and the people who should hear about it are the participants.

### 2.6 The people directory has no user source

`SearchPeople` is constructed with `[graphPeopleDirectory, hrPeopleDirectory]`
(`apps/web/src/lib/container.ts:761`). `core_users` is never searched, and
`IUserRepository` has no search method to search it with — only `findById`,
`findByIds`, `findByEmail` and an offset `list`.

De-duplication is not the problem: `mergePeople` already keys on lowercased
email and keeps the highest-ranked record per address
(`packages/application/src/use-cases/people/merge-people.ts:19`). It just never
receives a user-backed list to merge.

## 3. Scope

In scope: the six defects above. No schema change, no migration, no new node
type, no change to how approvals are decided or routed.

Out of scope: reworking the cross-check to use retrieval (it is correct to read
the full guidance — it grades against it); notification transport changes; any
change to the approval status enum (§4.2 is deliberately a query-level fix so it
stays a patch and retroactively clears rows already in a bad state).

## 4. Design

### 4.1 Step-aware, multi-query retrieval

**New** `packages/application/src/use-cases/session/build-retrieval-query.ts` —
pure, no I/O:

```
buildTurnRetrievalQueries(input: {
  nodeConfig: { aiInstruction?, doneWhen?, fields? },
  recentMessages: readonly { role, content }[],
  latestUserMessage: string,
}): string[]
```

Returns up to two non-empty, de-duplicated queries:

1. **The message query** — the latest user message plus the tail of the
   conversation (bounded, most recent first), so a thin reply inherits the
   subject of the turns around it. This is what fixes *"are there any options
   for a start date?"*: on its own it is nearly contentless, but with the
   preceding assistant turn it carries "full name and start date".
2. **The step query** — the node's `aiInstruction`, its `doneWhen` (skipping the
   `__TEMPLATE_COMPLETE__` sentinel, which is not English and would only add
   noise), and its declared field labels. Stable across the whole step, so every
   turn — including the opener, which has no user message — retrieves against
   what the step is for.

`__TEMPLATE_COMPLETE__` is already treated as non-guidance in the branch-purpose
resolver (`stream/route.ts:219`); this reuses that rule rather than restating it.

**Changed** `RetrieveDocumentChunks.execute` accepts `queries: string[]`
alongside the existing single `query` (which stays, so no caller is forced to
change and the extraction paths are untouched). It embeds each distinct query,
searches both scopes per embedding, and merges results **by chunk id keeping the
highest similarity**, then ranks. Two queries mean at most two embedding calls
per turn — the same order of cost as today, against a model whose per-turn spend
is dominated by the completion.

Thresholds: flow scope moves to `DEFAULT_FLOW_MIN_SIMILARITY = 0.25` and
`DEFAULT_FLOW_LIMIT = 8`. The 0.5 floor was set for a curated knowledge base
searched by a well-formed question; a conversational turn is neither. Session
uploads keep 0.2 / 8 — they were already tuned for exactly this problem, and
the comment at the top of that file explains why.

**Relationship to ADR-016 Decision 5.** That decision states that each inference
turn "embeds the user's latest message and retrieves a different top-k set of
chunks", and estimates the injected reference section at ~2 500 tokens (5 × 500).
This phase revises both halves and the ADR should be read accordingly:

- **Two queries, not one.** The step query is the addition. It is *more*
  cache-friendly than the message query, not less: it is stable for the duration
  of a step, so the chunks it contributes change only when the step does. The
  prompt-cache boundary the ADR prescribes (stable structural prompt first,
  `<reference_documents>` appended after) is unchanged and still correct.
- **~8 × 500 flow chunks, not 5 × 500.** The reference section roughly doubles,
  to ~4 000 tokens plus session uploads. This is still far below the ~16 000
  tokens the pre-RAG inline approach injected, so the ADR's cost argument holds;
  the trade is deliberate and is recorded as a risk in §8.
- **Embedding cost per turn doubles.** On the default `local` provider
  (ADR-017 Decision 1, in-process transformers.js) that is CPU time, not spend.
  On `openai` it is two `text-embedding-3-small` calls per turn — at ~$0.02/1 M
  tokens, negligible against the completion.

ADR-029 Decision 5 is untouched: inference retrieval stays semantic. Nothing
here introduces a keyword or fused-score path.

**Changed** both call sites pass `queries`. `generateInitialMessage` gains the
step query, which is the whole of its fix — it stops retrieving on an empty
string.

### 4.2 Hide approvals belonging to discarded sessions

**Changed** `DrizzleApprovalRepository.listPendingForApprover` inner-joins
`app_sessions` and adds `notInArray(app_sessions.status, ['abandoned',
'cancelled'])`. The set of "dead" statuses comes from a single exported domain
constant so the queue, the history list and any future reader cannot disagree.

The approval row itself is untouched — it remains in the audit record, and
nothing is deleted — but it is hidden from *every* approver-facing list while it
is still `pending`, All included. An undecided request on a dead chat is not
history; it is a request nobody can act on, and listing it under "All" would
only re-raise the question the fix exists to remove.

A *decided* approval is the opposite case and is deliberately not filtered: the
decision was made, it stands as a matter of record, and the detail page reports
the session's real state beside it (§4.3).

### 4.3 Approval history — scope, tabs, detail page

**Domain** — `ApprovalListScope = "pending" | "decided" | "all"`.

**Port** — `IApprovalRepository.listForApprover({ approverUserId,
approverEmail, scope })`. `pending` keeps today's semantics (assignment +
`status='pending'` + live session). `decided` matches assignment **or**
`decided_by_user_id = approverUserId`, and any status other than `pending` — an
approver who decided a request that was later reassigned still owns their
decision. `all` is the union. `listPendingForApprover` stays as the thin
pending-only wrapper so existing callers and tests are unaffected.

**Use case** — `ListPendingApprovalsWithContext` is generalised to
`ListApprovalsWithContext` with a `scope` input, and its context grows:
`status`, `decidedAt`, `comment`, `decidedByName`, plus the session's
`sessionStatus` and `currentStepName`. The existing class name is kept as a thin
subclass/alias so `container.ts` and `approval.listPending` are untouched.

**tRPC** — `approval.list({ scope })` and `approval.get({ approvalId })`.
Both authorise through the existing approver grant: `viewerIsSessionApprover`
in `session-access.ts:60` already treats "is named on an approval of this
session" as read access, and `approval.get` additionally requires that the
caller is named on **that** approval (or is an admin), so one approver cannot
read another's decision by id.

**UI** — `/approvals` gains Active / Completed / All tabs, laid out exactly as
`/chats/_content.tsx:46-61`. Active renders today's `ApprovalRow` unchanged.
Completed and All render a collapsed row — chat name, step, outcome chip,
decided-at — linking to the detail page.

**New** `/approvals/[id]` — approval-centric, not chat-centric:

- what was approved (`subjectDescription`) and which stage
  (`approverStageLabel`),
- the subject document as a `DocumentCard` (with its edit-history modal) or the
  step's output fields, resolved the same way the queue resolves them,
- the decision: outcome, decider, timestamp, comment,
- where the work is **now** — the session's status and current step — so a
  historical decision answers "what happened after I signed", and a link across
  to the session for the full thread.

### 4.4 Approver edits in the author's thread

**New** `packages/domain/src/entities/approver-edit-message.ts` —
`buildApproverEditMessage({ editorName, changedLabels })`, mirroring
`approval-decision-message.ts`. The domain owns the format because two places
now depend on it, and a format agreed in two places is a format that drifts.

**Changed** `ApproverEditSubjectFields.announce` calls it, and
`latestEditKeys` becomes `latestEditLabels` — resolving each changed key to its
label from the live field set, falling back to the key when a field has since
been removed.

**New** `apps/web/src/lib/approver-edit-message.ts` —
`parseApproverEditMessage(content)`, returning `{ editorName, changedLabels }`
or `null`. Anything that is not an announcement renders verbatim, so an operator
who types a similar sentence is never dressed up as an approver — the same
guarantee `parseApprovalDecisionMessage` gives.

**Changed** `message-feed.tsx` — when a `system` message parses as an approver
edit, render the subject step's `DocumentCard` beneath it, `canEdit={false}`.
The message id comes from the already-loaded `dbMessages`: the most recent
message with the same `stepNodeId` that carries a document. No extra query, no
new field on the message row.

### 4.5 Who to notify after a decision

**New** `packages/application/src/use-cases/approvals/resolve-decision-notify-targets.ts`:

```
NotifyTarget = { userId: string | null; name: string | null; email: string | null;
                 reason: "next_approver" | "participant" | "originator" }
```

Resolution, in order:

1. **The next step is an approval with someone already on it** → that approver.
   (When the next approval has no approver yet, the decision modal already routes
   the deciding approver into `ApproverPicker` — that path is unchanged and
   takes priority in the UI.)
2. **The session is still active** → the participants who can act: the session
   owner plus collaborators (`roleCanSend`), excluding the person who just
   decided.
3. **The session completed** → all participants and the owner.
4. **Fallback, always** → the session owner. Never `requestedByUserId`, which is
   what produced the defect.

Returned from `approval.decide` as `notifyTargets`. The modal renders the list —
one `mailto:` per recipient, plus the existing copy-link — and says *"Notify
<names>"*, or falls back to "the originator" when the list resolves empty.
Best-effort throughout: failing to resolve a target must not fail a decision
that has already committed.

### 4.6 Users in the people directory

- **Domain** — `PersonSource` gains `"user"`. `IUserRepository.search({ query,
  limit })`.
- **Adapters** — `DrizzleUserRepository.search` (case-insensitive `ILIKE` over
  `name` and `email`, bounded limit); new
  `packages/adapters/src/directory/user-people-directory.ts` implementing
  `IPeopleDirectory` over it, emitting `source: "user"` with `userId` set.
- **Application** — `mergePeople`'s `rank()` already puts `person.userId` top,
  which is exactly right: an account-backed record beats the same address from
  Entra or HR, so a double-up collapses to the user row and the picker shows one
  entry per email.
- **Wiring** — `SearchPeople([userPeopleDirectory, graphPeopleDirectory,
  hrPeopleDirectory])`. Entra and HR **augment** the user list rather than
  replacing it, and a source that is not configured is skipped rather than
  fatal, as ADR-018 already requires.
- Picker placeholder becomes "Search people, Entra, HR, or type any email…".

### 4.7 PRD amendments

Two items in this phase extend `step-approvals.prd.md` rather than fixing a
defect against it, so the PRD is amended in the same change:

- **§3 and §10** — auto-suggest federates **four** sources, not three: existing
  Wayfinder users, Microsoft Entra, the uploaded HR dataset, and any free-text
  email. This also narrows the §12 risk *"a typed email with no account cannot
  act until one exists"*: the account-backed source is now the first thing the
  operator sees, so the natural pick is someone who can actually decide.
- **§6, §7 and §10** — a new user story ("as an approver, I can review the
  decisions I have already made, and see where that work ended up"), the
  `/approvals/[id]` surface, and the `approval.list` / `approval.get`
  procedures. §7 currently describes `/approvals` as a pending inbox only.

ADR-018 enumerates the same three sources, and its enumeration is updated to
four for the same reason. Its *design* is unchanged and needs no revision: the
ADR already specifies federation over a list of `IPeopleDirectory`
implementations merged and de-duplicated by email, which is exactly the seam a
fourth source plugs into. Nothing about suggest-then-always-confirm, the
override recording, or the free-email escape hatch moves.

`approval-subject.prd.md` needs no change: sequential chains are already in
scope there, and §4.5 corrects how an existing chain is *reported*, not how it
routes.

## 5. Sub-components (build order)

Each is test-first, with `./validate.sh` run after it.

1. `buildTurnRetrievalQueries` + multi-query `RetrieveDocumentChunks` (domain
   ports untouched; application + its tests).
2. Both stream call sites wired to it.
3. `listPendingForApprover` session-state filter.
4. `listForApprover` scope + `ListApprovalsWithContext` + tRPC `list` / `get`.
5. `/approvals` tabs and `/approvals/[id]`.
6. `buildApproverEditMessage` / `parseApproverEditMessage` + label resolution +
   feed rendering.
7. `ResolveDecisionNotifyTargets` + `approval.decide` output + modal.
8. `IUserRepository.search`, `UserPeopleDirectory`, `PersonSource`, wiring.
9. PRD amendments (§4.7).

## 6. Acceptance criteria

Each is observable, and each maps to a guard in §7 or the e2e spec in §8.

- [ ] A conversational turn on a flow whose context docs state a constraint
      retrieves at least one chunk of that constraint **when the user's message
      does not restate it** — the reported case: asked *"are there any options
      for a start date?"*, the retrieved set contains the Monday clause.
- [ ] The opening turn of a session (no user message, empty `gatheredContext`)
      issues a non-empty retrieval query and can return chunks. Today it
      returns `ok([])` without embedding anything.
- [ ] A chunk matched by both the message query and the step query appears
      exactly once in the merged result, carrying its highest similarity.
- [ ] A pending approval whose session is `abandoned` or `cancelled` appears in
      none of the three tabs; a *decided* one still appears, reporting the
      session's real state.
- [ ] `/approvals` renders Active / Completed / All. Completed lists a decision
      the caller made; opening it reaches `/approvals/[id]`.
- [ ] `/approvals/[id]` shows the subject, the artefact as signed, the outcome,
      the decider, the timestamp, the comment, and the session's **current**
      status and step.
- [ ] An approver who is named on neither the approval nor its session receives
      `FORBIDDEN` from `approval.get`; an admin does not.
- [ ] Two decisions on the same approval step of one flow list as two entries.
- [ ] After an approver edits and decides, the chat author sees a document card
      with an openable edit history directly beneath the announcement, and the
      announcement names field **labels**, not keys.
- [ ] On the final approval of a chain, the post-decision modal names the
      session's participants — never the previous approver by virtue of
      `requestedByUserId` alone — and falls back to the session owner.
- [ ] Typing a user's name in "Someone else" returns that user with an account
      link (`userId` set); a user and an Entra record sharing one email address
      render as a single entry.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` both read
      `0.23.2`.

## 7. Regression guards

Each must fail on the code as it stands today:

- `build-retrieval-query.test.ts` — a step whose `aiInstruction` mentions start
  dates produces a query containing them **with no user message at all**; the
  `__TEMPLATE_COMPLETE__` sentinel never reaches a query.
- `retrieve-document-chunks.test.ts` — two queries produce one embedding call
  each and a merged, similarity-ranked, id-unique result; a chunk returned by
  both queries appears once, at its best similarity.
- `turn-helpers.test.ts` — `generateInitialMessage` retrieves with a non-empty
  query when `gatheredContext` is empty.
- `approvals.test.ts` — a pending approval on an `abandoned` session is absent
  from `pending` and present in `all`; `decided` returns an approval the caller
  decided but is no longer assigned to.
- `approver-edit-subject-fields.test.ts` — the announcement carries field
  **labels**, and round-trips through `parseApproverEditMessage`.
- `resolve-decision-notify-targets.test.ts` — a chained approval raised by a
  previous approver resolves to the next approver, not to
  `requestedByUserId`; a completed session resolves to the participants; an
  empty participant set falls back to the session owner.
- `merge-people.test.ts` / `search-people.test.ts` — a user and an Entra record
  sharing an email collapse to one entry, and the survivor is the user row.

## 8. Risks

- **Retrieval precision falls as the floor drops.** 0.25 admits weaker matches,
  and with `limit = 8` a flow with a large context corpus will put more marginal
  text in front of the model. Mitigated by ranking (strongest first, across both
  scopes) and by the limit itself, which caps the damage at ~4 000 tokens.
  Reversible in one constant if a deployment reports noise; the numbers are
  defaults on the use case, not hardcoded at the call sites. **Watch:** answer
  quality on flows with many unrelated context docs.
- **Prompt-cache hit rate.** The reference section grows, so the non-cached
  share of the prompt grows with it (ADR-016 Decision 5). The structural prompt
  — the cacheable majority — is unchanged, and the step query makes part of the
  reference section stable within a step, which pushes the other way.
- **Two embedding calls per turn.** Free on the default local provider; two
  cheap API calls on `openai`. If a future provider is billed per request rather
  than per token this becomes worth revisiting.
- **A wider approver query touches a hot path.** `listForApprover` now joins
  `app_sessions`. The join is on the primary key of a table already read on
  every approval render, and the queue is bounded by one approver's assignments.
- **`approval.get` is a new read of someone else's session.** It is deliberately
  narrower than the existing approver grant: being named on *an* approval of a
  session opens the session (unchanged, `session-access.ts:60`), but reading a
  *decision record* requires being named on that approval, or being an admin.
- **The feed's document lookup is positional, not referential.** It resolves the
  edited document by "latest message on this `stepNodeId` carrying a document".
  If a step were ever to generate two documents, the newest wins — which is the
  same rule the approver's queue already applies
  (`ListApprovalsWithContext.resolvePreviousDocument`), so both surfaces stay
  consistent. A message-id reference would need a schema change; that is a
  MINOR-sized fix and out of scope here.
- **`ResolveDecisionNotifyTargets` is advisory.** It drives who the modal
  suggests contacting when email is not configured. It sends nothing, gates
  nothing, and is best-effort: a failure to resolve leaves the fallback
  (the session owner), never a failed decision.

## 9. E2E

`apps/web/e2e/enhance-rag-approval-flow-patch.spec.ts` — written, not run
locally (CI runs the sharded suite on the PR). Covers the approver-facing
surface end-to-end: an approver decides a request, the Active tab empties, the
decision appears under Completed, its detail page shows the subject, the
decision and the session's current state, and a request whose session was
discarded is absent from Active.

## 10. Version

`0.23.2` — PATCH. No schema change, no migration. `VERSION` and root
`package.json` updated together.
