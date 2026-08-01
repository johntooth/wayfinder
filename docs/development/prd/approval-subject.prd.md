# PRD — Approval Subject, Signature & Record

- **Status**: Draft (scope extended 2026-08-01 — signature tag, slot selection, record metadata)
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
- Where a template declares **more than one** signature slot, the approval node
  config offers a **dropdown to choose which slot this step fills**, so a
  document requiring several sign-offs is built from several approval steps.
- The approval record is **namespaced by step**, so a flow with several approval
  steps produces a report-ready record that names, at minimum, the **date/time,
  approver name, approver email, decision and comment** for each.

## 4. Non-goals

- No change to approver **resolution** (`approverSource`, delegation) — this PRD is
  only about the subject, the signature and the record.
- No new decision outcomes (`approved` / `rejected` / `changes_requested`
  unchanged).
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
| `Approval.recordSnapshot` | `packages/domain/src/entities/approval.ts` | existing (reuse) | now carries the step-prefixed record — `<step_key>.decision`, `.approver_name`, `.approver_email`, `.decided_at`, `.comment`, plus `.subject_description` / `.subject_node_id` — locked at decision time. |
| `TemplateFieldType: "signature"` | `packages/domain/src/entities/template-field.ts` | existing (add variant) | parsed from the `(approval)` annotation. Excluded from `nodeFieldSet`, so it is never gathered conversationally. |
| `ApprovalNodeConfig.signatureFieldKey` | `packages/domain/src/entities/flow-node.ts` | existing (add field) | which signature slot this approval step fills. Auto-bound when the template has exactly one; chosen from a dropdown when it has several. |
| Attestation block | `packages/application` (render path) | new (pure builder) | the rendered signature value: name, email, role, decision, UTC timestamp, comment and a verification code derived from the ADR-033 hash chain. |

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
7. As a **flow owner**, when my template has several signature slots I can say
   which one each approval step signs.
8. As an **approver**, my decision, comment and identity appear in the document
   itself once I decide.
9. As a **reporting user**, I can read a flow's approvals and tell each step's
   decision apart by name, with the date/time, approver, decision and comment.

## 7. Pages / surfaces affected

- `apps/web/src/components/canvas/node-config-modal-approval.tsx` — the "What is
  being approved" selector (prior-step dropdown defaulting to last completed +
  custom free-text) **and** the signature-slot dropdown (shown only when the
  subject step's template declares more than one signature field).
- Approval-raise application use-case — resolve the subject (step snapshot or AI
  summary), attach to the approval, snapshot at decision.
- Approval-decision use-case (`decide-approval.ts`) — build the attestation
  block, write the step-prefixed record, re-render the document revision.
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
| `app_flow_nodes` | none (jsonb `config` gains `approvalSubject`, `signatureFieldKey`) | n/a |
| `app_session_approvals` | none (jsonb `record_snapshot` gains the step-prefixed record) | n/a |

## 9. Architectural decisions

- **New:** ADR-040 — Approval subject resolution, decision-time snapshot, and
  step-prefixed record metadata (§5).
- **New:** ADR-043 — Approval signature tag, slot selection and the attestation
  block.
- **Assumes:** ADR-018 (approval step & approver resolution), ADR-023 (email
  notification transport), ADR-024 (document re-render and revision retention),
  ADR-033 (append-only audit log and hash chain), ADR-038 (step output types),
  ADR-039 (xlsx template format), the `FieldValueSource` `step_field` precedent.
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
- [ ] A template with 2+ signature fields shows a slot dropdown in the approval
      node config; with exactly one it binds automatically; two nodes cannot
      target the same slot.
- [ ] `recordSnapshot` keys are prefixed with the step key and include at least
      `decision`, `approver_name`, `approver_email`, `decided_at` and `comment`
      for every decided approval.
- [ ] A flow with two approval steps produces two distinguishable, non-colliding
      key sets in one record.
- [ ] An xlsx template containing an `(approval)` tag is rejected at upload with
      a message naming the limitation.
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
