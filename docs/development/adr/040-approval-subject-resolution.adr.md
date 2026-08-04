# ADR-040 — Approval Subject Resolution & Decision-Time Snapshot

- **Status**: Proposed (scoped by `approval-subject.prd.md`)
- **Date**: 2026-07-19
- **Extended**: 2026-08-01 — §5 (step-prefixed record metadata); §2 (approver
  context resolves from `approvalSubject`, not `advancedFrom`)
- **See also**: ADR-043 (approval signature tag, slot selection, attestation
  block), which consumes the record this ADR locks; ADR-044 (change-request
  routing), which replaces the other `advancedFrom` read; ADR-045 (approver
  field editing)

## Context

An approval node (ADR-018) configures *who* approves via `approverSource` but
never captures *what* is being approved. The `Approval` entity already has
`recordSnapshot: Record<string, unknown> | null`
(`packages/domain/src/entities/approval.ts`) intended to freeze the record at
decision time, but nothing populates it with an explicit subject, and no config
names the subject. `approval-subject.prd.md` closes this: the author names the
subject, it is shown to operator and approver, and it is locked into the record.

The flow graph already knows how to reference a prior step's output: the `auto`
and `scheduled` nodes bind values through `FieldValueSource`
(`{ kind: "step_field"; nodeId; fieldKey }`) and surface prior steps via
`PriorStepField` (`packages/domain/src/entities/field-value-source.ts`). The
subject selector should reuse that shape, not invent a new one.

Constraints: additive/no migration (config in `app_flow_nodes.config` jsonb, the
locked subject in the existing `app_session_approvals.record_snapshot` jsonb);
the record must be **immutable once decided** for audit; back-compat for approvals
authored before this feature.

## Decision

### 1. Config mirrors `FieldValueSource`

Add `approvalSubject` to `ApprovalNodeConfig`:

```
approvalSubject:
  | { kind: "step"; nodeId: string }      // default: last completed step
  | { kind: "custom"; instruction: string }
```

The editor's prior-step dropdown is populated from `PriorStepField` and **defaults
to the last completed step**; "custom" reveals a free-text instruction. Absent
config (older nodes) resolves as `{ kind: "step" }` against the last completed
step, so nothing breaks.

### 2. Resolve once, at the gate

When the session raises the approval, the application use-case resolves the
subject:

- **step:** produce a human-readable statement from the referenced step's output
  and capture that step's field snapshot.
- **custom:** one model call summarises the subject from the information gathered
  so far plus the author's instruction.

The resolved `subjectDescription` (and `subjectNodeId` for the step case) is shown
to the operator at the gate and to the approver in the request and email
(ADR-023). The custom summary is computed **once** and cached on the pending
approval, not recomputed per render.

**The approver's context follows `approvalSubject`, not `advancedFrom`.**
`ListPendingApprovalsWithContext` currently resolves the previous step from
`session.graphCheckpoint.advancedFrom` — a single-slot back-pointer to the node
the session last advanced from. That is wrong the moment two approval nodes sit
in sequence:

| Flow position | `advancedFrom` |
| --- | --- |
| conversational → approval A | conversational node |
| A approves, advances to approval B | **approval A** |

So approval B resolves its "previous step" to approval A, which holds no
document. The lookup falls through to that node's projected decision fields
(`outcome`, `decided_at`, `decided_by`, `comment`) and the second approver is
shown decision metadata instead of the document they are meant to sign.

The statement and the artefact must therefore come from the same place. Both the
`subjectDescription` and the document-or-fields panel resolve from
`approvalSubject` (defaulting, as ever, to the last completed step), and
`advancedFrom` is used only for what it actually records — the immediately
preceding advance. Splitting them is how the two drifted apart in the first
place.

The document is resolved **at read time**, so the approver always sees the
current revision of it — including any signature written by an earlier approval
step (ADR-043 §6).

### 3. Lock at decision time

On decision, the resolved subject is frozen into `recordSnapshot`
(`{ subjectDescription, subjectNodeId?, … }`) alongside the existing snapshot
data. It is **never** recomputed afterwards, so a session that continues past the
approval cannot retroactively change what was approved. This is the audit
guarantee the feature exists for.

### 4. No migration

`approvalSubject` rides `app_flow_nodes.config`; the locked subject rides the
existing `record_snapshot` jsonb. No columns, no schema change.

### 5. Record metadata is namespaced by step

A flow may contain several approval steps, and a report needs to tell them
apart — "approved on the 3rd" is useless when a flow has a manager approval and
a finance approval. Every key written into `recordSnapshot` is therefore
prefixed with the **step key**:

