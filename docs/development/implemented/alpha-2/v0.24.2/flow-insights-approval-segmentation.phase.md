# Phase — Flow Insights: Segment Approval Steps by Approval Type

- **Status**: Implemented
- **Target version**: 0.24.2 (bump: PATCH — no schema change, no new step type,
  no new node; a reporting defect and a read-path gap in shipped functionality)
- **Base branch**: `release/alpha-2` (stabilisation only — see CLAUDE.md
  *Release Branching*)
- **PRDs**: `approval-subject.prd.md` (§1, §3, **user story 9**, AC "a flow with
  two approval steps produces two distinguishable, non-colliding" records);
  `step-approvals.prd.md` (§10 — "the approval node's step-output metadata
  reflects the outcome … for reporting")
- **ADRs**: ADR-040 (approval subject + frozen record, esp. §5), ADR-043
  (approval signature tag, esp. §5), ADR-045 (approver edit-before-deciding)
- **Depends on**: the approval decision projection and the Insights field report
  as they stand on `release/alpha-2` (v0.24.1)

> **Traceability.** This phase completes `approval-subject.prd.md` **user story
> 9** — *"As a reporting user, I can read a flow's approvals and tell each step's
> decision apart by name, with the date/time, approver, decision and comment."*
> v0.22.0 delivered the *record* half (step-namespaced `recordSnapshot`,
> ADR-040 §5). The *report* half was never built: the Insights field report does
> not read the namespacing, and the projection that feeds it still writes a raw
> user id. This is that half, not new scope.

## 1. Problem

The Flow Insights dashboard's field report
(`/admin/dashboards/insights`) is the one place an operator can report across
sessions. A flow may contain several approval steps — a finance sign-off and a
legal sign-off, say — and each is a distinct approval *type* with its own
approver and its own subject. The report does not distinguish them.

Reported symptoms, all confirmed in the code:

1. Approval columns are **not segmented by approval step**. Several columns
   render with the identical heading `Outcome` (and `Comment`, `Decided by`,
   `Decided at`) with nothing naming which approval step produced them.
2. Worse than ambiguous — distinct approval steps **silently merge into one
   column** under a toggle that is on by default.
3. There is no column for **who approved**: the projected value is a raw user
   UUID.
4. There is no column for **what the approval applies to** — the subject step
   the approver signed off — even though it is frozen in the approval record.
5. A step decided **more than once** — sent back for changes, reworked, then
   approved — does not say so. Nothing distinguishes an approval that sailed
   through first time from one that took three passes.

## 2. Root causes

### 2.1 Every approval step projects the same four generic field keys

`DecideApproval.projectDecision` writes the decision onto the approval node's
step outputs so the report can pick it up
(`packages/application/src/use-cases/approvals/decide-approval.ts:561`):

```ts
fields: [
  field("outcome", "Outcome", approval.status),
  field("decided_at", "Decided at", decidedAt.toISOString()),
  field("decided_by", "Decided by", approval.decidedByUserId ?? ""),
  field("comment", "Comment", approval.comment ?? ""),
]
```

The keys and labels are the same for **every** approval node in every flow, by
construction. That is fine for storage — a report column is keyed
`${nodeId}:${fieldKey}` (`packages/domain/src/entities/analytics.ts:456`), so
the columns themselves stay distinct per node — but it means the *label* alone
can never tell two approval steps apart.

`decided_by` holds `approval.decidedByUserId`, a UUID. The approver's name and
email are copied into the frozen record at decision time and deliberately never
joined at read time (ADR-040 §5, `approval-record.ts:60`), so the identity is
already available on the row being projected — it is simply not read.

### 2.2 The collapse heuristics merge distinct approval steps

`annotateCollapseGroups` (`packages/domain/src/entities/analytics.ts:402`) tags
columns that may be coalesced into one, grouping candidates **by `fieldKey`**.
Both of its rules misfire on approval columns:

- **Fork siblings** — two approval steps on mutually-unreachable branches share
  `outcome`, so they earn a `collapseGroupId` and merge under *Combine forked
  steps*. Two different sign-offs become one column.
- **Across versions** — the version rule fires when the same `fieldKey` appears
  on a node absent from the live flow *and* the columns never co-occur on a row
  (`analytics.ts:426-435`). Two sequential approval steps in a flow that has
  since been edited satisfy both conditions, so they collapse under *Combine
  across versions* — which **defaults to on**
  (`apps/web/src/components/admin/field-report-section.tsx:99`).

Neither rule is wrong for template fields: there, a shared `fieldKey` means the
author reused one template slot, which is exactly what should coalesce. For an
approval step the shared key carries no such meaning — it is an artefact of the
projection, not an authoring decision. The heuristic has no way to know that,
because `FieldReportColumn` does not record what kind of step a column came
from.

### 2.3 Repeat decisions are invisible

A change request routes work back, and re-entering the step raises a **fresh**
approval request rather than reopening the old one (`step-approvals.prd.md` §6
story 7). So one approval step legitimately holds several decisions, and
`projectDecision` writes a **new step-output row per decision**.

`computeFieldReport` sorts a session's outputs ascending by `createdAt` and lets
later values overwrite earlier ones (`analytics.ts:480-490`), so the report
already shows the **latest** decision. That is correct but incidental — nothing
tested it, and nothing recorded that a step had been round more than once. A
step that was rejected twice before being approved reads exactly like one
approved on sight.

### 2.4 The table header renders the field label alone

`field-report-section.tsx:616` renders `col.label` per column, and the step name
only when a column merged several steps (`col.stepNames.length > 1`,
line 619). An unmerged approval column therefore shows `Outcome` with no
qualifier. The same label reaches the xlsx export unqualified
(`field-report-export.ts:47`) and the Summarise drawer's group-by select, so a
four-approval flow exports four identically-headed columns.

The Columns dialog (line 678) and the *Filter on* select (line 502) already
group by step name via `columnsByNode`, which is why the problem shows up in the
table and the export but not in those two controls.

## 3. Reproduction

Author a flow with a document step followed by **two** approval steps with
different names (e.g. *Finance Sign-off*, *Legal Sign-off*). Run a session
through both approvals with two different approvers. Open
`/admin/dashboards/insights` and select the flow.

Observed: the table shows repeated `Outcome` / `Decided by` / `Comment` headings
with no step name; `Decided by` holds a UUID; nothing states which step each
approval applies to. With *Combine across versions* left on (its default) after
any edit to the flow, the two sign-offs appear as a single `Outcome` column.

Expected: one clearly-labelled group of columns per approval step, naming the
step, the approver, and the step being approved.

## 4. Scope

In scope — forward-only, no migration:

- Segment approval columns per approval step in the table and the export.
- Never collapse an approval column into another step's column.
- Project the approver's name and email instead of a UUID.
- Project what the approval applies to.

Out of scope: backfilling step-output rows already written for past decisions
(they keep their UUID and gain no subject); any change to the approval decision
flow, the frozen record, or the attestation.

## 5. Design

### 5.1 Canonical projected keys (domain)

The writer (`decide-approval`) and the readers (the report, the UI) currently
agree on `"outcome"` and friends only by coincidence of string literals. Name
them once, next to `buildApprovalRecord`, in
`packages/domain/src/entities/approval-record.ts`:

- `APPROVAL_PROJECTION_FIELDS` — the ordered `{ key, label, type }` set that
  `projectDecision` writes: `outcome`, `revision`, `decided_at`, `decided_by`,
  `approver_email`, `applies_to`, `comment`.

Three new keys — `revision`, `approver_email` and `applies_to`; the existing
four keep their keys and labels so rows already written stay readable in the
same columns. `revision` is typed `number` so it filters, sorts and pivots as
one rather than as text.

### 5.2 Columns know which kind of step they came from (domain)

`FieldReportColumn` gains `nodeType?: FlowNodeType`. `computeFieldReport` sets
it from the node it already looks up for `nodeName`, which means
`AnalyticsNode` and the report's `NodeForReport` both carry `type`.

`annotateCollapseGroups` then skips any column whose `nodeType` is `"approval"`
— for both the fork rule and the version rule. This is the fix for §2.2, and it
is deliberately a domain-level rule rather than a UI toggle: two sign-offs are
never the same column, whatever the viewer has ticked.

`GetFlowDeepDive` already lists the flow's nodes
(`packages/application/src/use-cases/analytics/get-flow-deep-dive.ts:91`) and
maps them to `AnalyticsNode`; it passes `node.type` through.

### 5.3 The projection carries identity and subject (application)

`projectDecision` reads the approval's own frozen `recordSnapshot` — available
on the row it is handed, since `decideWithin` returns the updated approval with
the snapshot patched in (`decide-approval.ts:370-384`) — and writes:

| key | value |
|---|---|
| `outcome` | `approval.status` (unchanged) |
| `decided_at` | decision timestamp (unchanged) |
| `decided_by` | `<stepKey>.approver_name` → `<stepKey>.approver_email` → `decidedByUserId` |
| `approver_email` | `<stepKey>.approver_email` |
| `applies_to` | `<stepKey>.subject_description` → subject step's node name → `""` |
| `revision` | count of this step's decided approvals in this session, this one included |
| `comment` | `approval.comment` (unchanged) |

`revision` is counted from the **approval rows**, not from the projections:
the projections are best-effort and may have missed a write, while the approval
rows are the source of truth for what was decided. It runs after the decision
commits, so the current decision is already among them — a first pass is 1.

The fallbacks matter: the record is built best-effort (its dependencies are
optional, `decide-approval.ts:132-139`), so an unwired or partial record must
still project *something* identifying rather than a blank cell. Reading the
snapshot rather than re-resolving keeps the report agreeing with the signed
document by construction — a second resolution could disagree with the first.

The step-key prefix is already on the snapshot under the unprefixed `stepKey`
working key (`approval-record-keys.ts:13`), so the prefix is read, never
re-derived.

### 5.4 The step name reaches the header and the export (web)

- `DisplayColumn` (`field-report-columns.ts`) carries `nodeType` through from
  the raw column.
- A shared `qualifiedColumnLabel(column)` helper returns `"<step> — <label>"`
  for an approval column and the plain label otherwise. One helper, so the
  table, the export and the Summarise drawer cannot disagree.
- The table header shows the step name as the existing small sub-line — the
  same treatment merged columns already get (line 619) — extended to approval
  columns.
- `approvalRevisionNote` annotates an approval step's **outcome** cell with
  `(Revision N)` when N > 1. Presentation only: the count itself rides its own
  numeric column, so grouping and filtering still see a clean `approved`, never
  `approved (Revision 2)`. A first pass is unannotated, so the ordinary case
  reads clean and only a step that went round again is marked.
- The export and the Summarise group-by select use `qualifiedColumnLabel`, so a
  spreadsheet never carries two identical headings.

## 6. Files

**Domain**
- `packages/domain/src/entities/approval-record.ts` — `APPROVAL_PROJECTION_FIELDS`
- `packages/domain/src/entities/analytics.ts` — `type` on `AnalyticsNode` /
  `NodeForReport`, `nodeType` on `FieldReportColumn`, approval columns skipped
  in `annotateCollapseGroups`

**Application**
- `packages/application/src/use-cases/analytics/get-flow-deep-dive.ts` — pass
  `node.type`
- `packages/application/src/use-cases/approvals/decide-approval.ts` —
  `projectDecision` reads the frozen record

**Web**
- `apps/web/src/components/admin/field-report-columns.ts` — `nodeType`,
  `qualifiedColumnLabel`
- `apps/web/src/components/admin/field-report-section.tsx` — header sub-line,
  qualified export columns
- `apps/web/src/components/admin/field-report-export.ts` — unchanged signature;
  receives qualified labels
- `apps/web/src/components/admin/field-report-pivot-drawer.tsx` — qualified
  group-by labels

## 7. Acceptance criteria

- [ ] A flow with two approval steps renders **two** separate `Outcome` columns
      in the field report, each captioned with its own step name — with
      *Combine forked steps* and *Combine across versions* both left at their
      defaults.
- [ ] Ticking or unticking either combine toggle never merges columns belonging
      to two different approval steps.
- [ ] A template field shared across fork-sibling steps still collapses as it
      does today (no regression to §2.2's legitimate case).
- [ ] `Decided by` shows the approver's **name** for a decision recorded after
      this change; it falls back to their email, then to the user id, and is
      never blank when an approver is known.
- [ ] `Approver email` and `Applies to` appear as columns for a decision
      recorded after this change; `Applies to` names the step that was signed
      off.
- [ ] The xlsx export of a two-approval flow contains **no two identical column
      headings** — approval headings are step-qualified.
- [ ] The Summarise drawer's group-by list distinguishes the two steps'
      `Outcome` columns.
- [ ] A step decided twice (changes requested, then approved) reports the
      **latest** decision — `approved` — never the superseded one.
- [ ] That step's outcome cell reads `approved (Revision 2)`, and a step decided
      once carries no revision note.
- [ ] `Revision` is its own numeric column, so a report can filter and pivot on
      "took more than one pass".
- [ ] Each approval step counts its own passes: a second sign-off on its first
      pass is revision 1 however many times the first step was decided.
- [ ] A step output written before this change still renders in its existing
      column, with its stored value, and no column disappears.
- [ ] A flow with no approval steps produces a report byte-identical to today's.
- [ ] `VERSION` = `package.json#version` = `0.24.2`; `./validate.sh` passes.

## 8. Tests

Written before the implementation, per CLAUDE.md.

- `packages/domain/src/entities/analytics.test.ts`
  - two approval nodes sharing `outcome` produce two columns, and neither gains
    a `collapseGroupId` or a `versionGroupId`, under both toggles
  - `nodeType` is set on every column from its node
  - a template field shared across fork siblings still collapses (no regression)
  - a twice-decided step reports its latest decision and revision, and does so
    by decision time rather than row order
- `packages/application/src/use-cases/approvals/approvals.test.ts`
  - `projectDecision` writes the approver name from the record, the email, and
    the subject description
  - falls back to email, then to the user id, when the record is partial
  - numbers each pass: a re-decided step projects revision 2 with the newer
    outcome, a first pass projects 1, and passes are counted per step
- `apps/web/src/components/admin/field-report-export.test.ts`
  - two approval steps export two distinct, step-qualified headings
- `apps/web/e2e/enhance-flow-insights-approval-segmentation.spec.ts` — Playwright
  cover of the dashboard showing one labelled column group per approval step.
  Written, **not run locally**: CI runs the suite (`.github/workflows/e2e.yml`).

## 9. Risks

- **Historical rows keep a UUID in `Decided by`.** Accepted (§4): the value was
  already a UUID, so nothing regresses; new decisions read correctly.
- **Historical rows carry no `revision`.** A decision projected before this
  change has no count, so its outcome cell is unannotated — it reads as a first
  pass whether or not it was one. `approvalRevisionNote` treats a missing value
  as "no note" rather than guessing, since a wrong revision number in a
  governance report is worse than none.
- **A flow that genuinely reused one approval step across versions no longer
  coalesces.** Intended — the ask is segmentation. The columns remain adjacent
  and step-labelled, so the report is longer but never wrong.
- **`nodeType` is optional on `FieldReportColumn`.** A caller that does not
  supply node types (the extraction report path builds its own columns) is
  unaffected, and the collapse rules behave exactly as today for them.
