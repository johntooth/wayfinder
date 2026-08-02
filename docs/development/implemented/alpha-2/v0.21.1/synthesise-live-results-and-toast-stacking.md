# Bug fix — Synthesise live results, editor persistence and toast stacking

- **Version**: 0.21.1 (bump: **PATCH** — UI and query behaviour only, no schema impact)
- **Base branch**: `release/alpha-2`
- **Type**: `/bugfix`

Three defects reported together against the Synthesise Information surface.

---

## 1. The run's results table does not update as documents are processed

### Symptom

On `/synthesise/<flowId>/runs/<runId>`, the progress bar at the top advances as
each document finishes, but the records table below it stays as it was when the
page loaded. The operator only sees new rows after a manual refresh. There is
also no indication of which documents are still waiting — a half-finished run is
visually indistinguishable from a finished one with records missing.

### Reproduction

1. Open a synthesis with several input documents and run a sample.
2. Watch the run screen while the run is live.
3. The header reads `2 of 8 documents processed`, then `3 of 8`, and so on.
4. The table below never gains a row until the page is reloaded.

### Root cause (verified)

`RunProgress` (`run-progress.tsx`) gives its `extraction.runStatus` query a
`refetchInterval` while the run's status is live, which is why the counters move.
`RunResults` (`run-results.tsx`) does not do the same for
`extraction.getResults`, `extraction.summaryMarkdown` or `extraction.runReport` —
those are fetched once at mount and only invalidated by a mutation the operator
performs (edit a field, continue, mark complete). Nothing invalidates them as the
worker settles a document, so the table is stale by construction.

Separately, the grid has no concept of an unsettled document. `getResults`
returns every input document with its `status`, but `run-results.tsx` maps only
`id`, `filename`, `treePath` and `readable` into the grid's `SampleResult`, so
the `pending` / `extracting` documents are dropped on the floor.

A second-order defect in the same query: `getResults` classifies any document
with `recordId === null` as an exception. While a run is live that is *every*
document not yet processed, so an in-flight run reports its whole backlog as
exceptions. Fixing the pending indicator without fixing this would show each
queued document as both "queued" and "exception".

### Fix plan

- Move the live-status predicate out of `run-progress.tsx` into
  `run-tick-state.ts` as `isLiveRun`, so the progress panel and the results panel
  poll on one shared rule rather than two copies.
- Poll `getResults`, `summaryMarkdown` and `runReport` on the same interval while
  the run is live, driven by the run status the results query already returns.
- Carry each document's `status` through into the grid's `ResultDocument`, add
  `pendingDocuments` to `result-grid-model.ts`, and render one row per unsettled
  document beneath the records — named, badged `Queued` or `Processing`, so the
  operator can see exactly what is outstanding.
- Narrow `getResults`'s exception classification: a document with no record is an
  exception only once it has settled.

---

## 2. The synthesis editor does not persist what is on screen

### Symptom

On `/synthesise/<flowId>/edit`, fields configured against a structured output —
and the rest of the form with them — are gone when the page is reopened. It reads
as "Save did not save".

### Reproduction

1. Open a synthesis, choose **Structured output**, add two or three fields with
   labels, types and instructions.
2. Fill in the read instructions and the output instructions.
3. Press **Save**. A "Saved" toast appears.
4. Reload the page (or navigate away and back).
5. The output card is back to a single blank field and every text area is empty.

### Root cause (verified)

`EditSynthesisContent` (`edit/_content.tsx`) renders `EditorCards`
unconditionally, passing `initialSchema={schemaQuery.data ?? null}` on the very
first render — while the tRPC query is still pending, so the value is `null`.

`EditorCards` seeds all eleven pieces of form state from that prop through
`useState` initialisers, which React evaluates **once, at mount**. When the query
resolves a moment later the prop changes but the initialisers do not re-run, so
the editor stays on its empty defaults. The `isLoading` prop only hides the body;
it does not defer the mount.

The save round trip itself is sound — `saveSchema` → `parseExtractionSchema` →
`upsertDraft` stores the fields, and `getSchema` reads them back. The stored
schema is simply never shown, and the next Save overwrites it with the defaults
the operator can see.

### Fix plan

- Add `schemaSeedKey` to `extraction-editor-model.ts`: the identity of the schema
  a mount was seeded from. It changes when the query settles, so `EditorCards`
  remounts against the loaded schema instead of stranding on the pending `null`.
- Key `EditorCards` on it in `edit/_content.tsx`.

---

## 3. Toasts overlap in the bottom-right corner

### Symptom

When more than one toast is on screen, they sit on top of each other in the
bottom-right corner. The older messages are unreadable behind the newest one.

### Reproduction

1. Trigger two or more toasts in quick succession — e.g. save a synthesis and
   immediately start a sample.
2. The second toast lands on top of the first rather than above it.

### Root cause (verified)

`app/layout.tsx` mounts `<Toaster richColors closeButton />`. Sonner's default is
a *collapsed* stack: toasts are laid on top of one another and only fan out on
hover. That is the observed overlap; `expand` is the prop that makes the stack
render as a spaced column that grows upward from the corner.

### Fix plan

- Mount the toaster with `expand` and a `visibleToasts` allowance, so concurrent
  toasts bubble upward as separate, readable rows without hover.

---

## Tests

**Regression (vitest, pure model):**

- `run-tick-state.test.ts` — `isLiveRun` covers each run status.
- `result-grid-model.test.ts` — `pendingDocuments` returns unsettled documents
  only, respects the text filter, and yields nothing under "exceptions only".
- `extraction-editor-model.test.ts` — `schemaSeedKey` distinguishes a pending
  query from a settled one, so the editor cannot be seeded from a pending null.

**End-to-end (Playwright):** `apps/web/e2e/fix-synthesise-live-results.spec.ts`
covers all three — the run table gaining rows without a reload and showing its
queued documents, the editor round-tripping structured fields across a reload,
and two concurrent toasts occupying disjoint, upward-stacked boxes.
