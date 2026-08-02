# Phase — Approver Edit Visibility & Outstanding Change Requests

- **Status**: Implemented
- **Target version**: 0.23.1  (bump: PATCH — no schema change, no new step type,
  no new node; one defect and one visibility gap in the shipped approval chain)
- **Base branch**: `release/alpha-2` (stabilisation only — see CLAUDE.md
  *Release Branching*)
- **ADRs**: ADR-024 (manual document field editing), ADR-027 (document
  generation budgets), ADR-040 (approval subject + frozen record), ADR-044
  (change-request routing), ADR-045 (approver edit-before-deciding)
- **Depends on**: the two-approval chain, `editHistory`, and the pre-generation
  readiness gate as they stand on `release/alpha-2` (v0.23.0)

## 1. Problem

Both reports come from one run through a flow with two approval steps in
sequence, where the first approver edited a field before approving.

1. **The originator cannot see *what* an approver changed.** The edit itself
   works and carries through to the second approver, but the originator is only
   told *that* fields were edited. There is no before/after anywhere in the UI.

2. **A change request does not reach document regeneration.** The second
   approver rejected the document and asked for further changes. Work routed
   back to the first step, but regenerating the document there reproduced the
   old content: generation re-extracts from the conversation with no reference
   to what the approver asked for.

## 2. Root causes

### 2.1 Edit visibility

The data is already recorded and already durable. `UpdateDocumentFields`
appends a `DocumentEdit` per save
(`packages/application/src/use-cases/document/update-document-fields.ts:185`),
each carrying `changes: { key, previousValue, newValue }[]`, and the history
survives regeneration by design
(`packages/application/src/use-cases/document/generate-document.ts:117`).

Nothing reads it back. Three places touch an edit and none of them shows a
value:

- `DocumentCard` renders `Edited <date>` and stops
  (`apps/web/src/components/chat/document-card.tsx:89`).
- `ApproverEditSubjectFields.announce` posts a system line naming the changed
  **keys** — raw field keys, not labels, and no values
  (`packages/application/src/use-cases/approvals/approver-edit-subject-fields.ts:123`).
- `document.getFields` returns `editedAt` / `editedByUserId` but not
  `editHistory` (`apps/web/src/server/routers/document.ts:188`).

So this is a read-path gap, not a recording gap. No new persistence is needed.

### 2.2 Change requests and regeneration

Since v0.22.2 an approval decision is written into the thread as the approver's
own `user` message, comment included
(`packages/application/src/use-cases/approvals/decide-approval.ts:429`). That
fixed the decision *reaching* the transcript. It did not make generation act on
it, for two reasons:

1. **No priority.** `buildDocumentTranscript` renders every user/assistant turn
   as a flat `User: …` / `Assistant: …` list. The approver's "the start date
   must be the 3rd" is one line among the originator's earlier, more explicit
   statements of the old value. The extraction prompt says only *"Fill each
   value using the session context below"* — nothing marks the later line as
   superseding the earlier one, and nothing distinguishes an instruction to
   change a value from a statement of a value.

