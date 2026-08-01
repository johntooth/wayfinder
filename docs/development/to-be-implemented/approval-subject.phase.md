# Phase — Approval Subject, Signature, Record, Routing & Approver Editing

- **Status**: Awaiting review (scope extended 2026-08-01 — signature tag, slot selection, record metadata, change-request routing, approver field editing)
- **Target version**: 0.22.0  (bump: MINOR — new feature, additive `app_flow_nodes.config` + `app_session_approvals.record_snapshot` jsonb; no migration. Computed from the `release/alpha-2` line at `0.21.7` — re-confirm against `VERSION` on the base branch at build time.)
- **Base branch**: `release/alpha-2`
- **PRD**: `docs/development/prd/approval-subject.prd.md`
- **ADRs**: ADR-040 (config mirrors `FieldValueSource`, resolve-once at gate, context follows the subject, lock at decision, step-prefixed record, no migration), ADR-043 (`(approval)` annotation → `signature` field type, gathering exclusion, slot selection, attestation block), ADR-044 (change-request routing target, back-pointer repair), ADR-045 (approver field editing, document authorisation)
- **Depends on**: approval step (ADR-018, `Approval` entity, `node-config-modal-approval.tsx`), RBAC (ADR-021), `FieldValueSource` / `PriorStepField` (`packages/domain/src/entities/field-value-source.ts`), template-field parser (`packages/domain/src/entities/template-field.ts`), `nodeFieldSet` (`node-output.ts`), document re-render + revision retention + `editHistory` (ADR-024, `update-document-fields.ts`), audit hash chain (ADR-033, `audit-hash.ts`), email transport (ADR-023), `recordSnapshot` on `app_session_approvals`

## 1. Problem

An approval node configures *who* approves but never *what*. The approver sees no
explicit subject, and the `Approval` record does not pin the subject at decision
time. Three gaps sit alongside it: the approved **document** carries no evidence
of the decision, a document needing **several** signatures cannot say which step
signs which slot, and a flow with more than one approval produces a record a
report cannot tell apart.

Making multi-signature documents ordinary then exposes three defects that are
already reachable in the current build: a second approver is shown the previous
*approval's* decision fields instead of the document; a change request routes back
to that approval node and, on the second occurrence, **cancels the session**; and
`document.getFields` / `updateFields` carry no session-ownership check at all, so
document fields are editable by any authenticated caller holding a message UUID.
See the PRD.

## 2. Goals

- `ApprovalNodeConfig.approvalSubject`: `{ kind: "step"; nodeId }` (default last
  completed) | `{ kind: "custom"; instruction }`.
- Config UI: prior-step dropdown defaulting to the last completed step + custom
  free-text.
- Runtime resolves a human-readable statement (+ the step's output snapshot for the
  step case), shown at the gate and in the approver request/email.
- New `(approval)` annotation → `signature` `TemplateFieldType`, **excluded from
  `nodeFieldSet`** so it is never gathered, never blocks readiness and cannot be
  edited manually.
- `ApprovalNodeConfig.signatureFieldKey` + a slot dropdown shown only when the
  subject step's template declares more than one signature field.
- On decision, the slot renders the **attestation block** (name, email, role,
  decision, UTC timestamp, comment, verification code) and the document is
  re-rendered as a new revision with the prior one retained.
- The resolved subject and the decision metadata are locked into `recordSnapshot`
  at decision time, **prefixed by step key**, and never recomputed.
- The approver's document/fields panel resolves from `approvalSubject` at read
  time, so a second approver sees the document at the revision carrying the first
  approver's signature.
- `ApprovalNodeConfig.changesRequestedTarget` + an "On changes requested, return
  to:" dropdown, defaulting to the nearest prior **editable** step; a session is
  never cancelled by a failure to resolve that target.
- Session-scoped authorisation on `document.getFields` / `updateFields`, then a
  right for a pending approver to edit **their own approval's subject step**,
  attributed and announced.
- `ApprovalStatus` gains **`approved_with_edits`**, derived at decision time when
  that approver edited their own subject step while pending. The approver's input
  enum stays at three values; a shared `isApproved(status)` predicate replaces
  every `=== "approved"` equality test.

