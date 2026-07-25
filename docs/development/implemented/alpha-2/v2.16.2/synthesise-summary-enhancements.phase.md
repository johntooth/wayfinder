# Phase — Summary of outputs enhancements (Synthesise Information)

**Type:** Enhancement (`/enhance`)
**Base branch:** `main` — the Synthesise Information run screen is unreleased
work that only exists on `main`. `CLAUDE.md` still names `release/alpha-1` as the
current alpha, but that is the `1.x.x` line; this repo is on `2.16.1`, and no
`release/alpha-2` branch exists yet.
**Version bump:** PATCH — `2.16.1` → `2.16.2`. Presentation and export-file
shaping only; no DB migration, no new domain entity, no new use case.

## Why

The **Summary of outputs** screen (`/synthesise/[id]/runs/[runId]`) is the surface
an operator lands on after a run. Feedback from using it:

- **Downloading takes three clicks.** "Download data" runs an export mutation and
  then *reveals* two more buttons (XLSX, JSON). The operator wants Excel — the
  common case — in one click, with JSON tucked away as the occasional machine copy.
- **The page has no header.** Every other Synthesise screen (`Edit synthesis`)
  has the standard 52px header bar with a back affordance, a title, a primary
  action and a `⋯` overflow menu. The run screen is a bare heading in the scroll
  body, so it reads as a different product.
- **"Generate documents" competes with the downloads.** It sits in the same
  button row as the download actions but does something categorically different
  (produces the templated output document + summary doc). It is not redundant —
  it is the *only* way to produce the summary and the filled template — but it
  does not belong beside the downloads.
- **The XLSX mixes data with metadata.** Every field currently gets a value
  column *and* a `… confidence` column interleaved on one sheet. The sheet is
  meant to be pasted into a report; the confidence numbers make it unusable
  without manual column deletion, and the rationale text is missing entirely
  (JSON-only).
- **The grid is hard to scan.** It renders one table row per *field*, with the
  record label `rowSpan`-merged down the left and a narrow "Included files"
  sidebar taking a fifth of the width. An operator comparing ten records across
  five fields sees fifty rows and cannot scan a column.
- **The summary is invisible and unbounded.** It only exists after
  `Generate documents` writes `summary.md`, and when present it renders in full —
  a long summary pushes the data table off-screen.
- **The progress bar looks stalled.** While a run processes, the only motion is a
  small spinner beside the status word. The bar itself is static between count
  ticks, which on a slow document reads as "nothing is happening".

## What changes

### 1. Multi-sheet spreadsheet writer — `packages/domain`, `packages/adapters`

`ISpreadsheetWriter` currently writes exactly one sheet: `WriteSpreadsheetInput`
is `{ sheetName, columns, rows }`. The two-tab export needs N sheets.

- `WriteSpreadsheetInput` becomes `{ sheets: SpreadsheetSheet[] }`, where
  `SpreadsheetSheet` is the existing `{ name, columns, rows }` triple. This is a
  breaking change to the port; `ExportRunResults` is the only caller, so both are
  updated together (no compatibility shim — see the "no dead code" rule).
- `XlsxWriter` emits one `xl/worksheets/sheetN.xml` part per sheet, with the
  matching `[Content_Types].xml` overrides, `xl/_rels/workbook.xml.rels`
  relationships (`rId1..rIdN`), and `<sheet>` entries in workbook order. Cells
  stay inline strings, so values still round-trip verbatim.
- An empty `sheets` array is a `VALIDATION_FAILED` domain error — Excel rejects a
  workbook with no worksheet, so failing in the writer beats emitting a corrupt file.

### 2. Export split into two tabs — `packages/application`

`ExportRunResults` writes one workbook with two sheets:

- **Tab 1 — `Extracted data`**: `Record` plus one column per schema field, values
  only. Nothing else. This is the sheet an operator pastes into a report.
- **Tab 2 — `Confidence`**: long form, one row per record × field —
  `Record | Field | Value | Confidence % | Band | Rationale`. Long form (rather
  than mirroring tab 1's width) because rationale is a sentence or two per cell;
  a wide sheet of paragraphs is unreadable. `Band` is the RAG word
  (`red`/`amber`/`green`) from `confidenceBand`, so the sheet can be filtered and
  conditionally formatted without re-deriving thresholds in Excel.

The JSON export is unchanged — it is already the full-fidelity copy.

### 3. Page header — `apps/web` run screen

`RunScreenContent` gains the same 52px header bar the editor uses
(`border-b border-[#dedad2] bg-white`, `pl-5 pr-[52px]`):

- Back chevron → `/synthesise/[id]/edit`, `aria-label="Back to edit the flow"`.
- `<h1>` "Summary of outputs".
- Right: primary **Download Excel** button, then a `⋯` overflow menu.

The header owns the run's actions, so it is rendered by `RunResults` (which holds
the export/generate mutations) rather than by the page shell; the page shell
supplies the layout column beneath it. The body keeps its `max-w-[1100px]` column.

