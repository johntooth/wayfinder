# PRD — Approval Subject, Signature, Record, Routing & Approver Editing

- **Status**: Draft (scope extended 2026-08-01 — signature tag, slot selection, record metadata, change-request routing, approver field editing)
- **Date**: 2026-07-19
- **Author**: rbrasier
- **Target version**: 0.22.0  (bump: MINOR — new feature, additive `app_flow_nodes.config` + `app_session_approvals.record_snapshot` jsonb; no migration. Computed from the `release/alpha-2` line at `0.21.7`; re-confirm against `VERSION` on the base branch at build time. See `docs/guides/versioning.md`.)

## 1. Problem

An approval node configures *who* approves (`approverSource`) but never states
*what* is being approved. The approver sees a request with no explicit subject,
and the stored `Approval` row does not pin the subject as it stood at the moment
of decision. For a governance feature whose whole value is an auditable decision
trail, "approved — but approving what, exactly?" is a real gap.

Three related gaps sit alongside it:

- **The document carries no evidence of the decision.** A generated instrument
  looks identical before and after sign-off. There is no way to put a signature
  into a template, and no field type that could hold one safely — every existing
  type is something the conversation asks the operator to supply, which is
  exactly what a signature must never be.
- **Documents needing several signatures cannot be expressed.** A delegation
  instrument may need delegate, finance and legal sign-off. Nothing says which
  approval step owns which signature slot.
- **A flow with more than one approval produces an unreadable record.** Decision
  metadata is not namespaced, so a report cannot tell the manager approval from
  the finance approval, and the approver's name and email are not captured for
  reporting at all.

Making multi-signature documents ordinary exposes three further defects in
sequential approvals, all reachable in today's code:

- **The second approver is shown the wrong thing.** Approval context resolves
  from `session.graphCheckpoint.advancedFrom`, a single-slot back-pointer. After
  approval A advances to approval B, that points at A — a node with no document —
  so B sees A's decision metadata instead of the document it is signing.
- **A change request returns to the wrong step, then destroys the session.**
  Route-back targets the same back-pointer, so B's change request parks the
  session on approval A, where nothing can be edited. Route-back also clears the
  pointer, so the *next* change request finds no target and **cancels the
  session** outright.
- **Document field access is not authorised at all.** `document.getFields` and
  `document.updateFields` carry no session-ownership check, so any authenticated
  user with a message UUID can read and edit another user's document fields.
  This is a live defect independent of every feature here, and it is why an
  approver cannot be *granted* edit rights until it is fixed.

## 2. Users / Personas

- **Flow owner** — configures the approval step and wants to name what the
  approver is signing off (the output of a prior step, or a described subject).
- **Operator** — reaches the approval gate and sees a clear statement of the
  subject before it goes to the approver.
- **Approver** — decides against an explicit, unambiguous subject.
- **Auditor** — reads back exactly what was approved, as it stood at decision time.

## 3. Goals

- The approval node config gains a **"What is being approved"** control:
  - a **dropdown of prior steps** (defaulting to the **last completed step**), or
  - a **custom** free-text instruction the AI interprets from the information
    gathered so far to produce a subject statement.
- At runtime the subject **resolves** to two things:
  - a **human-readable statement** shown to the operator at the gate and to the
    approver in the request/email, and
  - the referenced step's **output snapshot** (for the step case).
- The resolved subject — including the AI's summary for the custom case — is
  **locked at decision time** into the approval's `recordSnapshot`, so the record
  is immutable and auditable and never drifts if the session continues.
- A document template can declare a **signature slot** with a new
  `{{ Delegate Signature (approval) }}` tag, which the conversational node
  **never asks the operator for** and which is filled from the approval record
  when the decision is made.
- Where a template declares **one or more** signature slots, the approval node
  config offers a **dropdown to choose which slot this step fills**, so a
  document requiring several sign-offs is built from several approval steps.
  A single slot arrives pre-selected rather than hidden, so the author can always
  see what the step signs.
- The approval record is **namespaced by step**, so a flow with several approval
  steps produces a report-ready record that names, at minimum, the **date/time,
  approver name, approver email, decision and comment** for each.
- **Every approver sees the document they are actually signing**, resolved from
  the configured subject and at its current revision — so a second approver sees
  the first approver's signature already in place.
