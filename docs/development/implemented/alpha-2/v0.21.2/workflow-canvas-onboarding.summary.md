# Implementation summary — Workflow canvas onboarding guidance (v0.21.2)

- **Version**: 0.21.2 (**PATCH** — presentation only, no schema impact)
- **Base branch**: `release/alpha-2`
- **Type**: `/enhance`

Three additions to the flow-config canvas, meant to be read as one lesson:
*steps run left to right, and they have to be joined up.* The canvas previously
assumed the author already knew the drag-to-join gesture and never taught it, so
an author who did not discover it ended up with steps that the runtime — which
walks edges — would never execute.

Scope is the canonical canvas at `/flows/[id]/config`. `/admin/flows/[id]` is
already a redirect to that route, so both entry points inherit the change.

---

## 1. Disconnected-steps warning

**New** `apps/web/src/components/canvas/disconnected-steps-warning.tsx`.

Shown when the canvas holds more than one step and at least one has no edge in
either direction. Yellow, reusing the stale-reference banner's `#fff8e1` /
`#e7c200` / `#886b00` so the pane has one warning language. Centred at the top,
laid out wide and short — copy on one line up to `760px`, a `40px` diagram strip
beneath — measured at **104px tall**, inside the `110px` budget the phase doc
set.

Copy:

> ⚠ Some steps aren't joined up yet. Every step needs to be joined to the others
> to be part of the workflow — drag from the dot on the right of one step to the
> dot on the left of the next to link them in order.

The mini diagram is inline SVG: two step cards, a pointer dragging from the
source dot to the target dot while the connector draws behind it, then a snap
pulse on the target, on a 3.6s loop. The three animations share one duration and
one set of stops so pointer, connector and target stay in step.

Keyframes (`wf-connect-draw`, `wf-connect-pointer`, `wf-connect-target`) live in
`apps/web/src/styles/globals.css` beside the existing `run-progress-*` rules,
which already established that pattern including a reduced-motion branch. Under
`prefers-reduced-motion: reduce` the diagram holds the finished join —
verified in Chromium: `stroke-dashoffset: 0px`, pointer at
`matrix(1,0,0,1,140,0)`, zero running animations.

**Accessibility.** The `role="status"` live region is always mounted and only its
contents toggle — a region that mounts already populated is announced
unreliably. The SVG is `aria-hidden="true"` (the copy carries the whole
instruction), and the banner is `pointer-events-none` so it never swallows a
click meant for the canvas beneath it.

## 2. Empty-canvas button copy

`+ Add step` → `+ Create your first step in your workflow`. The toolbar button in
`_flow-config-header.tsx` keeps its `+ Add step` label.

## 3. Ghost next-step prompt

Rendered inside React Flow's `<ViewportPortal>` so it shares the flow's
coordinate system and pans and zooms with the steps rather than drifting over the
canvas. Always sits past the right-most step — measured at exactly
`NEXT_STEP_GAP` (56px) beyond its right edge — and is vertically centred in the
band the new step will occupy rather than clipped to the top of a taller card.

Hidden when the right-most step is saved `neverDone`: such a step loops until the
operator ends it, so nothing can follow it.

**Auto-connect is conditional.** When exactly one step has no outgoing edge, that
step is the unambiguous continuation point and the new step is joined to it. With
zero or several open branches there is no single correct parent, so the step is
created unconnected and the author chooses — which raises the warning above, the
intended hand-off between the two features. The single open end is not
necessarily the right-most step; the prompt is positioned by the latter and
connects from the former.

Styled `opacity-70` at rest, `opacity-100` on hover **and** `focus-visible`, with
a dashed border. Verified at `0.7`: `#1a1814` at 70% over the canvas blends to
roughly `#5a5751`, about 6.9:1 against `#faf9f7` — past the 4.5:1 floor of
WCAG SC 1.4.3.

---

## Files

**New**

- `apps/web/src/lib/canvas/canvas-guidance.ts` — `findDisconnectedNodeIds`,
  `findNextStepAnchor`, `STEP_NODE_WIDTH`, `STEP_NODE_HEIGHT`, `NEXT_STEP_GAP`.
  Pure, no React, no React Flow runtime.
- `apps/web/src/lib/canvas/canvas-guidance.test.ts` — 22 cases, written first.
- `apps/web/src/components/canvas/disconnected-steps-warning.tsx`
- `apps/web/e2e/enhance-workflow-canvas-onboarding.spec.ts`

**Modified**

- `apps/web/src/components/canvas/flow-canvas-viewport.tsx` — new
  `onAddNextStep` prop; derives the disconnected count and the anchor from the
  nodes and edges it already receives, so the caller gains one callback rather
  than several derived props.
- `apps/web/src/app/(user)/flows/[id]/config/_content.tsx` — `handleAddNextStep`
  feeds the existing `pendingConnect` → type picker → `createAndEditNode` path,
  so the prompt reuses the drag-out route end to end instead of adding a second
  way to create a step. `pendingConnect.fromNodeId` widens to `string | null` to
  carry the unconnected case.
- `apps/web/src/styles/globals.css` — the three keyframes and their
  reduced-motion branch.
- `apps/web/e2e/fix-template-upload-resets-output-type.spec.ts` — asserted on the
  empty-canvas overlay by its old `+ Add step` name and counted two such buttons;
  now targets the renamed overlay and counts each separately.
- `VERSION`, `package.json` — 0.21.1 → 0.21.2.

No domain, application, or adapter code. No migration, no new tRPC procedure, no
feature flag.

---

## Testing

**Unit** — `apps/web/src/lib/canvas/canvas-guidance.test.ts`, 22 passing:
disconnected detection (empty, single-step, incoming-only, outgoing-only,
several loose, both-loose), and anchoring (empty canvas, right-most by `x` rather
than insertion order, measured vs fallback width and height, single open end,
open branches, open end that is not right-most, cycle with no open end,
never-done right-most, never-done read from saved config, never-done not
right-most, never-done ignored on step types that cannot carry it, tie-break
stability).

**E2E** — `apps/web/e2e/enhance-workflow-canvas-onboarding.spec.ts` is the spec
covering this change, in three tests:

1. an empty canvas shows `+ Create your first step in your workflow`, with no
   next-step prompt and no warning;
2. after the first step, the next-step prompt appears and the step it creates
   arrives joined — two nodes, one edge, no warning;
3. a step added without a join raises the yellow warning with the drag diagram
   (`aria-hidden`), and drawing the edge clears it without a reload.

**Verified in this environment**: `./validate.sh` passes all 20 checks, including
check 7 (VERSION matches `package.json`), check 8 (doc lifecycle) and check 15
(`jsx-a11y` strict). The banner and prompt were additionally rendered in Chromium
against the real animation CSS to confirm the geometry quoted above (104px
banner, 56px gap, 0.7 opacity) and the reduced-motion end state.

Check 16 warns that `_content.tsx` is now 774 lines (up from 761, threshold 800).
It was already on the warn list before this change; splitting it is the next
structural job on that file.

**Not run here**: the Playwright suite, which needs Postgres, Redis and MinIO.
Docker is unavailable in this container, so the e2e specs run in CI.
