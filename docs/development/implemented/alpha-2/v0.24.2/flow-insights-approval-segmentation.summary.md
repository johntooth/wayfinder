# Implementation Summary — Flow Insights: Approval Steps Segmented by Approval Type

- **Version**: 0.24.2 (PATCH — no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Phase doc**: `flow-insights-approval-segmentation.phase.md` (this folder)
- **Completes**: `approval-subject.prd.md` user story 9 — *"As a reporting user,
  I can read a flow's approvals and tell each step's decision apart by name,
  with the date/time, approver, decision and comment."*

## What was wrong

A flow may hold several approval steps, each a distinct approval type. The
Flow Insights field report could not tell them apart:

1. Every approval step projects the **same four generic keys** onto its step
   outputs (`outcome`, `decided_at`, `decided_by`, `comment`), so several
   columns rendered with the identical heading `Outcome` and nothing naming the
   step.
2. `annotateCollapseGroups` groups collapse candidates **by `fieldKey`**. The
   shared generic keys made two different sign-offs look like one reused
   template slot, so they earned a `versionGroupId` and **merged into a single
   column** — under *Combine across versions*, which defaults ON.
3. `decided_by` held a raw user **UUID**.
4. Nothing showed **what** an approval applied to, though the subject is frozen
   in `recordSnapshot` at decision time.
5. A step decided **more than once** — sent back for changes, reworked, then
   approved — read exactly like one approved on sight. The report did already
   show the latest decision (outputs are sorted ascending and later values
   overwrite earlier ones), but that was incidental and untested, and the number
   of passes was recorded nowhere.

ADR-040 §5 anticipated all of this ("a report needs to tell them apart") and
the record layer honoured it in v0.22.0. The report layer never consumed it.

## What changed

**`packages/domain`**

- `approval-record.ts` — new `APPROVAL_PROJECTION_FIELDS`: the ordered
  key/label/type set a decision projects, named once so writer and readers
  cannot drift. Three new keys (`revision`, `approver_email`, `applies_to`); the
  original four keep their keys and labels so rows already written stay in the
  same columns. `revision` is typed `number` so it filters, sorts and pivots as
  one.
- `analytics.ts` — `type` on `AnalyticsNode` and the report's `NodeForReport`;
  `nodeType` on `FieldReportColumn`, set by `computeFieldReport`.
- `annotateCollapseGroups` — skips a whole `fieldKey` group once any column in
  it comes from an approval step, for both the fork rule and the version rule.
  The *group* is skipped rather than just its approval columns because a step
  deleted from the flow has no type to test, and its historical column would
  otherwise merge onto a live sign-off.

**`packages/application`**

- `get-flow-deep-dive.ts` — passes `node.type` through to the report.
- `decide-approval.ts` — `projectDecision` reads the record frozen moments
  earlier (never re-resolves, so the report cannot contradict the signed
  document) and projects `decided_by` as the approver's name → email → user id,
  plus `approver_email` and `applies_to` (subject description → subject step
  name → blank). The `field` helper now takes its label from the shared domain
  definition instead of the call site.
- `decisionCount` numbers the pass. A change request routes work back and
  re-entering the step raises a *fresh* request, so one step can be decided
  several times. Counted from the approval rows — the source of truth — rather
  than from the best-effort projections, and after the decision commits, so a
  first pass is 1.

**`apps/web`**

- `field-report-columns.ts` — `nodeType` on `DisplayColumn`; new
  `qualifiedColumnLabel` for anywhere a column is read without its step beside
  it; new `approvalRevisionNote`, which annotates an approval step's outcome
  cell with `(Revision N)` for any N > 1 — the pass count is uncapped.
  Presentation only — the count rides its own numeric column, so grouping and
  filtering still see a clean `approved` rather than `approved (Revision 2)`.
  The annotated cell lays out as a flex row (value truncates, note `shrink-0`)
  so the note is never the part clipped by the cell's 220px cap.
- `field-report-section.tsx` — approval columns render their step name as the
  header sub-line; the xlsx export and the Summarise drawer take qualified
  labels.
- `e2e-fixtures-approval.ts` — the seeded approval-subject flow gains a third
  `Records sign-off` step, decided *twice* (changes requested, then approved),
  with full projections. The seed now carries two decided approval steps for the
  dashboard to segment, one of which took two passes.

## Behaviour changes to note

- Two approval steps can no longer be coalesced into one column by either
  combine toggle. That is the point of the change, but it is a visible
  difference for a flow that was relying on the merge: the report gains columns
  rather than losing information.
- Decisions projected **before** this change carry no `revision`, so their
  outcome cell is unannotated and reads as a first pass whether or not it was
  one. `approvalRevisionNote` treats a missing count as "no note" rather than
  guessing — a wrong revision number in a governance report is worse than none.

## Tests

Written before the implementation, per CLAUDE.md.

| Layer | File | Covers |
| --- | --- | --- |
| Domain | `packages/domain/src/entities/analytics.test.ts` | `nodeType` tagging; no fork-collapse and no version-collapse across approval steps; template fields still collapse with an approval step present; untyped callers unchanged; a twice-decided step reports its latest decision and revision, ordered by decision time not row order; `APPROVAL_PROJECTION_FIELDS` key order, preserved labels and numeric revision |
| Application | `packages/application/src/use-cases/approvals/approvals.test.ts` | projection names the approver, projects the subject, falls back email → user id, keeps outcome/timestamp/comment, carries `approved_with_edits`, numbers each pass (1, then 2 after a change request, and on through a four-pass `changes_requested → rejected → changes_requested → approved` run) and counts passes per step |
| Web | `apps/web/src/components/admin/field-report-columns.test.ts` | `nodeType` passthrough, two approval steps stay two columns, qualified labels distinct per step, revision note only on an approval outcome cell past pass 1, at any count |

**E2E** — `apps/web/e2e/enhance-flow-insights-approval-segmentation.spec.ts`
covers the changed behaviour end-to-end: two step-captioned `Outcome` columns
for the two decided sign-offs, no merge with either combine toggle flipped, the
approver named rather than a UUID, an `Applies to` column, the twice-decided
step showing its latest decision annotated `(Revision 2)` with no note on the
single-pass one, a `Revision` column of its own, and the Columns dialog grouping
each approval's fields under its own step.

Not run locally by design — CI runs the suite (`.github/workflows/e2e.yml`, on
every PR, sharded, against a full stack). A local run needs Postgres, Redis,
MinIO and a built app and would only duplicate it.

`./validate.sh` — 21 passed, 0 failed.
