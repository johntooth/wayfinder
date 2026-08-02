# Implementation Summary — Approver Edit Visibility & Outstanding Change Requests (v0.23.1)

- **Version**: 0.23.1 (bump: **PATCH** — no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Phase**: `approval-edit-visibility-and-change-requests.phase.md` (this folder)
- **E2E**: `apps/web/e2e/enhance-document-edit-history.spec.ts`,
  `apps/web/e2e/fix-approval-change-request-regeneration.spec.ts`

## What was built

| # | Reported item | Where |
|---|---|---|
| A | The originator can see *what* an approver changed, not just that they did | `domain/entities/document-edit-summary.ts`, `routers/document.ts`, `chat/document-edit-history-modal.tsx` |
| B | A change request now reaches document regeneration | `domain/entities/approval-change-request.ts`, `approvals/resolve-change-requests.ts`, `document/structured-fields.ts` + three generation paths |

---

## A — What the approver changed

### Root cause

Not a recording gap. `UpdateDocumentFields` has always appended a `DocumentEdit`
per save, each carrying `{ key, previousValue, newValue }` for every field that
moved, and `GenerateDocument` has always preserved that history across a
regeneration. Three places touched an edit and none showed a value:
`DocumentCard` rendered `Edited <date>`, `ApproverEditSubjectFields` posted a
system line naming raw field **keys**, and `document.getFields` returned the
stamps but not the history.

### Fix

`summariseDocumentEdits({ editHistory, fields })` — pure, in the domain — folds
the recorded history against the live field set: each save becomes one entry
with its changed fields resolved to labels, and every field no edit touched is
returned separately at its current value.

Edits are kept **per save**, not folded into a single original-to-current diff.
With two approvers in a chain, who changed a value matters as much as what it
became, and folding loses the second name.

A repeating group's before/after is stored as JSON — the only way to diff a
list — so the summariser renders it back as readable item lines. An unparseable
value is passed through verbatim rather than dropped.

`document.getFields` now returns an `editSummary`, resolving each editor's
display name once per distinct editor. A deleted account costs the name, never
the record of what changed.

`DocumentEditHistoryModal` puts an info icon beside the existing "Edited" stamp
on `DocumentCard` — so it appears in the chat thread for the originator and in
the `/approvals` queue for the next approver, both of which mount that card.
The dialog lists each edit (`Edit 2 · Priya Raman · 14 Mar 2026, 09:41`) with
the old value struck through in red above the new one, then every unchanged
field beneath.

---

## B — A change request reaching regeneration

### Root cause

Since v0.22.2 an approval decision is written into the thread as the approver's
own `user` message with its comment, so the request *does* reach the transcript.
It never reached the model with any weight:

1. **No priority.** `buildDocumentTranscript` renders every turn as a flat
   `User:` / `Assistant:` list. The approver's "the start date must be the 3rd"
   was one line among the originator's earlier, more explicit statements of the
   old value, and the prompt said only *"Fill each value using the session
   context below"*.
2. **No channel.** `extractStructuredFields` already supported two
   higher-priority sections — captured step outputs and insights — and
   `GenerateDocument` passed neither, with no section for change requests at
   all. `EvaluateStepReadiness` and `CaptureStructuredStepOutput` had the same
   omission.

### Fix

`outstandingChangeRequests({ approvals, nodeNames })` — pure, in the domain —
takes the latest *decided* row per approval node. Anything that is not an
approval, carrying a comment, is outstanding; a later approval of that same node
clears it. Nothing is persisted, so a re-raised approval supersedes its
predecessor with nothing to clean up, and a pending row leaves the request
standing — undecided is not satisfied.

Rejection is treated exactly like a change request. The row does not record
whether the approver routed the work back or closed it, and does not need to: a
rejection that closed the request cancels the session, so nothing regenerates
behind it.

`resolveChangeRequests(approvals, flowNodes, { sessionId, flowId })` joins the
rows to their step names. It never fails — every caller is a generation path,
and a document that will not render because the approval table could not be read
is worse than one rendered exactly as it is today.

`extractStructuredFields` gained a `changeRequests` section rendered **above**
the captured step data and the transcript, labelled as superseding both. With no
requests the prompt is byte-for-byte what it was.

Wired at every path that extracts field values:

| Path | Where |
|---|---|
| The Regenerate button | `api/documents/[documentId]/route.ts` |
| Auto-advance generation | `stream/turn-helpers.ts` → `generateDocument` |
| Structured-step capture | `stream/structured-capture.ts` |
| The pre-generation readiness gate | `stream/execute-turn.ts` |

The gate matters as much as generation: on a pass it threads its own
`fieldValues` straight into `GenerateDocument`, so fixing only generation would
have reinstated the rejected content the moment the step advanced. Conversely,
when the gate has already threaded values through, generation skips the approval
read entirely — the extraction that would consume them has already happened,
against the same requests.

---

## Tests

**Regression guards (fail on the unfixed code):**

- `generate-document.test.ts` — "puts an outstanding change request into the
  extraction prompt"
- `turn-helpers.test.ts` — "threads an approver's outstanding change request
  into the use case"

**New unit tests:**

- `document-edit-summary.test.ts` (10) — label resolution, two edits to one
  field staying two entries, untouched fields, group JSON rendering, the
  unparseable fallback
- `approval-change-request.test.ts` (10) — outstanding, cleared by a later
  approval on the same node only, pending ignored, comment-less skipped,
  ordering, deleted step named generically
- `resolve-change-requests.test.ts` (4) — the join, and both degradation paths
- `structured-fields.test.ts` (+3) — section placement above the captured data
  and the transcript; an empty list leaves the prompt unchanged
- `document.test.ts` (+4) — `editSummary` shape, name and email fallbacks, and a
  deleted editor

**E2E:**

- `enhance-document-edit-history.spec.ts` — drives item A end to end (approver
  edits before deciding; the before/after is then readable on the queue and in
  the originator's thread). A true discriminator: no model call stands between
  the edit and the assertion.
- `fix-approval-change-request-regeneration.spec.ts` — drives item B's
  reproduction (reject with a comment → work routes back → regenerate), and
  asserts the path rather than the regenerated wording. What the model writes is
  not deterministic in the sandbox, so the guarantee that the request reaches
  the prompt is pinned by the two regression guards above. Same split, and same
  reason, as v0.22.2's items 1, 6 and 7.

**Test-harness maintenance.** The container stubs in `turn-helpers.test.ts` and
`execute-turn.test.ts` gained `approvals` / `flowNodes` repositories, because
the generation paths now read them.

## Not done

The change-request text was deliberately given no new UI surface. It already
appears in the thread as the approver's own message; this change makes
generation act on it, and nothing more.
