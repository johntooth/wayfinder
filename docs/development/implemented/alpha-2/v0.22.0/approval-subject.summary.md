# Implementation summary — approval subject, signature, record, routing & approver editing (v0.22.0)

- **Phase doc**: `approval-subject.phase.md` (this folder)
- **PRD**: `docs/development/prd/approval-subject.prd.md`
- **ADRs**: ADR-040, ADR-043, ADR-044, ADR-045
- **Base branch**: `release/alpha-2`
- **Version bump**: MINOR — `0.21.7` → `0.22.0`. New feature; additive
  `app_flow_nodes.config` and `app_session_approvals.record_snapshot` jsonb, and
  a widened TypeScript-level `status` enum on a plain `text` column with no CHECK
  constraint. **No migration.**

## What was built

### The authorisation gap, first and on its own

`document.getFields` and `document.updateFields` were `authenticatedProcedure`
with no ownership or participant check, so any authenticated caller holding a
message UUID could read and edit another user's document fields. The identifier
is a UUID, so this was obscurity, not access control.

Both now resolve the message's session and authorise the caller through
`authorizeSessionAccess` — the same path the REST document routes already used.
The read honours the ADR-018 approver grant; the edit does not, because that
grant is read-only. Shipped as its own commit before anything else in the phase,
since nothing may land on top of an unguarded procedure.

The only callers were `record-card.tsx` and `document-edit-dialog.tsx`, both
already inside the session UI, so no legitimate caller relied on the old
behaviour.

### The subject

`ApprovalNodeConfig` gains `approvalSubject`, read through `approvalSubjectOf`.
`ResolveApprovalSubject` answers it once per approval: the step case names the
referenced step and captures its output snapshot; the custom case makes one
model call summarising the author's instruction against what the session has
gathered. The result is cached on the pending row, so a custom subject costs one
model call however many times the gate is rendered, and a decided approval
always reports the subject it locked.

