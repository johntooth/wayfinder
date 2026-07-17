# PRD — Insights Export & On-Screen Summarisation

- **Status**: Draft
- **Date**: 2026-07-17
- **Author**: Richy Brasier
- **Target version**: 2.5.0 (bump: **MINOR** — two new read-only reporting
  features, no schema change — see `docs/guides/versioning.md`)

> Version note: current `VERSION` on this checkout is 2.4.11, so this PRD targets
> the 2.x line with a MINOR bump. Confirm against live `main` when Build starts.

## 1. Problem

The Flow insights page (`/admin/dashboards/insights`) shows the template-field
report — every session's captured field values in one table — but the data is
trapped there. A procurement officer, HR manager, or ops lead can filter and
scan the table on screen, but cannot take it into Excel to work with offline,
and cannot summarise or visualise it (totals, counts, group-by) without
exporting first to some other tool. The whole point of capturing structured
field values is undercut if the operator can't pivot or chart them.

## 2. Users / Personas

- **Procurement / HR / ops operator** — runs a flow many times and needs the
  captured values in a spreadsheet to share, reconcile, or analyse.
- **Team lead / auditor** — wants an at-a-glance summary (e.g. spend by vendor,
  count by status) on screen without leaving Wayfinder.

## 3. Goals

- The operator can **export the current field report to a real `.xlsx`
  file**, generated in the browser, reflecting exactly what they see: visible
  columns, collapsed fork/version groups, and active date/status/value filters.
- Numeric and currency columns export as **real numeric cells**, so Excel can
  sum, average, and pivot them natively.
- The operator can open a **side-drawer summarisation view** that groups the
  filtered rows by a chosen column and shows an aggregate (count of sessions, or
  sum/avg of a numeric column) as a **pivot table plus a chart**, without leaving
  the page or losing the underlying table for context.
- Every export emits an **audit event** (data egress), consistent with
  Wayfinder's governance positioning.

## 4. Non-goals

- Server-side / scheduled export or emailed reports (export is client-side, on
  demand).
- A full pivot builder with drag-and-drop measures, saved pivots, or
  cross-flow aggregation — the drawer ships a single group-by + one measure
  (+ optional secondary group-by) only.
- Normalising inconsistent free-text values before grouping — that is the
  sibling feature (see `insights-ai-normalisation.prd.md`); this PRD groups on
  raw values and simply inherits normalised values automatically once that
  feature lands.
- Changing how the field report itself is computed or stored.

## 5. Key entities

Mostly new **pure** code; nothing persisted.

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| Typed display cell helper | `packages/domain/src/entities/analytics.ts` (or a new `field-report-view.ts`) | new | Coerces a string cell to a typed value (`number` \| `string`) from the column `type`. Shared by export and pivot. Pure, test-first. |
| `computePivot` reducer | `packages/domain/src/entities/field-report-pivot.ts` | new | Pure aggregation over `FieldReportSessionRow[]`: group-by column(s) + measure → pivot cells. Reuses `parseNumeric`. Test-first. |
| `FieldReport` / `FieldReportColumn` / `FieldReportSessionRow` | `packages/domain/src/entities/analytics.ts` | existing | The report both features read; unchanged. |
| `IAuditLogger` / `LogAuditEvent` | domain / application | existing | Emits the `insights.exported` audit event. No new audit table. |

## 6. User stories

1. As an operator, I can click **Export** on the field report and get an
   `.xlsx` matching my current filtered view, so I can work with it in Excel.
2. As an operator, currency and number columns arrive as numbers in Excel, so
   I can sum and pivot them without cleaning the data first.
3. As a team lead, I can open a **side drawer**, pick a column to group by and a
   measure, and see a pivot table and chart of the filtered data on the same
   screen.
4. As an auditor, each export is recorded in the audit log with who exported
   which flow's insights and when.

## 7. Pages / surfaces affected

- `/admin/dashboards/insights` — `FieldReportSection` gains an **Export**
  action and a **Summarise** action that opens the side drawer.
- New component: a **side-drawer** (Sheet) hosting the pivot controls, pivot
  table, and recharts chart. (If no `Sheet` primitive exists, add one under
  `apps/web/src/components/ui/`; recharts is already a dependency.)
- tRPC: `analytics.logInsightsExport` — **new** mutation (admin) whose only job
  is to emit the `insights.exported` audit event; the file is built client-side.

## 8. Database changes

**None.** Export is client-side; the pivot is a pure in-browser reduction over
data already loaded. The audit event reuses the existing `core_audit_log` table
via `IAuditLogger`.

## 9. Architectural decisions

- No new ADR. Both features are client-side read models over the existing
  `FieldReport`; the typed-cell helper and `computePivot` are pure domain
  functions consistent with the existing `computeFieldReport` precedent
  (ADR-001 hexagonal boundaries).
- Assumes ADR-012 (tRPC) for the audit-emit mutation.

## 10. Acceptance criteria

- [ ] Export produces a valid `.xlsx` opening cleanly in Excel / LibreOffice /
      Google Sheets.
- [ ] The exported sheet mirrors the on-screen view: only visible columns,
      collapsed groups coalesced, active filters applied, Started + Status
      columns included.
- [ ] Currency and number columns are numeric cells (not `"$1,234"` strings);
      text/enum/yes-no columns are text.
- [ ] The Summarise side drawer groups the **filtered** rows by a chosen column
      and shows count / sum / avg as a pivot table and a chart, with the source
      table still visible behind it.
- [ ] Grouping by a numeric measure with no numeric values degrades gracefully
      (empty / "no numeric data").
- [ ] Each export emits an `insights.exported` audit event (`actorId`,
      `resourceType: "flow"`, `resourceId: flowId`, metadata: row/column counts,
      applied filters).
- [ ] Tests written before implementation for `computePivot` and the typed-cell
      helper; `./validate.sh` passes with `VERSION` / `package.json#version`
      matched.

## 11. Out of scope / future work

- Server-side export for very large reports (current report is already fully
  client-side; revisit only if row counts make browser generation slow).
- Saved / named pivots and dashboards.
- Exporting the pivot result itself (only the flat report exports in this phase).
- CSV export (xlsx supersedes it; add later only if requested).

## 12. Risks / open questions

- **Browser xlsx library choice** — verify the exact API in `node_modules`
  before use (repo rule); watch bundle size and lazy-load the writer so it
  isn't in the initial insights bundle.
- **View-vs-raw export** — decision: export **the current view**. A future
  "export all columns / all rows ignoring filters" toggle is deferred.
- **Pivot placement** — decision: **side drawer** (keeps the table visible and
  preserves filter state), not a modal.
- **Numeric coercion** relies on the existing `parseNumeric`; values that don't
  parse are treated as text/omitted from numeric measures — same semantics the
  filter bar already uses, so behaviour stays consistent.