### 4. Downloads — direct Excel, JSON in the overflow menu

- **Download Excel** (primary, header): runs `extraction.export`, and on success
  navigates straight to
  `/api/synthesise/runs/[runId]/artifacts/export-xlsx`. One click, file lands.
  Disabled with a "Preparing…" label while the mutation is in flight.
- **Download JSON** (`⋯` menu): identical flow against `export-json`.
- Both share one "export then fetch artifact" helper so the two paths cannot drift.
  The pending state tracks *which* format is downloading, so the menu item and the
  button do not both show a spinner.
- The old reveal-then-click XLSX / JSON buttons are deleted.

### 5. "Generate documents" moves into the overflow menu

The `⋯` menu contains, in order:

- **Generate documents** — runs `extraction.generateDocuments`; label switches to
  "Generating…" while pending.
- **Document** / **Summary doc** links — only once a generation has succeeded in
  this session (unchanged gating, relocated).
- **Download JSON**.
- **All runs** → `/synthesise/[id]/runs` (the standalone link in the old heading
  block is folded in here).

Menu behaviour matches the editor's: click-outside and `Escape` close it.

### 6. Result grid — flat, expandable, no file sidebar

`ResultGrid` is reshaped. It has exactly one caller (`RunResults`), so the
`documentHref` / `editing` / `showFilters` options stay but the layout changes
wholesale.

- **The "Included files" sidebar is removed**, along with the two-column grid and
  the selected-record highlight that only served it. Source files move into the
  expanded row, where they describe the record they belong to.
- **One row per record.** Columns: expand toggle, `Record`, then one column per
  field key (union of the fields present, in first-seen order). A record missing a
  field renders an em-dash.
- **Each value cell** shows the value plus a RAG indicator. The indicator *is* the
  button — a coloured dot in a ring, `aria-label` naming the field and its band,
  opening the existing confidence-rationale dialog. The separate info icon is gone;
  one target, not two.
- **Expand toggle** is a square outlined button with a chevron
  (`aria-expanded`, `aria-label="Expand <record>"`). Expanding inserts a detail row
  spanning the table:
  - **Source files** — filename, tree path, download link (when `documentHref` is
    supplied), and the existing `Unreadable` / `No record` badges.
  - **Field detail** — a four-column grid: `Field | Value` then `Field | Value`,
    i.e. two field/value pairs per row. Each value carries the RAG indicator and
    the edit affordance (editing moves here from the main row, so the scannable
    table stays clean).
  - Overall record confidence is shown in the detail header.
- Rows expand independently; expansion state is a `Set<string>` of record ids.
- The filter input and "Exceptions only" checkbox are unchanged.

### 7. Summary preview — clamped with a centred "Show more"

`SummaryPreview` renders above the table (unchanged position) but collapsed:

- Collapsed to the first **8 lines** of rendered content, with a fade-out over the
  final line so the truncation reads as deliberate.
- A **Show more** / **Show less** text button, centred beneath the content.
- The toggle is only rendered when the content actually overflows 8 lines —
  measured after render, so it reacts to the real rendered height rather than a
  guess at line count from the markdown source.
- The clamp uses a max-height derived from the component's line height, so a
  partially-visible ninth line signals there is more.

The summary itself only exists once `Generate documents` has run (it reads
`extraction-runs/<runId>/outputs/summary.md`). That is existing behaviour and is
not changed here — but it is why the summary appears absent on a fresh run.

### 8. Animated progress bar — `run-progress.tsx`

While the run is processing (`isProcessing(run.status)`):

- The filled portion gets a repeating diagonal-stripe wash that scrolls, so the
  bar shows motion between count ticks.
- The unfilled track carries a slow travelling highlight, so a run at 0% still
  reads as live.
- Both animations are dropped as soon as the run is terminal or paused — a static
  bar then means "not moving", which is accurate.