The statement now reaches everyone who acts on it: the gate ("You are requesting
approval of: …"), the approver's queue ("You are approving: …") and the approval
request email.

### The approver's context stops reading `advancedFrom`

`ListPendingApprovalsWithContext` resolved its document-or-fields panel from
`session.graphCheckpoint.advancedFrom` — a single-slot back-pointer overwritten
on every advance. With two approvals in sequence it names the previous
*approval*, so the second approver was shown the first approver's projected
decision fields instead of the document they were asked to sign.

It now resolves through the same `ResolveApprovalSubject` the gate uses, at read
time, so an earlier approval's signature is already on the revision returned.
Sharing one resolver is the point: splitting the statement from the artefact is
how the two drifted apart.

### The signature

`(approval)` parses to a new `signature` `TemplateFieldType`, exclusive of every
other type keyword, refusing length/numeric/multiplicity annotations, and
rejected inside a `(repeat)` group. `nodeFieldSet` filters it out at the single
choke point every gathering consumer inherits — the AI prompt never learns the
field exists, an unsigned slot never blocks readiness, and manual editing cannot
reach it. `validateStructuredFieldSet` rejects it as it does `section`, and an
xlsx template carrying one is rejected at upload with the limitation named.

On decision, `buildAttestationBlock` renders the approver, role, decision, UTC
timestamp, comment and a 12-hex verification code taken over the record with
`canonicalAuditString`, so the code and the ADR-033 audit chain cannot drift.
`ApplyApprovalSignature` writes it into the subject step's document through the
ADR-024 revision path and repoints the message's `storagePath`, so the next
approver reading by pointer sees the signed revision with their own slot empty.

The block is an **advanced** electronic signature, not a qualified one. Nothing
in the code or the UI copy says otherwise.

### The record

Every decided approval freezes a flat, dot-separated record prefixed by its step
key: `decision`, `approver_name`, `approver_email`, `decided_at` and `comment`
are guaranteed, with the subject, verification code and edit detail alongside.
The approver's name and email are copied in, never joined at read time, so a
later rename cannot change what the record says was true. Two approval steps get
distinct prefixes; two sharing a label are separated by a numeric suffix
resolved at save time.

### Change-request routing

`changesRequestedTarget` names a step, or defaults to `nearest_editable`, which
walks the taken path back to the first conversational node. Route-back records
the approval node that sent the work back instead of blanking the checkpoint, so
consecutive change requests both route — the previous build wrote
`advancedFrom: null` and cancelled the session on the second one.

An unresolvable target now **holds** the session at the approval with the reason
posted to the thread. Cancelling is reachable from exactly one place: an
approver explicitly rejecting and closing.

### Approver editing and `approved_with_edits`

A pending approver may edit the fields of their own approval's subject step, and
nothing else. The edit is attributed in `editHistory` and announced in the
thread naming the approver and the changed fields.

`ApprovalStatus` gains `approved_with_edits`, **derived** when that approver
changed their own subject step during their pending window. Edits by the
originator, or by a different approver, do not qualify. `ApprovalDecision` keeps
its three values and the router still accepts exactly those, so advancement is
unchanged.

## Files created

| Layer | File |
|---|---|
| domain | `packages/domain/src/entities/approval-record.ts` (+ test) |
| domain | `packages/domain/src/entities/taken-path.ts` (+ test) |
| domain | `packages/domain/src/entities/attestation-block.ts` (+ test) |
| application | `packages/application/src/use-cases/approvals/resolve-approval-subject.ts` (+ test) |
| application | `packages/application/src/use-cases/approvals/apply-approval-signature.ts` (+ test) |
| application | `packages/application/src/use-cases/approvals/approver-edit-subject-fields.ts` (+ test) |
| application | `packages/application/src/use-cases/approvals/signature-values.ts` |
| application | `packages/application/src/use-cases/approvals/approval-record-keys.ts` |
| application | `packages/application/src/use-cases/notifications/approval-templates.test.ts` |
| adapters | `packages/adapters/src/repositories/drizzle-approval-repository.test.ts` |
| web | `apps/web/src/components/canvas/approval-node-config.ts` (+ test) |
| web | `apps/web/src/server/routers/approval.test.ts` |
| web | `apps/web/src/server/approval-status-lint.test.ts` |
| web | `apps/web/e2e/phase-approval-subject.spec.ts` |

## Files modified

| Layer | File | Change |
|---|---|---|
| domain | `entities/approval.ts` | `approved_with_edits`, `APPROVED_STATUSES`, `isApproved`; documented the record shape |
| domain | `entities/flow-node.ts` | `approvalSubject`, `signatureFieldKey`, `changesRequestedTarget` |
| domain | `entities/template-field.ts` | `signature` type and the `(approval)` annotation, with its exclusivity rules |
| domain | `entities/template-annotation-validation.ts` | `approval` in the modifier vocabulary |
| domain | `entities/node-output.ts` | `nodeFieldSet` filters `signature`; `validateStructuredFieldSet` rejects it |
| domain | `ports/approval-repository.ts` | `hasRecordedSnapshot` documented as decided-approvals-only |
| application | `approvals/decide-approval.ts` | record building, attestation, signature trigger, routing rewrite, derived status |
| application | `approvals/list-pending-approvals-with-context.ts` | resolves from the subject, not `advancedFrom` |
| application | `document/update-document-fields.ts` | signatures preserved on re-render, kept out of step outputs, approver-edit bypass |
| application | `document/render-data.ts` | signature substitution documented |
| application | `notifications/approval-templates.ts` | subject in the request email; recorded status in the decided email |
| application | `notifications/notify-on-approval-decided.ts` | passes the recorded status |
| application | `notifications/notify-on-approval-requested.ts` | passes the cached subject |
| adapters | `db/schema/wayfinder.ts` | widened `status` enum (TS-only) |
| adapters | `repositories/drizzle-approval-repository.ts` | `recordedSnapshotWhere`, extracted `approvalPatchToColumns` |
| adapters | `documents/xlsx-generator.ts` | rejects `(approval)` at upload |
| root | `eslint.config.mjs` | `no-restricted-syntax` against literal approval-status comparison |
| web | `server/routers/document.ts` | session authorisation; approver-edit path |
| web | `server/routers/approval.ts` | `suggest` returns the resolved subject |
| web | `lib/container.ts`, `lib/e2e-fixtures.ts` | wiring and phase fixtures |
| web | `e2e/helpers/seed.ts`, `e2e/seed.setup.ts` | new fixture ids |
| web | `components/canvas/node-config-modal*.tsx`, `approval-node.tsx` | subject, slot and return-target controls |
| web | `components/chat/approval-gate.tsx` | subject statement at the gate |
| web | `app/(user)/approvals/_content.tsx` | subject statement; edit before deciding |
| web | `app/(user)/flows/[id]/config/_content.tsx` | config mapping, `priorSteps`, taken slots |

## Decomposition forced by the source-size gate

Four files were under the 800-line ceiling before this phase and over it after.
`validate.sh` check 16 is a hard fail, so each was split — behaviour unchanged in
every case:

| Was | Now | Extracted to |
|---|---|---|
| `lib/e2e-fixtures.ts` 981 | 747 | `lib/e2e-fixtures-approval.ts` |
| `lib/container.ts` 826 | 782 | `lib/container-approval-use-cases.ts` (mirrors `buildDocumentUseCases`) |
| `canvas/node-config-modal.tsx` 819 | 717 | `canvas/node-config-values.ts` (the values type + defaults, re-exported so call sites are untouched) |
| `flows/[id]/config/_content.tsx` 890 | 767 | `_use-prior-step-views.ts` (the three prior-step memos) and `canvas/approval-config-mapping.ts` |

## Migrations run

**None.** `approvalSubject`, `signatureFieldKey` and `changesRequestedTarget`
ride `app_flow_nodes.config`; the record rides
`app_session_approvals.record_snapshot`. `app_session_approvals.status` is a
plain `text` column whose Drizzle `enum` is a TypeScript refinement — there is no
CHECK constraint in `drizzle/`, so `approved_with_edits` is additive at the
database. Verified by grep before changing it.

## Behaviour changes worth a release note

- **A change request no longer cancels a session.** The previous build cancelled
  on the second change request in a run, losing the session. Anyone depending on
  that is depending on a bug, but it is a change.
- **`status` gains a fourth decided value.** Anything outside this repo reading
  it — an exported record, an n8n record-export payload (ADR-020) — will see
  `approved_with_edits`.
- **`hasRecordedSnapshot` now counts only approvals that approved.** A
  `changes_requested` row carries a record too, and locking the document on that
  one would stop the operator making the changes they were asked for.

## Two decisions taken at build time

The phase doc left both open.

**The attestation block's first line is decision-dependent.** ADR-043 §3 shows
`Approved by:` literally, but the same block renders a rejection, where that
label misreads at a glance — the one thing an attestation must not do. An
approval keeps the ADR's wording; anything else reads `Decided by:`.

**"Last completed step" skips every approval node, not just the one asking.** An
approval's output is a decision, not a subject, so resolving to one is exactly
the ADR-040 §2 defect in a different guise. `nearestEditableNodeId` is stricter
still, taking only conversational nodes.

## Known limitations

- **`approved_with_edits` is derived from the subject step's `editHistory`**, so
  it is only earned where the subject step produced a document. A structured or
  unstructured subject step records `edits_made: false` even if the approver
  changed something through another surface. Acceptable: the approver-edit right
  itself is currently only reachable for a document step.
- **The "superseded by a later edit" note is not implemented** (ADR-045 §5, left
  open). A decided approval's record and signed revision are both retained, so
  "what did Jane actually approve" is answerable — but the *latest* revision can
  carry an attestation older than the content around it, with nothing on the
  face of the document saying so. Recomputing the hash was never an option; it
  would re-sign on the signer's behalf.
- **The subject dropdown lists only steps that declare fields**, because that is
  what `priorStepFields` carries. The return-target dropdown uses the new
  `priorSteps`, which has no such limit. The runtime defaults are unaffected —
  a field-less conversational step is still a valid last-completed step and a
  valid `nearest_editable` target.
- **A second approver cannot edit once an earlier approval has approved**, other
  than through their own scoped path, which does lift the lock for their subject
  step. The general post-approval document lock (ADR-024) is otherwise unchanged.
- **Custom-subject approvals record no signature.** The slot lives on the subject
  step's template, and a custom subject names no step. This is the behaviour the
  phase doc expected; the config UI simply shows no slot control.

## E2E tests added

`apps/web/e2e/phase-approval-subject.spec.ts`, against two new fixtures in
`apps/web/src/lib/e2e-fixtures.ts`:

- `seedApprovalSubjectSession` — `Prepare instrument (2 signature slots) →
  Delegate sign-off (approved) → Finance sign-off (pending)`, with the
  checkpoint's `advancedFrom` deliberately pointing at the first approval so the
  regression is reachable.
- `seedApprovalFirstFlow` — a flow whose first step is an approval, so the config
  editor has an authoring-time warning to show.

Covering: the subject statement on the approver's card; the second approver
being shown the **document** rather than the first approval's decision fields;
opening the field editor before deciding, with no signature slot offered; and —
the error path — the authoring-time warning when no editable step precedes an
approval.

**These specs have not been executed.** The build sandbox has no Docker and no
Postgres/Redis/MinIO, and `@playwright/test` is not installed in the workspace,
so the Playwright suite could not be run here. They need a run against a live
stack (the `/e2e` skill, or CI) before this phase is considered verified
end-to-end.

## Validation

`pnpm typecheck`, `pnpm lint` and `pnpm test` all pass (2,507 unit tests).
`./validate.sh` skips the drizzle schema check and the connectivity checks in
this sandbox, since no database is reachable.
