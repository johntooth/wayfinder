# Implementation summary — Synthesise live results, editor persistence, toast stacking (v0.21.1)

- **Version**: 0.21.1 (**PATCH** — UI and query behaviour only, no schema impact)
- **Base branch**: `release/alpha-2`
- **Type**: `/bugfix`

Three reported defects, three independent root causes.

---

## 1. The run's results table did not follow the run

**Root cause.** `RunProgress` polls `extraction.runStatus` while the run is live,
which is why the counters moved. `RunResults` gave `extraction.getResults`,
`extraction.summaryMarkdown` and `extraction.runReport` no `refetchInterval` —
they were fetched once at mount and invalidated only by an operator mutation, so
nothing re-read them as the worker settled documents. Separately the grid had no
concept of an unsettled document: `getResults` returns every input document with
its `status`, but `run-results.tsx` mapped only `id`, `filename`, `treePath` and
`readable` into the grid's `SampleResult`, dropping the `pending` / `extracting`
rows entirely. And `getResults` counted any document with `recordId === null` as
an exception, which while a run is live is its whole backlog.

**Fix.**

- `isLiveRun` moved into `run-tick-state.ts` (out of a private set in
  `run-progress.tsx`), so the progress panel and the results panel poll on one
  shared rule. `RUN_POLL_INTERVAL_MS` is exported from `run-progress.tsx`.
- `RunResults` polls `getResults` on that interval, and drives `summaryMarkdown`
  and `RunReport` (new `live` prop) from the run status the results query already
  returns.
- `ResultDocument` carries `status`; `run-results.tsx` passes it through.
- `pendingDocuments` added to `result-grid-model.ts` and rendered by a new
  `PendingRow` in `result-grid.tsx` — one row per unsettled document, named and
  badged `Queued` or `Processing`. Unsettled documents are excluded from the
  exceptions filter, and the "no records match" row now accounts for them.
- `getResults` treats a record-less document as an exception only once it has
  settled.

## 2. The synthesis editor did not persist what was on screen

**Root cause.** `EditSynthesisContent` rendered `EditorCards` on the first render
with `initialSchema={schemaQuery.data ?? null}` — `null`, because the query was
still pending. `EditorCards` seeds eleven pieces of form state from that prop
through `useState` initialisers, which React evaluates once at mount, so the
editor stayed on the empty defaults after the query resolved. The `isLoading`
prop only hid the body; it did not defer the mount. The save round trip itself
was sound — the stored schema was never displayed, and the next Save overwrote it
with the defaults the operator could see.

**Fix.** `schemaSeedKey(schema, isPending)` added to `extraction-editor-model.ts`
and used as `EditorCards`' React key, so the editor remounts against the settled
schema and is stable across later background refetches.

## 3. Toasts overlapped in the bottom-right corner

**Root cause.** `<Toaster richColors closeButton />` uses sonner's default
collapsed stack: concurrent toasts are laid on top of one another and only fan
out on hover.

**Fix.** Mounted with `expand` and `visibleToasts={5}`, so concurrent toasts
render as a spaced column growing upward from the corner.

---

## Tests added

**Regression (vitest, pure model — 9 new cases, all failing before the fix):**

- `run-tick-state.test.ts` — `isLiveRun` across every run status.
- `result-grid-model.test.ts` — `pendingDocuments` returns unsettled documents
  only, filters on filename and tree path, and yields nothing under "exceptions
  only". The existing `ResultDocument` fixture gained `status`.
- `extraction-editor-model.test.ts` — `schemaSeedKey` never lets a pending query
  share a key with a settled one, and is stable once settled.

**End-to-end:** `apps/web/e2e/fix-synthesise-live-results.spec.ts`

- `structured output fields survive a save and a reload` — covers §2 directly:
  before the fix every control came back empty after the reload.
- `the results table polls itself and names the documents still to process` —
  covers §1: asserts the `pending-row` badge and that `extraction.getResults` is
  re-requested while the run is live (before the fix it was requested exactly
  once, at mount).
- `two toasts occupy separate boxes instead of stacking on top of each other` —
  covers §3: asserts `data-expanded="true"` and disjoint bounding boxes.

`./validate.sh` — 20 passed, 0 failed.