- `@media (prefers-reduced-motion: reduce)` disables the animations; the bar keeps
  its fill and the spinner still conveys activity.
- The bar carries `role="progressbar"` with `aria-valuenow`/`min`/`max` and a
  `data-animated` attribute the e2e test asserts on.

Keyframes are defined in the app's global stylesheet alongside the existing
Tailwind layer, since Tailwind has no built-in stripe-scroll animation.

### 9. PRD amendment — `docs/development/prd/extraction-flows.prd.md`

The PRD's user story 5 and acceptance criterion 10 specified the files sidebar
("included files on the left ~¼; selecting a row highlights the source files")
that §6 removes. Both are rewritten in this change so the PRD describes the
delivered surface: a flat one-row-per-record table whose rows expand to show the
source files that produced them. Story 6 and the same criterion also gain the
one-click XLSX / overflow-menu download model and the collapsed summary.

This is a deliberate reversal of a PRD decision, made because provenance attached
to the record it explains beats a parallel list the operator has to correlate by
eye — and because the sidebar cost a fifth of the table's width on the widest
surface in the product.

## Risks

- **Breaking the `ISpreadsheetWriter` port.** `WriteSpreadsheetInput` changes
  shape. `ExportRunResults` is the only caller (verified by grep), and both move in
  one commit, so the blast radius is contained — but a future adapter implementing
  the old single-sheet signature would silently miss the second tab. Mitigated by
  the port being the single source of truth and by the adapter test asserting two
  worksheet parts.
- **Hand-rolled multi-sheet OOXML.** `XlsxWriter` writes the package by hand
  (PizZip, no SheetJS). Getting rels/content-types/`<sheet>` ordering wrong yields
  a workbook Excel refuses to open, and a unit test that only parses our own XML
  would not catch it. Mitigated by round-tripping the output through the existing
  `SpreadsheetParser` in the test — an independent reader — and by asserting the
  package parts explicitly.
- **The wide table on many fields.** One column per field scans well at five
  fields and poorly at twenty. The table keeps its horizontal `overflow-x-auto`
  container, and the expanded detail view is the escape hatch for field-heavy
  schemas; a column-picker is deliberately deferred rather than guessed at.
- **Losing the exceptions signal.** The `Unreadable` / `No record` badges lived in
  the sidebar. They move into the expanded row, which means they are one click
  away rather than always visible. The "Exceptions only" filter remains as the
  always-available path to the same triage, so no signal is lost — only relocated.
- **Animation as noise.** A perpetually animating bar can read as decoration. It
  is bound to `isProcessing` and dropped the moment the run is terminal or paused,
  and honours `prefers-reduced-motion`.

## Out of scope

- No change to how or when the summary is generated.
- No change to the JSON export shape.
- No change to run-control behaviour (continue / retry / cancel / mark complete).
- No DB migration.

## Tests

Written before the implementation of each sub-component.

| Area | Test |
|---|---|
| Multi-sheet writer | `packages/adapters/src/exports/xlsx-writer.test.ts` — two sheets produce two worksheet parts, correct rels/content-types, workbook `<sheet>` order; empty `sheets` errors |
| Export shaping | `packages/application/src/use-cases/extraction/export-run-results.test.ts` — tab 1 has values only (no confidence columns), tab 2 has one row per record×field with band + rationale |
| Result grid | `apps/web/src/components/extraction/result-grid.test.tsx` — one row per record, no files sidebar, RAG indicator opens the rationale dialog, expanding reveals source files and the paired field grid |
| Summary clamp | `apps/web/src/components/extraction/summary-preview.test.tsx` — collapsed by default, toggle reveals the rest |
| Progress animation | `apps/web/src/components/extraction/run-progress.test.tsx` (or a pure helper test) — animated while processing, static when terminal |
| End-to-end | `apps/web/e2e/enhance-synthesise-summary.spec.ts` — header renders, Download Excel yields an `.xlsx` download, the `⋯` menu offers JSON and Generate documents, a record row expands to show its source files |

## Acceptance

- Excel downloads in one click from the header; the file's first tab contains only
  extracted values and its second only confidence/rationale.
- JSON and Generate documents are reachable only from the `⋯` menu.
- The run screen has the standard header bar.
- The results table is one row per record with no files column, RAG indicators on
  each value, and expandable detail rows.
- A generated summary shows 8 lines with a centred Show more toggle.
- The progress bar visibly animates while a run is processing.
- `./validate.sh` passes.
