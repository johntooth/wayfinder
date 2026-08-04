# Implementation Summary — Per-Turn RAG Context, Approval History & Notification Targets (v0.23.2)

- **Version**: 0.23.2 (bump: **PATCH** — no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Phase**: `rag-turn-context-and-approval-history.phase.md` (this folder)
- **E2E**: `apps/web/e2e/enhance-rag-approval-flow-patch.spec.ts`
- **PRD/ADR amended**: `step-approvals.prd.md` §3/§6/§7/§10/§12,
  `018-approval-step-and-approver-resolution.adr.md` (source enumeration)

## What was built

| # | Reported item | Where |
|---|---|---|
| 1 | The AI now sees flow guidance *during* the conversation, not only at the cross-check | `session/build-retrieval-query.ts`, `session/retrieve-document-chunks.ts`, both stream call sites |
| 2 | A discarded chat clears the approval it raised | `drizzle-approval-repository.ts`, `domain/entities/session.ts` |
| 3 | An approver can review their own decisions | `approvals/list-approvals-with-context.ts`, `approval.list` / `approval.get`, `/approvals` tabs, `/approvals/[approvalId]` |
| 4 | The chat author can open an approver's edits from the thread | `domain/entities/approver-edit-message.ts`, `lib/approver-edit-message.ts`, `chat/approver-edit-document.ts`, `message-feed.tsx` |
| 5 | The post-decision notice names who actually needs to act | `approvals/resolve-decision-notify-targets.ts`, `approvals/decision-modal.tsx` |
| 6 | Approver search offers existing accounts | `directory/user-people-directory.ts`, `IUserRepository.search`, `merge-people.ts` |

---

## 1 — Per-turn retrieval

### Root cause

Two things, compounding. The turn retrieved on `lastUserMessage` alone, against
a flow-scope floor of `0.5` and a limit of `5`. Half a sentence of operator
input — *"Joe Bloggs, are there any options for a start date?"* — does not clear
0.5 against a chunk about induction cadence and payroll cycles, so nothing
reached the prompt and the model answered from its own priors. And
`generateInitialMessage` retrieved on `gatheredContext`, which is `""` on the
first step, so **every session's opening turn retrieved nothing at all**.

The cross-check caught the Monday rule only because it does not use retrieval:
`EvaluateStepReadiness` passes `flow.contextDocs` — the full extracted text — to
extraction and grading. The guidance was working, one gate too late.

### Fix

`buildTurnRetrievalQueries` (pure) returns up to two keys:

- the **message query** — the latest user message plus a bounded conversation
  tail, so a thin reply inherits the subject of the turns around it;
- the **step query** — the node's `aiInstruction`, its `doneWhen` (via the new
  `doneWhenGuidance`, which skips the `__TEMPLATE_COMPLETE__` sentinel) and its
  declared field labels.

The step query is the substantive addition: it is stable for the whole step and
never empty, so it retrieves the governing policy on turn one, before the
operator has thought to ask. `RetrieveDocumentChunks` gained a `queries` mode
that embeds each distinct key, searches both scopes per embedding, and merges by
chunk identity keeping the best similarity. Flow defaults moved to `0.25` / `8`;
session-upload defaults are untouched.

`TEMPLATE_COMPLETE_SENTINEL` moved into the domain, removing the second
hardcoded copy of the literal in `stream/route.ts`.

**Relationship to ADR-016 Decision 5** (recorded in the phase doc §4.1): two
queries rather than one, and ~4 000 reference tokens rather than ~2 500. The
prompt-cache boundary the ADR prescribes is unchanged, and the step query is
*more* cacheable than the message query — its chunks change only when the step
does. Embedding cost per turn doubles: free on the default local provider.

---

## 2 — Discarded chats

`session.close` sets `status: "abandoned"` and touches nothing else, while
`listPendingForApprover` filtered on assignment and `status = 'pending'` only.
The queue now inner-joins `app_sessions` and excludes
`DISCARDED_SESSION_STATUSES` (`abandoned`, `cancelled` — a single domain
constant, so no reader can enumerate them differently). `complete` is
deliberately not in that set: a completed session's approvals are what completed
it.

A **pending** row on a dead session is hidden from every tab, All included — it
is not history, it is a request nobody can act on. A **decided** row is never
filtered: the decision stands as a matter of record, and its detail page reports
the session's real state beside it. No migration, and rows already in the bad
state clear themselves on the next read.

---

## 3 — Approver history

`listForApprover({ scope })` widens the match past `pending`. `decided` matches
assignment **or** `decided_by_user_id`, so an approver keeps their decision even
if the row is later reassigned. Several decisions on one approval step already
exist as separate rows — `findPendingByNode` matches only `pending`, so a change
request that routes work back raises a fresh row on re-entry — which is why
history lists rows rather than steps, and gets the requested behaviour for free.

`ListPendingApprovalsWithContext` became `ListApprovalsWithContext`, gaining
`decidedByName` and a `sessionState` (`status` + `currentStepName`). Its
`getById` authorises on the approval rather than the session, deliberately
narrower than the existing approver grant: being named on *any* approval of a
session already opens that session (ADR-018), but a decision record is readable
only by its assignee, its decider, or an admin.

`/approvals` gained Active / Completed / All. Active renders the unchanged
card; the history tabs render collapsed rows linking to `/approvals/[id]`, which
shows the subject, the artefact as signed (with its edit history), the
outcome/decider/timestamp/comment, and where the session has since got to.