- The approval node config gains **"On changes requested, return to:"** — a
  dropdown over prior steps, defaulting to the nearest prior step an operator can
  actually edit — and a session can no longer be cancelled by a failure to
  resolve that target.
- **An approver can correct a field and approve**, rather than making a round
  trip over a typo. The edit is scoped to their own approval's subject step,
  attributed, announced in the thread, and bound into what they sign.
- **An approval carrying the approver's own edits is recorded as
  `approved_with_edits`**, derived from the edit record rather than self-declared,
  so "approved as submitted" and "approved after the approver changed it" are
  distinguishable in the UI, the notification and the report.
- **Document field access is authorised** against the session — a fix that ships
  first, before any approver capability is added on top of it.

## 4. Non-goals

- No change to approver **resolution** (`approverSource`, delegation) — this PRD is
  about the subject, the signature, the record, routing and approver editing.
- No new **approver-selectable** decisions — the approver still chooses between
  `approved`, `rejected` and `changes_requested`. The recorded **status** gains
  `approved_with_edits`, which the system derives; the approver never picks it.
- The approver does **not** choose the change-request return step at decision
  time; it is authored on the node, like the subject.
- No approver rights beyond their own approval's subject step, and none once the
  approval is decided.
- No segregation-of-duty toggle to forbid edit-then-approve (noted as future work).
- No database migration — config, snapshot and signature all ride existing jsonb.
- **One subject per approval node.** Multiple *signatures* on one document are
  supported (one per approval step); one approval node approving several
  unrelated subjects is not.
- No handwritten-signature images and no X.509 / PKI document sealing — see
  ADR-043 for why, and §11 for when they would be revisited.
