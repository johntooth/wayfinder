# Implementation Summary — Summary of outputs enhancements (Synthesise Information)

**Version**: 2.16.2 (bump: PATCH — presentation and export-file shaping, no schema impact)
**Phase doc**: [`synthesise-summary-enhancements.phase.md`](./synthesise-summary-enhancements.phase.md)
**PRD**: [`extraction-flows.prd.md`](../../../prd/extraction-flows.prd.md) — stories 5–6 and
acceptance criterion 10 amended by this change
**ADR(s)**: [ADR-033 — Extraction Flows](../../../adr/033-extraction-flows.adr.md) (no decision changed)

## What was built

- **One-click Excel download.** The run screen's primary action runs the export and
  then fetches the XLSX directly. The old "Download data → reveal XLSX/JSON buttons"
  three-click path is gone.
- **Run screen header.** The standard 52px header bar (back chevron, title, primary
  action, `⋯` overflow menu) that the editor already used, so the two Synthesise
  surfaces match.
- **Overflow menu.** Holds Download JSON, Generate documents, the generated
  Document / Summary doc links, and All runs. Closes on click-outside and `Escape`.
- **Two-tab XLSX.** Tab 1 `Extracted data` is Record + one column per field, values
  only — pasteable into a report as-is. Tab 2 `Confidence` is long form, one row per
  record × field: Record, Field, Value, Confidence %, Band, Rationale. Rationale
  reaches the spreadsheet for the first time (it was JSON-only).
- **Multi-sheet spreadsheet writer.** `ISpreadsheetWriter` now takes `sheets[]`;
  `XlsxWriter` emits one worksheet part per sheet with matching content-type
  overrides, relationships and workbook ordering.
- **Flat results table.** One row per record, one column per field. The left
  "Included files" sidebar is removed; each value carries a RAG dot that is itself
  the control opening the confidence rationale.
- **Expandable rows.** A square chevron toggle opens a detail row showing the
  record's source files (downloadable, with the Unreadable / No record badges) and a
  four-column `Field | Value | Field | Value` grid. Per-field editing moved here, so
  the scannable table stays clean.
- **Collapsed summary.** The generated summary renders clamped to 8 lines with a
  fade and a centred Show more / Show less, measured from the rendered height rather
  than counted from the markdown source.
- **Animated progress bar.** While a run is processing the fill carries a scrolling
  stripe wash and the empty track a travelling sweep, so a run at 0% still reads as
  live. Both stop the moment the run pauses or finishes, and honour
  `prefers-reduced-motion`.

## Files created

- `apps/web/src/components/extraction/result-grid-model.ts`
- `apps/web/src/components/extraction/result-grid-model.test.ts`
- `apps/web/e2e/enhance-synthesise-summary.spec.ts`

## Files modified

- `packages/domain/src/ports/spreadsheet-writer.ts` — `WriteSpreadsheetInput` becomes
  `{ sheets: SpreadsheetSheet[] }`
- `packages/adapters/src/exports/xlsx-writer.ts` — multi-sheet OOXML package
- `packages/adapters/src/exports/xlsx-writer.test.ts`
- `packages/application/src/use-cases/extraction/export-run-results.ts` — two-tab shaping
- `packages/application/src/use-cases/extraction/export-run-results.test.ts`
- `apps/web/src/components/extraction/run-results.tsx` — header, downloads, overflow menu
- `apps/web/src/components/extraction/result-grid.tsx` — flat expandable table
- `apps/web/src/components/extraction/summary-preview.tsx` — clamp + toggle
- `apps/web/src/components/extraction/run-progress.tsx` — animated bar, `role="progressbar"`
- `apps/web/src/components/extraction/run-tick-state.ts` / `.test.ts` — `shouldAnimateProgress`
- `apps/web/src/app/(user)/synthesise/[id]/runs/[runId]/_content.tsx` — header moved into `RunResults`
- `apps/web/src/styles/globals.css` — progress-bar keyframes
- `docs/development/prd/extraction-flows.prd.md` — stories 5–6 and criterion 10
- `validate.sh` / `.github/workflows/ci.yml` — both now call the shared audit gate
- `VERSION`, `package.json`

### Also created — dependency audit gate

