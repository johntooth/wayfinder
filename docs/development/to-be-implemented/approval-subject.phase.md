# Phase — Approval Subject, Signature & Record

- **Status**: Awaiting review (scope extended 2026-08-01 — signature tag, slot selection, record metadata)
- **Target version**: 0.22.0  (bump: MINOR — new feature, additive `app_flow_nodes.config` + `app_session_approvals.record_snapshot` jsonb; no migration. Computed from the `release/alpha-2` line at `0.21.7` — re-confirm against `VERSION` on the base branch at build time.)
- **Base branch**: `release/alpha-2`
- **PRD**: `docs/development/prd/approval-subject.prd.md`
- **ADRs**: ADR-040 (config mirrors `FieldValueSource`, resolve-once at gate, lock at decision, step-prefixed record, no migration), ADR-043 (`(approval)` annotation → `signature` field type, gathering exclusion, slot selection, attestation block)
- **Depends on**: approval step (ADR-018, `Approval` entity, `node-config-modal-approval.tsx`), `FieldValueSource` / `PriorStepField` (`packages/domain/src/entities/field-value-source.ts`), template-field parser (`packages/domain/src/entities/template-field.ts`), `nodeFieldSet` (`node-output.ts`), document re-render + revision retention (ADR-024, `update-document-fields.ts`), audit hash chain (ADR-033, `audit-hash.ts`), email transport (ADR-023), `recordSnapshot` on `app_session_approvals`

## 1. Problem

An approval node configures *who* approves but never *what*. The approver sees no
explicit subject, and the `Approval` record does not pin the subject at decision
time. Three gaps sit alongside it: the approved **document** carries no evidence
of the decision, a document needing **several** signatures cannot say which step
signs which slot, and a flow with more than one approval produces a record a
report cannot tell apart. See the PRD.

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

## 3. Non-goals

Changes to approver resolution/delegation; new decision outcomes; migration;
multi-**subject** approvals (multi-*signature* is in scope); operator-typed
subjects; signature images; X.509 / PKI document sealing; `(approval)` in xlsx
templates; a public verification lookup surface.

## 4. Approach

Bottom-up, test-first. Add `approvalSubject` to the config (reusing the
`FieldValueSource` shape) and `signature` to `TemplateFieldType` — the domain
first, so the compiler finds every exhaustive switch over field types. Resolve
the subject at approval-raise: step case reads the prior step's
`SessionStepOutput`; custom case makes one model call to summarise from gathered
info + instruction, cached on the pending approval. On decision, build the
attestation block, write the step-prefixed record into the existing
`record_snapshot` jsonb, and re-render the document through the ADR-024 revision
path. Surface subject and slot in the config modal, the gate UI and the email.
No schema change.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow-node.ts` | add `ApprovalNodeConfig.approvalSubject` (step \| custom; absent ⇒ step/last-completed) and `signatureFieldKey?` |
| domain | `packages/domain/src/entities/template-field.ts` | `(approval)` annotation → `signature` type; reject combined types, numeric/length annotations, and use inside a `(repeat)` group; handle in `describeType`, `templateFieldToLine`, `validateTemplateFieldValue` |
| domain | `packages/domain/src/entities/node-output.ts` | `nodeFieldSet` filters `signature` out; `validateStructuredFieldSet` rejects it as it does `section` |
| domain | `packages/domain/src/entities/approval.ts` | document the step-prefixed `recordSnapshot` shape (no new column) |
| domain | new — attestation block builder | pure: approval record → block text + verification code, canonicalised as in `audit-hash.ts` |
| application | approval-raise use-case (`packages/application/src/use-cases/session/…` approval) | resolve subject: step snapshot or one-call custom summary; attach to the pending approval |
| application | `packages/application/src/use-cases/approvals/decide-approval.ts` | freeze subject + step-prefixed metadata into `recordSnapshot`; fill the signature slot; trigger the document revision |
| application | `packages/application/src/use-cases/document/render-data.ts` | `buildRenderData` substitutes a `signature` field from the locked record; empty when undecided |
| application | `packages/application/src/use-cases/document/update-document-fields.ts` | reuse the existing re-render + `-r{n}` revision path for the signed document |
| adapters | approval repository | persist/read the extended snapshot (jsonb — no column) |
| adapters | `packages/adapters/src/documents/xlsx-generator.ts` | reject `(approval)` tags at upload with a message naming the limitation |
| web | `apps/web/src/components/canvas/node-config-modal-approval.tsx` | "What is being approved": prior-step dropdown (default last completed) + custom free-text; signature-slot dropdown when 2+ slots exist |
| web | `apps/web/src/components/canvas/approval-node.tsx` | reflect configured subject and signature slot |
| web | approval gate UI + email template (ADR-023) | display the subject statement |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — config + record shape.** Add `approvalSubject` and
   `signatureFieldKey`; document the step-prefixed `recordSnapshot` keys. Tests:
   default resolves to `{ kind: "step" }` against last completed; back-compat for
   absent config.
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
   read); last-completed selection on a branch.
5. **Application — attestation block.** Pure builder: record → block text and a
   12-hex verification code over the canonical record, using the same
   canonicalisation as `AuditHashInput`. Tests: block contains name, email, role,
   decision, UTC timestamp and comment; a rejected decision renders as rejected;
   the code is stable for a fixed record and changes when any bound field changes.
6. **Application — lock on decision.** Freeze subject + `<step_key>.decision`,
   `.approver_name`, `.approver_email`, `.decided_at`, `.comment` into
   `recordSnapshot`; fill the configured slot; re-render the document as a new
   revision. Tests: the five minimum keys are present and prefixed; two approval
   steps produce two non-colliding key sets; duplicate step labels get the `_2`
   suffix at config-save; the record does not change if the session continues;
   name/email are copied, not re-read, after a user rename; the prior revision
   survives; a re-render failure does not lose the decision.
7. **Adapters — repository + xlsx.** Persist/read the extended snapshot via jsonb;
   round-trip subject and record keys with no schema change. xlsx upload rejects
   `(approval)` with a clear message.
8. **Web — config UI.** Prior-step dropdown defaulting to last completed + custom
   free-text; signature-slot dropdown when the template declares 2+ slots, hidden
   and auto-bound at exactly one, absent at zero; reject two nodes targeting the
   same slot. Tests cover each count and both subject kinds.
9. **Web — gate + email.** Show "You are requesting approval of: …" at the gate and
   in the approver request/email.
10. **Version + validate.** Bump `VERSION` and `package.json#version` to `0.22.0`
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