```
{
  "manager_review.decision":            "approved_with_edits",
  "manager_review.approver_name":       "Jane Doe",
  "manager_review.approver_email":      "jane.doe@example.com",
  "manager_review.decided_at":          "2026-08-01T14:32:11.204Z",
  "manager_review.comment":             "Within delegated authority.",
  "manager_review.edits_made":          true,
  "manager_review.edited_field_keys":   ["commencement_date"],
  "manager_review.subject_description": "Draft delegation instrument produced by 'Prepare instrument'",
  "manager_review.subject_node_id":     "b1f2…",
  "manager_review.signature_field_key": "delegate_signature",
  "manager_review.verification_code":   "3F9A2C1E7B04",

  "finance_review.decision":            "approved",
  "finance_review.approver_name":       "Sam Patel",
  …
}
```

The five keys `decision`, `approver_name`, `approver_email`, `decided_at` and
`comment` are the **guaranteed minimum** — present on every decided approval,
whatever the flow looks like.

`decision` carries the recorded **status**, so it may read `approved_with_edits`
(ADR-045 §4) — the value the approver's edits earned, not the button they
pressed. `edits_made` and `edited_field_keys` accompany it as supporting detail;
a reader filtering for "approved but changed by the approver" should test
`decision`, which is the single signal, rather than reconstructing it from the
boolean.

- **The prefix is `deriveFieldKey(node label)`** — the existing helper in
  `template-field.ts`, already how every field key in the product is derived.
  Reusing it keeps one snake_casing rule instead of two. Two steps sharing a
  label collide, so the second gets a `_2` suffix, resolved when the flow is
  saved rather than at decision time — a report must not be the thing that
  discovers a name clash.
- **Flat and dot-separated, not nested.** A reporting read (the
  `field-report-pivot` precedent) can flatten the jsonb straight into columns
  without first knowing the flow's shape. Nesting would force every consumer to
  walk the graph to learn the key names.
- **Approver name and email are copied in, never joined at read time.** A later
  rename, an email change or a deleted user must not alter what the record says
  was true at decision time. This is the same immutability rule as the subject,
  applied to identity.

Still no migration — this is the shape of data inside the existing jsonb column.

## Alternatives considered

- **A new `FieldValueSource` variant / new columns for the subject.** Dedicated
  `subject_*` columns would be queryable but require a migration for data that is
  read as part of the approval record anyway; the existing `record_snapshot` jsonb
  is the right home. Rejected for now (revisit if subject reporting needs indexed
  columns).
- **Resolve the custom summary live (re-run per view).** Simpler state, but costs
  a model call on every render and — worse — lets the "subject" drift as the
  conversation continues, defeating the audit purpose. Rejected: resolve once,
  lock at decision.
- **Free-text subject typed by the operator at the gate.** Puts an authoring
  decision on the operator mid-session and yields inconsistent, ungoverned
  subjects. Rejected — the subject is authored at config time (step or instruction)
  and only *resolved* at runtime.
- **Default to the first step / no default.** The last completed step is the one
  the approver almost always means; defaulting there matches intent and keeps
  older nodes working.
- **Unprefixed record keys, disambiguated by the approval row's `nodeId`.** The
  data is all present either way, but every reporting consumer would have to
  resolve node IDs to step names before it could label a column. Rejected: the
  prefix costs nothing to write and removes a join from every reader.
- **Nested per-step objects (`{ manager_review: { decision: … } }`).** Tidier to
  read by eye, but a flat dotted key set pivots into a report row directly.
  Rejected for the consumer's sake, not the writer's.

## Consequences

**Positive**

- Every approval records an explicit, immutable statement of what was approved —
  the missing half of the audit trail.
- Reuses `FieldValueSource`/`PriorStepField` and `recordSnapshot`; no new plumbing,
  no migration.
- Back-compatible: pre-feature approvals default to the last completed step.
- A multi-approval flow yields one flat, self-describing record that a report can
  read without knowing the flow's shape (§5).

**Negative**

- The custom case adds one model call at gate time; must be cached on the pending
  approval to avoid recomputation.
- "Last completed step" needs a precise definition on branching flows (the step
  whose output most recently preceded the approval on the taken path).
- Subject data in jsonb is not directly indexable; acceptable until subject-level
  reporting is required.
- Step keys are derived from node **labels**, so renaming a step changes the
  prefix for approvals recorded afterwards. Existing records keep their original
  prefix — correct for audit, but a report spanning a rename sees two key sets.
  Callers that aggregate over time must tolerate that.