- `scripts/audit-check.sh` — the audit gate shared by `validate.sh` and CI, so the
  two cannot drift on what counts as blocking. It skips on a registry-side outage,
  exempts allowlisted advisory IDs, and fails on any other high or critical finding.
  The allowlist currently holds one entry (GHSA-mh99-v99m-4gvg) with its
  justification and removal condition stated inline. Verified in both directions:
  clean exit with the entry present, exit 1 with it removed.

## Migrations run

None. No schema change.

## E2E coverage

`apps/web/e2e/enhance-synthesise-summary.spec.ts` covers both halves of the change:

- *header offers a one-click Excel download and an overflow menu* — asserts the back
  link and title, that `Download data` no longer exists, that clicking Download Excel
  produces an `.xlsx` download event, and that JSON / Generate documents / All runs
  live in the `⋯` menu and that `Escape` closes it.
- *results are one row per record, expanding to reveal source files* — asserts the
  `Included files` sidebar is gone, opens a RAG indicator's rationale dialog, and
  expands a row to reveal Source files and Extracted fields, then collapses it.

Skip-guarded like the other extraction specs, so it is inert without an
authenticated, flag-enabled session with a run that produced records.

## Known limitations

- **One column per field does not scale past roughly twenty fields.** The table keeps
  its horizontal scroll container and the expanded detail is the escape hatch; a
  column picker was deliberately deferred rather than guessed at.
- **The exception badges are one click away.** `Unreadable` / `No record` moved from
  the always-visible sidebar into the expanded row. The record row still carries an
  `Exception` badge and the "Exceptions only" filter is unchanged, so the triage path
  is intact, but per-file detail now requires expanding.
- **The summary still only exists after Generate documents runs.** That is existing
  behaviour (it reads `outputs/summary.md`) and was out of scope here — it is why the
  summary appears absent on a fresh run.
- **`ISpreadsheetWriter` is a breaking port change.** `ExportRunResults` is the only
  caller and moved with it; a future adapter written against the old single-sheet
  signature would silently drop the second tab.

## Validation

- `./validate.sh` (2026-07-25): **19 of 19 checks PASS** — typecheck, lint, tests,
  coverage thresholds, architecture purity, jsx-a11y strict, version lockstep,
  dependency audit.
- The dependency audit initially failed on **GHSA-mh99-v99m-4gvg** (`brace-expansion`
  DoS, high). That is **pre-existing and repo-wide**, not from this work:
  `pnpm-lock.yaml` is byte-identical to `main`, so `main` fails it too — the advisory
  was published after main's last CI run. It is resolved here by a narrow, documented
  allowlist entry (see below), because no dependency fix exists:
  - The advisory patches only `>=5.0.8` with **no backport** to the 1.x line.
  - `brace-expansion@5` exports an object, but `minimatch@3.1.5` does
    `var expand = require('brace-expansion'); expand(pattern)` — forcing the patched
    version breaks eslint outright (verified by installing and calling it).
  - Upgrading eslint 9 → 10 does clear the audit (verified: lint clean, audit exit 0),
    but `eslint-config-next` pulls `eslint-plugin-import`, `eslint-plugin-jsx-a11y`
    and `eslint-plugin-react`, whose **latest** releases still cap at eslint 9 and
    still require `minimatch@3`. That leaves `minimatch@3` paired with an
    incompatible `brace-expansion@5.0.8` — a latent break in the jsx-a11y plugin
    `validate.sh` check 15 depends on. Not shipped.
  - Exposure is dev-tooling only; `brace-expansion` never reaches a runtime bundle,
    and the DoS needs attacker-controlled glob patterns handed to eslint.
- Unit tests added by this change: 12 (`xlsx-writer`), 8 (`export-run-results`),
  18 (`result-grid-model`), 3 (`run-tick-state` / `shouldAnimateProgress`).
- The Playwright e2e spec could **not** be executed locally — the sandbox has no
  Postgres, Redis, MinIO or Docker, and `@playwright/test` is bootstrapped by the e2e
  skill rather than declared as a dependency. It runs in CI via
  `.github/workflows/e2e.yml`, which provisions Postgres + MinIO on every PR to `main`.