2. **No channel.** `extractStructuredFields` already supports two
   higher-priority sections above the transcript — `priorStepOutputs` ("Data
   captured by earlier steps (most reliable)") and `insights`
   (`packages/application/src/use-cases/document/structured-fields.ts:75-91`).
   `GenerateDocument.resolveFieldValues` passes **neither**
   (`generate-document.ts:169`), and there is no section for change requests at
   all. The same omission exists in `EvaluateStepReadiness`
   (`evaluate-step-readiness.ts:77`) and `CaptureStructuredStepOutput`
   (`capture-structured-output.ts:69`).

The gate matters as much as generation: on a pass it threads its own
`fieldValues` straight into `GenerateDocument`
(`apps/web/src/app/api/chat/[sessionId]/stream/execute-turn.ts:371`), so fixing
only `GenerateDocument` would leave the auto-advance path reproducing the bug.

## 3. Reproduction

**2.1** — Run a flow with a document step followed by two approval steps. As the
first approver, *Edit before deciding*, change one field, approve. As the
originator, open the session: the card says `Edited <date>`; the thread names
the changed keys. Neither the old value nor the new value is anywhere.

**2.2** — Continue: as the second approver, reject with *Route back to user* and
a comment naming a concrete change ("the delivery date must be 03-03-2026").
Work returns to the document step. As the originator, press **Regenerate** on
the document card. The regenerated document still carries the old value.

## 4. Goals

- The originator can see exactly what each approver changed, per edit, with the
  old value struck through and the new value beside it.
- An outstanding change request is the highest-priority instruction in the
  extraction prompt, and stays outstanding until the approval node that raised
  it is subsequently approved.
- Every path that extracts field values — regenerate, auto-advance, the
  readiness gate, structured capture — sees the same change requests.

## 5. Non-goals

No schema change. No change to who may edit or decide, to the frozen
`recordSnapshot`, to the attestation block, or to change-request routing
targets. The change-request text is **not** given a new UI surface: it already
appears in the thread as the approver's own message. Regeneration keeps its
documented behaviour of overriding manual edits.

## 6. Approach

Bottom-up (domain → application → web), writing the test file before the
implementation file for each sub-component (CLAUDE.md). Both new decisions are
pure functions so they are testable without a database.

**Edit history is presented per edit, not folded.** Each save is shown as its
own entry ("Edit 2 · Sam Okafor · 14 Mar 2026, 09:41") listing the fields that
save changed. A field edited twice appears twice, under each edit. Folding the
history into a single original → current diff would read more cleanly but would
hide who changed what: with two approvers in a chain, attribution is the point.
Fields never touched by any edit are listed once, at the bottom, at their
current value.

**A change request is outstanding until its own node approves.** Derived per
approval node from the latest *decided* row: anything that is not an approval
(`changes_requested` or `rejected`) with a comment is outstanding, and a later
approval of that same node clears it. Nothing is persisted and nothing has to be
cleared by hand — a re-raised approval on the same node supersedes its
predecessor automatically, and a pending row leaves the request standing,
because undecided is not satisfied.

A rejection is treated exactly like a change request. The row does not record
whether the approver routed the work back or closed it, and it does not need to:
a rejection that closed the request cancels the session, so nothing regenerates
behind it. The only rejection this rule can meet on a live session is one that
routed work back, and its comment binds the same way.

## 7. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/document-edit-summary.ts` *(new)* | pure `summariseDocumentEdits({ editHistory, fields })` → per-edit entries + untouched fields, labels resolved |
| domain | `packages/domain/src/entities/approval-change-request.ts` *(new)* | pure `outstandingChangeRequests({ approvals, nodeNames })` → the outstanding comments, newest last |
| domain | `packages/domain/src/index.ts` | export both |
| application | `packages/application/src/use-cases/document/structured-fields.ts` | `changeRequests?: ApprovalChangeRequest[]` on the input; renders above the step-outputs section |
| application | `packages/application/src/use-cases/document/generate-document.ts` | accept and thread `changeRequests` |
| application | `packages/application/src/use-cases/session/evaluate-step-readiness.ts` | accept and thread `changeRequests` |
| application | `packages/application/src/use-cases/document/capture-structured-output.ts` | accept and thread `changeRequests` |
| application | `packages/application/src/use-cases/approvals/resolve-change-requests.ts` *(new)* | `resolveChangeRequests(approvals, flowNodes, { sessionId, flowId })` — reads the rows, joins the step names, applies the domain rule. A module function beside `signature-values.ts`, not a class: it takes no state and every caller is a generation path that must not fail because of it |
| application | `packages/application/src/use-cases/approvals/index.ts` | export it |
| web | `apps/web/src/app/api/documents/[documentId]/route.ts` | resolve change requests before regenerating |
| web | `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` | resolve them in `generateDocument`, but only when it will actually extract |
| web | `apps/web/src/app/api/chat/[sessionId]/stream/structured-capture.ts` | same, for a structured step |
| web | `apps/web/src/app/api/chat/[sessionId]/stream/execute-turn.ts` | resolve them for the readiness gate |
| web | `apps/web/src/server/routers/document.ts` | `getFields` returns `editHistory` with editor display names |
| web | `apps/web/src/components/chat/document-edit-history-modal.tsx` *(new)* | the `Info` icon + dialog |
| web | `apps/web/src/components/chat/document-card.tsx` | render the icon when the document has an edit history |

## 8. Implementation steps (test-first per CLAUDE.md)

1. **Domain — edit summary.** `document-edit-summary.test.ts` first: one edit
   with one change; two edits touching the same field produce two entries in
   chronological order; a key absent from the field set falls back to the key as
   its label; fields never edited come back in the untouched list at their
   current value; an empty history yields no entries and every field untouched.
   Then implement.

2. **Domain — outstanding change requests.** `approval-change-request.test.ts`
   first: a `changes_requested` row is outstanding; a `rejected` row is
   outstanding; a later `approved` (or `approved_with_edits`) on the same node
   clears it; a later approval on a *different* node does not; a pending row is
   ignored; a comment-less row is skipped; two nodes both outstanding come back
   oldest-first; a deleted step is named generically. Then implement.

3. **Application — prompt section.** Extend `structured-fields.test.ts`: the
   change-request section renders above the step-outputs section and names each
   approval step; an empty list changes the prompt not at all (byte-for-byte).
   Then implement.

4. **Application — generation threading.** Extend `generate-document.test.ts`
   with the regression guard: given an outstanding change request, the prompt
   handed to the model contains it. Then thread it through `GenerateDocument`,
   `EvaluateStepReadiness` and `CaptureStructuredStepOutput`.

5. **Application — resolver use case.** `resolve-change-requests.test.ts`
   first: joins approvals to node names; a repository failure returns an empty
   list rather than failing the caller (generation must not fail because the
   approval read did). Then implement and export.

6. **Web — wiring.** Wire the use case into the container and resolve it at the
   three edges. Extend `turn-helpers.test.ts` for the regenerate path.

7. **Web — getFields.** Extend `document.test.ts`: `getFields` returns the edit
   history with editor names resolved, and an empty array when there is none.
   Then implement.

8. **Web — modal.** `DocumentEditHistoryModal`: `Info` icon top-left of the
   card (the confidence modal owns top-right), dialog listing each edit with its
   changed fields — old value struck through in red, new value beneath — then
   every untouched field at its current value. Mirrors `DocumentEditDialog`'s
   label/value layout.

9. **E2E.** `apps/web/e2e/enhance-document-edit-history.spec.ts` drives the
   whole of item A through the UI — approver edits, originator reads the
   before/after — and is a true pass/fail discriminator, because nothing between
   the edit and the assertion calls a model.

   `apps/web/e2e/fix-approval-change-request-regeneration.spec.ts` drives item
   B's reproduction — reject with a comment, work routes back, regenerate — but
   asserts the path, not the regenerated wording. What the model writes is not
   deterministic in the sandbox, so the guarantee that the request reaches the
   prompt is pinned by the unit tests in steps 4 and 6, both of which fail on
   the unfixed code. This is the same split v0.22.2 made for its items 1, 6 and
   7, and for the same reason.

## 9. Risks

- **The model still ignores the instruction.** Prompt changes are advisory. The
  section is placed above the transcript and labelled as superseding it, which
  is the strongest signal available short of pinning values, but a specific
  model may still under-weight it. Mitigated by keeping the change request in
  the transcript as well — this adds a channel, it removes none.
- **A stale change request.** If an approval node is never revisited, its
  comment stays outstanding and keeps shaping regeneration. That is the correct
  reading: the request has not been satisfied. It clears the moment that node
  approves.