## 3. Non-goals

Changes to approver resolution/delegation; new **approver-selectable** decisions
(the recorded status gains one, the input enum does not); migration;
multi-**subject** approvals (multi-*signature* is
in scope); operator-typed subjects; signature images; X.509 / PKI document
sealing; `(approval)` in xlsx templates; a public verification lookup surface;
approver-chosen routing at decision time; approver rights beyond their own
subject step or after their approval is decided; a segregation-of-duty toggle;
a full visited-node history on the checkpoint.

## 4. Approach

Bottom-up, test-first, with one exception to the ordering: **the missing
authorisation check on `document.getFields` / `updateFields` ships first**, as a
self-contained change, because it is exploitable today and nothing else here may
land on top of an unguarded procedure (ADR-045 §1).

After that, domain first — `approvalSubject`, `signatureFieldKey`,
`changesRequestedTarget`, and `signature` on `TemplateFieldType`, so the compiler
finds every exhaustive switch over field types. Resolve the subject at
approval-raise: step case reads the prior step's `SessionStepOutput`; custom case
makes one model call to summarise from gathered info + instruction, cached on the
pending approval. Point the approver's context at the subject rather than
`advancedFrom`, and resolve the document at read time. On decision, build the
attestation block, write the step-prefixed record into the existing
`record_snapshot` jsonb, and re-render the document through the ADR-024 revision
path — repointing `SessionDocument.storagePath` so downstream steps see the
signed copy. Replace the `advancedFrom` route-back with the configured target and
split cancel out of the change-request path. Surface subject, slot and return
target in the config modal, and editable subject fields in the approver's UI.
No schema change.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow-node.ts` | add `ApprovalNodeConfig.approvalSubject` (step \| custom; absent ⇒ step/last-completed), `signatureFieldKey?`, `changesRequestedTarget?` (step \| nearest_editable; absent ⇒ nearest_editable) |
| domain | `packages/domain/src/entities/template-field.ts` | `(approval)` annotation → `signature` type; reject combined types, numeric/length annotations, and use inside a `(repeat)` group; handle in `describeType`, `templateFieldToLine`, `validateTemplateFieldValue` |
| domain | `packages/domain/src/entities/node-output.ts` | `nodeFieldSet` filters `signature` out; `validateStructuredFieldSet` rejects it as it does `section` |
| domain | `packages/domain/src/entities/approval.ts` | document the step-prefixed `recordSnapshot` shape (no new column); add `approved_with_edits` to `ApprovalStatus` (not to `ApprovalDecision`) and an `isApproved(status)` predicate beside it |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | add `approved_with_edits` to the `status` text-column enum list. TS-only refinement, no CHECK constraint — **no migration** |
| domain | new — attestation block builder | pure: approval record → block text + verification code, canonicalised as in `audit-hash.ts` |
| application | approval-raise use-case (`packages/application/src/use-cases/session/…` approval) | resolve subject: step snapshot or one-call custom summary; attach to the pending approval |
| application | `packages/application/src/use-cases/approvals/list-pending-approvals-with-context.ts` | resolve `previousStep` from `approvalSubject`, not `advancedFrom`; resolve the document at read time so the current revision is shown |
| application | `packages/application/src/use-cases/approvals/decide-approval.ts` | freeze subject + step-prefixed metadata into `recordSnapshot`; fill the signature slot; trigger the document revision; route change requests to `changesRequestedTarget`; split cancel out of the route-back path; stop writing `advancedFrom: null` |
| application | new — return-target resolver | `nearest_editable` walks the taken path back to the first conversational node. Shares the taken-path helper with "last completed step" — one resolver, not two |
| application | approver-edit authorisation | a pending approver may edit fields of their own approval's subject step; edit recorded in `editHistory` and posted to the thread |
| application | `packages/application/src/use-cases/document/render-data.ts` | `buildRenderData` substitutes a `signature` field from the locked record; empty when undecided |
| application | `packages/application/src/use-cases/document/update-document-fields.ts` | reuse the existing re-render + `-r{n}` revision path for the signed document |
| adapters | approval repository | persist/read the extended snapshot (jsonb — no column) |
| adapters | `packages/adapters/src/documents/xlsx-generator.ts` | reject `(approval)` tags at upload with a message naming the limitation |
| web | `apps/web/src/components/canvas/node-config-modal-approval.tsx` | "What is being approved": prior-step dropdown (default last completed) + custom free-text; signature-slot dropdown when 2+ slots exist; "On changes requested, return to:" dropdown with an authoring-time warning when no editable step precedes the node |
| web | `apps/web/src/components/canvas/approval-node.tsx` | reflect configured subject and signature slot |
| web | `apps/web/src/server/routers/document.ts` | **first:** session-access authorisation on `getFields` / `updateFields`; then the scoped approver-edit right |
| web | approver decision UI | editable subject-step fields while the approval is pending; edit commits before the decision is taken |
| web | approval gate UI + email template (ADR-023) | display the subject statement |

## 6. Implementation steps (test-first per CLAUDE.md)

0. **Authorisation fix — ships first, on its own.** Add session-access checks to
   `document.getFields` and `document.updateFields`, using the ownership pattern
   already in `flow.ts`. Tests: a caller with no access to the message's session
   is rejected on both procedures; an owner and a participant still succeed.
   Check the E2E fixtures for any caller that relied on the open behaviour. This
   step is correct and shippable on its own and must not be bundled into a later
   commit (ADR-045 §1).
1. **Domain — config + record shape.** Add `approvalSubject`, `signatureFieldKey`
   and `changesRequestedTarget`; document the step-prefixed `recordSnapshot` keys.
   Tests: default subject resolves to `{ kind: "step" }` against last completed;
   default return target is `nearest_editable`; back-compat for absent config on
   all three.
2. **Domain — signature field type.** Add `signature` to `TemplateFieldType` and
   the `(approval)` annotation to the parser. Tests: `{{ Delegate Signature
   (approval) }}` parses with key `delegate_signature` and `optional: true`;
   combining `(approval)` with another type fails; `(maxlen:)` / `(options:)` on a
   signature fails; a signature inside `{{#group (repeat)}}` fails. Then let the
   compiler surface every exhaustive switch and handle each.
3. **Domain — never gathered.** `nodeFieldSet` filters `signature`;
   `validateStructuredFieldSet` rejects it. Tests: a template with a signature tag
   yields a field set without it; the field is absent from
   `buildFieldConstraintsText`; a structured field set containing one is rejected.
4. **Application — resolve at gate.** Step case reads the referenced
   `SessionStepOutput` and builds a statement + snapshot; custom makes one model
   call and caches the summary on the pending approval. Tests: step statement +
   snapshot; custom summary from gathered info; custom cached (no recompute per
   read); last-completed selection on a branch. Build the shared taken-path
   helper here — both "last completed step" and `nearest_editable` (step 8) use
   it.
4a. **Application — approver context follows the subject.** Repoint
   `list-pending-approvals-with-context.ts` from `advancedFrom` to
   `approvalSubject`, resolving the document at read time. Tests: in
   `conversational → approval A → approval B`, B's context returns the
   conversational step's **document**, not A's projected decision fields; the
   document returned is the current revision.
5. **Application — attestation block.** Pure builder: record → block text and a
   12-hex verification code over the canonical record, using the same
   canonicalisation as `AuditHashInput`. Tests: block contains name, email, role,
   decision, UTC timestamp and comment; a rejected decision renders as rejected;
   the code is stable for a fixed record and changes when any bound field changes.
6. **Application — lock on decision.** Freeze subject + `<step_key>.decision`,
   `.approver_name`, `.approver_email`, `.decided_at`, `.comment` into
   `recordSnapshot`; fill the configured slot; re-render the document as a new
   revision **and repoint `SessionDocument.storagePath`**. Tests: the five minimum
   keys are present and prefixed; two approval steps produce two non-colliding key
   sets; duplicate step labels get the `_2` suffix at config-save; the record does
   not change if the session continues; name/email are copied, not re-read, after
   a user rename; the prior revision survives; a re-render failure does not lose
   the decision; after A decides, a read of the conversational step's document
   returns the revision carrying A's signature with B's slot still empty.
7. **Application — change-request routing.** Resolve `changesRequestedTarget`
   (`nearest_editable` skips approval, auto, scheduled and MCP nodes); route
   `changes_requested` there; hold at the approval node with a surfaced error when
   nothing resolves; stop writing `advancedFrom: null`; leave cancel reachable
   only from `rejected` with route-back declined. Tests: B's change request lands
   on the conversational step, not approval A; **two change requests in a row both
   route** (the current build cancels on the second); an unresolvable target holds
   rather than cancels; an explicit reject-and-close still cancels.
8. **Application — approver field editing.** Authorise a pending approver to edit
   their own approval's subject step; record `editedByUserId` in `editHistory` and
   post a system message naming the approver and changed fields. Tests: the
   approver may edit their subject step; may not edit another step; may not edit
   after deciding; may not edit a session where they hold no pending approval; an
   edit-then-approve hashes the post-edit state; a later edit leaves an
   already-decided `recordSnapshot` untouched.
8a. **Domain + application — `approved_with_edits`.** Add the status variant and
   the `isApproved` predicate, then convert **every** `=== "approved"` site to it
   (`decide-approval.ts:89,143,200`, `approval-templates.ts:47`,
   `approvals/_content.tsx`, and any found by a fresh grep — the compiler will not
   flag a missed one). Derive the status at decision time from that approver's
   edits to their own subject step during their pending window; write
   `.edits_made` and `.edited_field_keys` into the record. Tests: edit-then-approve
   yields `approved_with_edits`; approve-without-editing yields `approved`;
   originator edits and another approver's edits do **not** qualify; **an
   `approved_with_edits` approval advances the session**; the router still accepts
   exactly three decision values.
9. **Adapters — repository + xlsx.** Persist/read the extended snapshot via jsonb;
   round-trip subject and record keys with no schema change. xlsx upload rejects
   `(approval)` with a clear message.
10. **Web — config UI.** Prior-step dropdown defaulting to last completed + custom
    free-text; signature-slot dropdown when the template declares 2+ slots, hidden
    and auto-bound at exactly one, absent at zero; reject two nodes targeting the
    same slot; "On changes requested, return to:" dropdown with an authoring-time
    warning when no editable step precedes the node. Tests cover each count, both
    subject kinds, and the no-editable-predecessor warning.
11. **Web — approver UI, gate + email.** Editable subject-step fields in the
    decision UI, committing before the decision is taken. Surface "Approved with
    edits" in the approvals list, the decision chat message and the approval
    notification. Show "You are requesting approval of: …" at the gate and in the
    approver request/email.
12. **Version + validate.** Bump `VERSION` and `package.json#version` to `0.22.0`
    (re-confirm against the base branch first). Run `./validate.sh`; fix all
    failures. Move this phase doc to `docs/development/implemented/alpha-2/v0.22.0/`
    with a summary.

## 7. Acceptance criteria

Mirror PRD §10:

- [ ] Config offers a prior-step dropdown defaulting to the last completed step,
      plus a custom free-text option.
- [ ] Step case resolves a readable statement and captures the step's snapshot.
- [ ] Custom case produces an AI subject statement from gathered info + instruction.
- [ ] Subject is shown to the operator at the gate and to the approver in the
      request and email.
- [ ] Resolved subject is locked into `recordSnapshot` at decision time and never
      changes afterwards.
- [ ] Pre-feature approvals (no `approvalSubject`) still work, defaulting to the
      last completed step.
- [ ] `{{ Delegate Signature (approval) }}` parses to a `signature` field; invalid
      combinations and use inside a `(repeat)` group are rejected.
- [ ] A `signature` field is never gathered, never blocks readiness, and cannot be
      edited manually.
- [ ] On decision the slot renders the attestation block and the document is
      written as a new revision with the prior one retained; a rejected decision
      renders as rejected; an undecided slot renders empty.
- [ ] A template with 2+ signature fields shows a slot dropdown; exactly one binds
      automatically; two nodes cannot target the same slot.
- [ ] `recordSnapshot` keys are step-prefixed and include at least `decision`,
      `approver_name`, `approver_email`, `decided_at` and `comment`.
- [ ] An xlsx template containing an `(approval)` tag is rejected at upload.
- [ ] In `conversational → approval A → approval B`, B's request shows the
      document at the revision carrying A's signature, with B's slot empty.
- [ ] The config offers "On changes requested, return to:", defaulting to the
      nearest prior conversational step.
- [ ] `changes_requested` routes to the configured target; an unresolvable target
      **holds** the session with an error and never cancels it; two change
      requests in a row both route correctly.
- [ ] Only `rejected` with route-back declined can cancel a session.
- [ ] `document.getFields` / `updateFields` reject a caller with no access to the
      message's session.
- [ ] A pending approver can edit their own approval's subject step and nothing
      else; the edit is attributed in `editHistory` and announced in the thread.
- [ ] Edit-then-approve hashes the post-edit state; a later edit does not alter an
      already-decided `recordSnapshot`, and the signed revision stays retrievable.
- [ ] An approver who edits their subject step then approves produces
      `approved_with_edits`; approving without editing produces `approved`; the
      originator's or another approver's edits do not qualify.
- [ ] An `approved_with_edits` approval advances the session exactly as
      `approved` does, asserted directly.
- [ ] "Approved with edits" appears in the approvals UI, the decision chat message
      and the notification; `<step_key>.decision` carries it in the record.
- [ ] The `approval.decide` router still accepts exactly three decision values.
- [ ] Architecture intact (Result at boundaries); no migration.
- [ ] `VERSION` = `package.json#version` = `0.22.0`; `./validate.sh` passes.

## 8. Risks / open questions

- Cache the custom summary on the pending approval so it is not recomputed per
  render.
- Precise "last completed step" on a branching flow — the step whose output most
  recently preceded the approval on the taken path.
- Show the field snapshot inline at the gate or only the statement (leaning
  statement + expandable snapshot).
- Adding a `TemplateFieldType` touches every exhaustive switch over field types —
  add it in the domain first and use the compiler to find the call sites.
- Decision now writes a document revision, so storage can fail after a valid
  decision. The record must still be written; a failed re-render is a retryable
  follow-up, never a lost approval.
- Step keys derive from node labels, so renaming a step changes the prefix for
  later approvals while existing records keep the old one.
- The attestation block is **not** a qualified electronic signature and must not
  be described as one in any UI copy.
- The signature slot lives on the subject step's template. Behaviour when the
  subject is `custom` (no template in play) needs confirming at build — expected:
  no slot control, and the approval records no signature.
- The authorisation fix (step 0) may break a caller that relied on the open
  procedures; check the E2E fixtures before assuming none does.
- `nearest_editable` and "last completed step" both need the taken path on a
  branching flow — build one resolver in step 4 and use it in step 7, or they
  will drift.
- A flow whose approval precedes any conversational step has no editable return
  target; warn at authoring time rather than at decision time.
- Approver editing concentrates authorship and sign-off in one person by design;
  segregation-of-duty flows will want a toggle (out of scope, §3).
- **Open:** whether an edit after signing should mark that attestation block as
  superseded in the current revision. Recomputing the hash is not an option — it
  would re-sign on the signer's behalf. Leaning towards a "superseded by a later
  edit" note (ADR-045 §5).
- Step 7 changes behaviour for anyone depending on the current
  cancel-on-second-change-request; release-note material.
- The `approved_with_edits` conversion (step 8a) is the highest-risk edit in the
  phase: `=== "approved"` sites still compile when missed and simply stop being
  true, so an edited approval would silently fail to advance. Grep fresh rather
  than trusting the listed line numbers, and assert the advance path.
- Downstream consumers of `status` (n8n record export, ADR-020) will see a new
  value; release-note material.