The queue, the decision modal and the detail page now share one set of
components (`components/approvals/approval-parts.tsx`); three copies of that
markup is how the queue and the modal came to disagree about what was being
signed in the first place.

---

## 4 — Approver edits in the author's thread

Not a data gap: `document.getFields` already returns a resolved `editSummary` to
any participant, and `DocumentCard` already carries the history modal whenever
`editedAt` is set. The card is only rendered on the *advancing* message, far up
the thread from the system line announcing the edit — so the author was told
their document had changed and given nothing to open.

`buildApproverEditMessage` (domain) now writes that line and
`parseApproverEditMessage` (web) reads it back, mirroring the existing
`approval-decision-message` pair — the format has two dependents now, and a
format agreed in two places drifts. The feed renders the subject step's document
card beneath a matching system message, resolving it with
`resolveApproverEditDocument` by the same rule the approver's queue uses, so the
two surfaces cannot show different revisions.

The same change fixes a smaller defect alongside it: the announcement named raw
field **keys** (`start_date`), which the originator has never been shown
anywhere else. It now resolves labels from the node's field set, falling back to
the key when a field has since been removed — a changed value the originator is
not told about is the one outcome that method must never produce.

---

## 5 — Who to notify

The modal rendered `approval.originatorName`, resolved from
`requestedByUserId`. That is the originator for the *first* approval of a
session and nobody useful after it: a chained approval is raised through the
`ApproverPicker` mounted inside the previous approver's own decision modal, so
the column holds **the previous approver**. Hence the report — the final
approver was told to chase Ada Lovelace, who had already signed and had nothing
left to do.

`ResolveDecisionNotifyTargets` answers the question the modal is really asking —
who acts next — from where the session went, not from who sent the request:

1. the next step is an approval with someone already on it → that approver
   (including an email-only assignment with no account yet);
2. otherwise the session's people — the owner plus the participants who can
   act while it is running, plus viewers once it is complete;
3. the decider is always removed, and the originator is always a candidate, so
   "fall back to the originator" is an invariant of the candidate set rather
   than a branch that can be missed. When the decider *is* the owner and there
   is nobody else, the honest answer is an empty list, and the modal says so.

Advisory throughout: it drives a suggestion, sends nothing, gates nothing, and
every lookup degrades to "no target" rather than an error — the decision has
already committed by the time it runs.

---

## 6 — Accounts in the people directory

`SearchPeople` was constructed with `[graph, hr]`; `core_users` was never
searched, and `IUserRepository` had no method to search it with. Added
`IUserRepository.search` (bounded `ILIKE` over name and email, with LIKE
wildcards escaped so a name containing `%` narrows rather than widens) and
`UserPeopleDirectory` over it, registered **first**.

De-duplication needed no new machinery — `mergePeople` already keys on
lowercased email — but `rank()` now scores `source === "user"` explicitly above
"has a userId", so preference comes from the source rather than from directory
ordering. Reordering the list cannot change which record survives.

Entra and HR augment the account list rather than replacing it, and an
unconfigured source is skipped rather than fatal, exactly as ADR-018 requires.
This also narrows that ADR's standing risk: the people who can actually sign in
and decide are now the first thing the operator sees.

---

## Tests

Written before the implementation, and each fails on the unfixed code:

| Guard | What it holds |
|---|---|
| `build-retrieval-query.test.ts` (9) | a step query exists with no user message at all; the sentinel never reaches a query; the tail is bounded and newest-first |
| `retrieve-document-chunks.test.ts` (11) | one embedding per distinct query; a chunk both queries matched appears once, at its best similarity |
| `turn-helpers.test.ts` | `generateInitialMessage` retrieves with a non-empty query when `gatheredContext` is `""` |
| `approvals.test.ts` (122) | a pending approval on an abandoned/cancelled session is hidden, a completed one is not; `decided` returns a reassigned row to its decider; several decisions on one step list separately; `getById` refuses a stranger and allows the decider/admin |
| `resolve-decision-notify-targets.test.ts` (9) | a chained approval never resolves to `requestedByUserId`; viewers join once complete; owner-is-decider yields empty |
| `approver-edit-subject-fields.test.ts` (11) | the notice carries labels, not keys, and round-trips through the feed's parser |
| `approver-edit-message.test.ts` / `approver-edit-document.test.ts` | format and card resolution |
| `approval-outcome.test.ts` | every status has a label; `approved_with_edits` reads differently from `approved` |
| `directory.test.ts` (14) / `search-people.test.ts` (10) | accounts are findable by name and email; an account and an Entra record for one address collapse to the account, whichever order they are searched in |

`./validate.sh` passes apart from check 11 (`pnpm audit`), which fails
identically on unmodified `release/alpha-2` — pre-existing `fast-uri`,
`ip-address` and `brace-expansion` advisories, untouched by this change.

The e2e spec covers the approver-facing surface: the three tabs, a decision
opening its own page with subject/outcome/session state, a discarded chat
clearing its request from every tab, the post-decision hand-off naming someone,
and the picker returning an account-backed candidate. Items 1 and 4 stay at the
unit level — one needs a live embedding model and a scored retrieval, the other
a completed approver edit followed by a re-read of the originator's thread, and
neither is deterministic in the sandbox.