- Signature tags are **docx only**; xlsx templates reject them at upload.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `ApprovalNodeConfig.approvalSubject` | `packages/domain/src/entities/flow-node.ts` | existing (add field) | `{ kind: "step"; nodeId }` (default: last completed) \| `{ kind: "custom"; instruction }`. Mirrors the `FieldValueSource` shape. |
| `PriorStepField` / prior-step resolution | `packages/domain/src/entities/field-value-source.ts` | existing (reuse) | supplies the config-time list of prior steps to choose from. |
| `Approval.recordSnapshot` | `packages/domain/src/entities/approval.ts` | existing (reuse) | now carries the step-prefixed record — `<step_key>.decision`, `.approver_name`, `.approver_email`, `.decided_at`, `.comment`, plus `.edits_made` / `.edited_field_keys` and `.subject_description` / `.subject_node_id` — locked at decision time. |
| `ApprovalStatus` | `packages/domain/src/entities/approval.ts` | existing (add variant) | gains `approved_with_edits`, derived at decision time. `ApprovalDecision` (the approver's input) is unchanged at three values. No migration — `status` is a `text` column with a TS-only enum and no CHECK constraint. |
| `isApproved(status)` | `packages/domain/src/entities/approval.ts` | new (predicate) | the single definition of "this approval approved", for future readers. No existing site needs converting — control flow branches on `decision`, not `status`. |
| `TemplateFieldType: "signature"` | `packages/domain/src/entities/template-field.ts` | existing (add variant) | parsed from the `(approval)` annotation. Excluded from `nodeFieldSet`, so it is never gathered conversationally. |
| `ApprovalNodeConfig.signatureFieldKey` | `packages/domain/src/entities/flow-node.ts` | existing (add field) | which signature slot this approval step fills. Chosen from a dropdown whenever the subject step declares any; pre-selected when there is only one. Left empty on a lone-slot template, the decision binds that slot at runtime so flows saved before v0.26.2 still sign. |
| Attestation block | `packages/application` (render path) | new (pure builder) | the rendered signature value: name, email, role, decision, UTC timestamp, comment and a verification code derived from the ADR-033 hash chain. |
| `ApprovalNodeConfig.changesRequestedTarget` | `packages/domain/src/entities/flow-node.ts` | existing (add field) | `{ kind: "step"; nodeId }` \| `{ kind: "nearest_editable" }` (default). Where a change request returns the session. |
| `PendingApprovalContext.previousStep` | `packages/application/src/use-cases/approvals/list-pending-approvals-with-context.ts` | existing (change) | resolves from `approvalSubject` instead of `advancedFrom`, at read time so the current revision is shown. |
| Document field authorisation | `apps/web/src/server/routers/document.ts` | existing (fix) | `getFields` / `updateFields` gain a session-access check; then a scoped right for the pending approver of that step. |

## 6. User stories

1. As a **flow owner**, I can choose which prior step's output the approval is
   against, defaulting to the last completed step.
2. As a **flow owner**, I can instead type a custom instruction and have the AI
   describe the subject from what the session has gathered.
3. As an **operator**, I see a clear "You are requesting approval of: …" statement
   at the gate before sending.
4. As an **approver**, the request and email state exactly what I am approving.
5. As an **auditor**, the approval record shows the subject as it stood when the
   decision was made, and it never changes afterwards.
6. As a **template author**, I can place `{{ Delegate Signature (approval) }}` in
   a .docx and know the operator will never be asked to fill it in.
7. As a **flow owner**, when my template declares signature slots I can say which
   one each approval step signs, and see that choice whether there is one slot or
   several.
8. As an **approver**, my decision, comment and identity appear in the document
   itself once I decide.
9. As a **reporting user**, I can read a flow's approvals and tell each step's
   decision apart by name, with the date/time, approver, decision and comment.
10. As a **second approver**, I open the request and see the document itself, at
    its current revision, with the first approver's signature already on it.
11. As a **flow owner**, I can say which step a change request returns to, so it
    lands where the work can actually be done.
12. As an **operator**, a change request never cancels my session — it returns me
    to an editable step, or holds and tells me why it could not.
13. As an **approver**, I can correct a field on the step I am approving and then
    approve, instead of sending it back over a typo.
14. As an **originator**, an approver's edit appears in the thread naming who
    changed what, and in the document's edit history.
15. As an **auditor**, I can tell an approval that was accepted as submitted from
    one the approver changed before signing, from the status alone.

## 7. Pages / surfaces affected

- `apps/web/src/components/canvas/node-config-modal-approval.tsx` — the "What is
  being approved" selector (prior-step dropdown defaulting to last completed +
  custom free-text), the signature-slot dropdown (shown whenever the subject
  step's template declares at least one signature field), **and** the "On
  changes requested, return to:" dropdown.
- `apps/web/src/components/canvas/field-row-model.ts` and `field-row.tsx` — the
  guided annotation editor, which must be able to hold and re-emit a signature
  row unchanged, since every reviewed row is written back into the stored `.docx`.
- `apps/web/src/components/canvas/annotation-reference.tsx` and
  `template-tags-help-dialog.tsx` — the two places a template author reads the
  annotation grammar, both of which must list `(approval)`.
- Approval-raise application use-case — resolve the subject (step snapshot or AI
  summary), attach to the approval, snapshot at decision.
- `list-pending-approvals-with-context.ts` — resolve the approver's document /
  fields panel from `approvalSubject` rather than `advancedFrom`.
- Approval-decision use-case (`decide-approval.ts`) — build the attestation
  block, write the step-prefixed record, re-render the document revision, and
  route a change request to the configured target instead of the back-pointer.
- `apps/web/src/server/routers/document.ts` — session-access authorisation on
  `getFields` / `updateFields`, then the scoped approver-edit right.
- The approver's decision UI — editable fields for the subject step while the
  approval is pending.
- Template parsing and gathering — `template-field.ts` (`(approval)` annotation),
  `node-output.ts` (`nodeFieldSet` exclusion), `render-data.ts` (signature
  substitution).
- Approval gate UI + approval email transport (ADR-023) — display the subject.
- `apps/web/src/components/canvas/approval-node.tsx` — reflect configured subject
  and the signature slot it fills.

## 8. Database changes

None. `approvalSubject` and `signatureFieldKey` ride `app_flow_nodes.config`; the
locked subject, the step-prefixed record and the signature all ride the existing
`app_session_approvals.record_snapshot` jsonb. The signed document is a new object
revision through the existing generated-document storage path (ADR-024), not a
new table.

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_flow_nodes` | none (jsonb `config` gains `approvalSubject`, `signatureFieldKey`, `changesRequestedTarget`) | n/a |
| `app_session_approvals` | none (jsonb `record_snapshot` gains the step-prefixed record) | n/a |

## 9. Architectural decisions

- **New:** ADR-040 — Approval subject resolution, decision-time snapshot, and
  step-prefixed record metadata (§5).
- **New:** ADR-043 — Approval signature tag, slot selection and the attestation
  block.
- **New:** ADR-044 — Change-request routing target and back-pointer repair.
- **New:** ADR-045 — Approver field editing and document authorisation.
- **Assumes:** ADR-018 (approval step & approver resolution), ADR-021 (RBAC),
  ADR-023 (email notification transport), ADR-024 (document re-render, revision
  retention, `editHistory`), ADR-033 (append-only audit log and hash chain),
  ADR-038 (step output types), ADR-039 (xlsx template format), the
  `FieldValueSource` `step_field` precedent.
- **Related but not used:** ADR-042 brings client-certificate PKI under runtime
  auth config. That is *sign-in* authentication and provides no document-signing
  credential; the signature here does not depend on it.

## 10. Acceptance criteria

- [ ] Approval node config offers a prior-step dropdown defaulting to the last
      completed step, plus a custom free-text option.
- [ ] Step case: the subject resolves to a readable statement and captures the
      referenced step's output snapshot.
- [ ] Custom case: the AI produces a subject statement from gathered information +
      the instruction.
- [ ] The subject statement is shown to the operator at the gate and to the
      approver in the request and email.
- [ ] The resolved subject (incl. the AI summary) is locked at decision time into
      `recordSnapshot` and does not change if the session continues.
- [ ] An approval created before this feature (no `approvalSubject`) still works,
      defaulting to the last completed step.
- [ ] `{{ Delegate Signature (approval) }}` parses to a `signature` field and is
      rejected when combined with any other type annotation, or when placed
      inside a `{{#group (repeat)}}` block.
- [ ] A `signature` field never appears in the conversational prompt, never
      blocks step readiness, and cannot be edited manually.
- [ ] On decision, the slot renders the attestation block — approver name, email,
      role, decision, UTC timestamp, comment and verification code — and the
      document is written as a new revision with the prior one retained.
- [ ] A `rejected` / `changes_requested` decision renders the block naming that
      decision; an undecided slot renders empty.
- [ ] A template with 1+ signature fields shows a slot dropdown in the approval
      node config, pre-selected when there is exactly one; two nodes cannot
      target the same slot.
- [ ] An approval node saved with no `signatureFieldKey` against a subject step
      declaring exactly one signature still signs that slot on decision; with two
      or more it signs none, rather than guessing.
- [ ] A `(approval)` row survives the guided annotation editor untouched — it
      loads as a signature, not as text, and saving re-emits
      `{{ Name (approval) }}` rather than rewriting the author's document.
- [ ] `(approval)` appears in the annotation reference and the template tags help
      dialog, and is selectable as a field type in the template editor but not in
      the structured-conversation editor.
- [ ] `recordSnapshot` keys are prefixed with the step key and include at least
      `decision`, `approver_name`, `approver_email`, `decided_at` and `comment`
      for every decided approval.
- [ ] A flow with two approval steps produces two distinguishable, non-colliding
      key sets in one record.
- [ ] An xlsx template containing an `(approval)` tag is rejected at upload with
      a message naming the limitation.
- [ ] In `conversational → approval A → approval B`, B's request shows the
      **document** (not A's decision fields), at the revision carrying A's
      signature, with B's own slot still empty.
- [ ] The approval config offers "On changes requested, return to:", defaulting
      to the nearest prior conversational step and skipping approval, auto,
      scheduled and MCP nodes.
- [ ] `changes_requested` routes to the configured target; when no target can be
      resolved the session **holds at the approval node with an error** and is
      never cancelled.
- [ ] Only `rejected` with route-back declined can cancel a session.
- [ ] Two change requests in a row on one session both route correctly (the
      current build cancels on the second).
- [ ] `document.getFields` / `updateFields` reject a caller with no access to the
      message's session — verified by a test that asserts the pre-fix behaviour
      is gone.
- [ ] A pending approver can edit fields of their own approval's subject step,
      and cannot edit any other step or any session where they hold no pending
      approval.
- [ ] An approver's edit records `editedByUserId` in `editHistory` and posts a
      system message naming the approver and the changed fields.
- [ ] An approver who edits then approves produces a verification hash over the
      **post-edit** state.
- [ ] A later edit does not alter an already-decided approval's `recordSnapshot`,
      and the signed revision remains retrievable.
- [ ] An approver who edits their subject step and then approves produces status
      `approved_with_edits`; one who approves without editing produces `approved`.
- [ ] Edits by the originator, or by a *different* approver, do not make an
      approval `approved_with_edits`.
- [ ] An `approved_with_edits` approval **advances the session** exactly as
      `approved` does (a regression guard — advancement branches on `decision`,
      so this should pass without any change to the advance path).
- [ ] An ESLint rule rejects a literal comparison against an approval status
      outside the domain, verified by a fixture that fails lint.
- [ ] The status reads "Approved with edits" in the approvals UI, the decision
      chat message and the approval notification.
- [ ] `<step_key>.decision` reads `approved_with_edits`, with `.edits_made` and
      `.edited_field_keys` alongside.
- [ ] The `approval.decide` router still accepts exactly three decision values.
- [ ] `VERSION` = `package.json#version` = `0.22.0`; `./validate.sh` passes.

## 11. Out of scope / future work

- Multi-subject / bundled approvals (one node approving several subjects).
- Approver-side editing of the subject.
- Handwritten-signature images — deferred; would add a docxtemplater image module
  and a `core_user_signatures` table, and would sit *beside* the attestation
  block, never replace it (ADR-043).
- X.509 / PKI document sealing (AdES-grade) — revisit if a regulated customer
  requires qualified signatures. The attestation block is a strict subset of what
  a sealed document carries, so records made now stay valid.
- A verification surface (`/verify/<code>` lookup against the audit chain).
- Indexed columns for subject- or approval-level reporting, if jsonb reads prove
  too slow.
- A per-flow segregation-of-duty toggle forbidding edit-then-approve by the same
  person (ADR-045).
- A full visited-node history on the session checkpoint — useful for other
  reasons, but not a substitute for the configured routing target (ADR-044).
- Approver-proposed edits requiring originator acceptance, rather than direct
  edits (ADR-045).

## 12. Risks / open questions

- Custom-case AI summary cost — one model call at gate time; confirm caching so it
  is not recomputed on every render.
- "Last completed step" resolution on a branching flow — define it as the step
  whose output most recently preceded the approval node on the taken path.
- Whether to also show the step's field snapshot inline at the gate, or just the
  statement (leaning: statement + expandable snapshot).
- Adding a `TemplateFieldType` touches every exhaustive switch over field types;
  add the type in the domain first and let the compiler find the call sites.
- Decision now writes a document revision, so storage can fail after a valid
  decision. The record must still be written — a failed re-render is a retryable
  follow-up, never a lost approval.
- Step keys derive from node labels, so renaming a step changes the prefix for
  later approvals while existing records keep the old one. Correct for audit;
  reports spanning a rename must tolerate two key sets.
- The attestation block is **not** a qualified electronic signature. Every place
  it is described to users must say so.
- The unauthorised-access fix on `getFields` / `updateFields` may break a caller
  that relied on their being open — check the E2E fixtures before assuming none
  does.
- The fourth `ApprovalStatus` value is safe against **today's** code — advancement
  and every decision branch read `decision`, not `status`, and nothing compares
  `approval.status` to `"approved"`. The exposure is future code: a
  `status === "approved"` written later would silently exclude edited approvals
  and the compiler would not object. Mitigated by an ESLint rule rather than by
  converting sites that do not need it.
- Consumers outside this repo that read `status` — an n8n record export (ADR-020),
  any downstream report — will encounter a value they have not seen before.
- `nearest_editable` and "last completed step" both need the taken path on a
  branching flow. One resolver serving both, or they will drift.
- A flow whose approval precedes any conversational step has no editable return
  target; warn at authoring time, not at decision time.
- Approver editing concentrates authorship and sign-off in one person by design.
  Flows with segregation-of-duty requirements will need the toggle listed in §11.
- **Open:** whether an edit made after a signature should mark that attestation
  block as superseded in the current revision. Recomputing the hash is not an
  option — it would re-sign on the signer's behalf. Leaning towards a
  "superseded by a later edit" note (ADR-045 §5).
