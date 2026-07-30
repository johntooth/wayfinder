# Implementation summary — Single-step canvas zoom + build skills leave e2e to CI (v0.21.3)

- **Version**: 0.21.3 (**PATCH** — presentation constant plus skill docs, no schema impact)
- **Base branch**: `release/alpha-2`
- **Type**: `/bugfix`

## 1. Canvas fit-to-view is capped at 1x

**Root cause.** `FlowCanvasViewport` used React Flow's `fitView` prop with no
options, so fit-to-view inherited the pane's default `maxZoom` of `2`
(verified against `@xyflow/react@12.10.2`). A graph of several steps fits below
`1` and never reaches that ceiling; a single small node does, so a one-step flow
opened magnified while the empty canvas beside it sat at ordinary scale.

**Fix.** `CANVAS_FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 }` in
`apps/web/src/lib/canvas/rf-adapters.ts`, used by both fit paths:

| File | Change |
|---|---|
| `apps/web/src/lib/canvas/rf-adapters.ts` | New exported constant + the reason for the cap |
| `apps/web/src/components/canvas/flow-canvas-viewport.tsx` | `fitViewOptions={CANVAS_FIT_VIEW_OPTIONS}` on `<ReactFlow>` |
| `apps/web/src/app/(user)/flows/[id]/config/_content.tsx` | `fitView(CANVAS_FIT_VIEW_OPTIONS)` replaces the inline `{ padding: 0.2 }` |

Larger flows are unaffected — the cap is a ceiling, not a target — and the
controls still zoom past `1x` on demand. Hoisting `padding` into the shared
constant stops the declarative and imperative fits from drifting apart.

## 2. `/build`, `/bugfix`, `/enhance` no longer run Playwright

Each skill still writes an e2e spec; none of them run one. The step now names
`.github/workflows/e2e.yml` — which fires on every pull request and push to
`main` and `release/**`, sharded, against a full stack — as where it runs, and
`/e2e` / `/e2e-cc-web` as the opt-in path when the user explicitly asks for a
local run. `/bugfix`'s fail-then-pass requirement moves onto the Step 2
regression test, which runs under `./validate.sh`.

Opening the pull request became its own **always** bullet in all three skills,
with the reason attached (the PR is what starts CI, including the e2e run that
was skipped locally) and an instruction to report the URL. It was previously
the tail of a compound "commit, push, then open a PR" bullet, easy to read as
optional.

| File | Change |
|---|---|
| `.claude/commands/build.md` | Step 3 writes-not-runs; Step 4 splits out an always-open-a-PR bullet |
| `.claude/commands/bugfix.md` | Step 5 writes-not-runs, fail-then-pass proof moves to Step 2; Step 6 splits out the PR bullet |
| `.claude/commands/enhance.md` | Step 4 writes-not-runs; step 5 splits out the PR bullet |

## Tests added

- `apps/web/src/lib/canvas/rf-adapters.test.ts` — regression guard on the zoom
  cap and padding; fails if the ceiling is removed or raised.
- `apps/web/e2e/fix-canvas-single-step-zoom.spec.ts` — one-step flow, reload,
  assert the viewport transform's scale is at most `1`. Runs in CI.

## Known limitations

The e2e spec asserts the fitted scale, not that the step "looks right" — a
future change to node dimensions could keep the scale at `1` while changing how
much of the pane the step occupies. That is the intended contract: the cap is
about matching the rest of the canvas's scale, not about framing.
