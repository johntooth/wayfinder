# Bug fix — Single-step canvas zoom, and build skills leave e2e to CI

- **Version**: 0.21.3 (bump: **PATCH** — one presentation constant plus skill
  documentation; no schema impact, no domain or application change)
- **Base branch**: `release/alpha-2`
- **Type**: `/bugfix`

## Why

Two unrelated irritations, both small enough to ship in one patch.

### 1. A one-step canvas opens far too close

Opening `/flows/[id]/config` for a flow that holds a single step showed that
step magnified: it dominated the pane and read as a different screen from the
empty canvas the author had been looking at a moment earlier, where the "create
your first step" prompt sits at ordinary scale.

**Root cause.** `FlowCanvasViewport` passes React Flow's `fitView` prop with no
`fitViewOptions`. Fit-to-view then falls back to the pane's own zoom ceiling,
and React Flow's default `maxZoom` is `2` (confirmed in
`@xyflow/react@12.10.2`'s bundled store defaults). With many steps this never
shows, because the bounding box of the graph fits below `1` anyway and the
ceiling is not reached. With one small node the box is tiny, so fit-to-view
scales all the way up to the `2x` ceiling. Nothing about the single-step case
was special-cased — the default ceiling simply only ever bites there.

### 2. Build skills were running Playwright locally

`/build`, `/bugfix` and `/enhance` each ended with a step that required the
Playwright spec to be *run* and seen to pass ("the test must pass before
proceeding", "must fail on the unfixed code and pass after the fix"). A local
run needs Postgres, Redis, MinIO, a built app and browser binaries, takes many
minutes, and duplicates exactly what `.github/workflows/e2e.yml` already does on
every pull request and push to `main` and `release/**` — sharded, against a
clean stack.

The same three skills also described opening the pull request as the last item
of a compound bullet, which made it easy to read as optional and stop at
"pushed". The PR is what starts CI, so the e2e suite only runs if it is opened.

## What changes

### Canvas zoom

New shared constant in `apps/web/src/lib/canvas/rf-adapters.ts`:

```ts
export const CANVAS_FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };
```

Applied in both places the canvas fits to view:

- `FlowCanvasViewport`'s `fitViewOptions` prop, covering React Flow's initial
  fit on mount — the path a single-step flow takes.
- The imperative `fitView(...)` in `_content.tsx`, which previously passed
  `{ padding: 0.2 }` and inherited the same `2x` ceiling.

Capping at `1` means a lone step is drawn at the same scale as the empty
canvas's prompt. Flows large enough to fit below `1` are unchanged, because the
cap is a ceiling, not a target. Padding stays at `0.2`, which is what the
imperative call already used; hoisting it into the shared constant makes the
two paths agree rather than drift.

### Build-skill workflow

`/build`, `/bugfix` and `/enhance`:

- The Playwright step still **writes** the spec — coverage is not being dropped
  — but explicitly does not run it, naming `.github/workflows/e2e.yml` as where
  it runs and `/e2e` / `/e2e-cc-web` as the opt-in local escape hatch when the
  user asks for one.
- `/bugfix`'s fail-then-pass proof moves to where it already lived in practice:
  the Step 2 regression test, which runs on every `./validate.sh`.
- Opening the pull request is now its own bullet, marked **always**, with the
  reason stated (it is what starts CI) and an instruction to report the URL.

## Tests

- `apps/web/src/lib/canvas/rf-adapters.test.ts` — the zoom cap and padding are
  what the canvas actually uses. This is the regression guard: it fails if the
  ceiling is removed or raised.
- `apps/web/e2e/fix-canvas-single-step-zoom.spec.ts` — creates a flow with one
  step, reloads so React Flow's initial fit-to-view runs against the saved
  single-step flow, and asserts the viewport transform's scale is at most `1`.
  Run by CI, per the skill change above.

## Out of scope

The pane's interactive zoom range is untouched — an author can still zoom in
past `1x` with the controls or the wheel. Only the automatic fit is capped.
