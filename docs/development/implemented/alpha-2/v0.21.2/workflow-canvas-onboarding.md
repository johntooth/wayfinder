# Enhancement — Workflow canvas onboarding guidance

- **Version**: 0.21.2 (bump: **PATCH** — presentation only, no schema impact, no
  domain or application change)
- **Base branch**: `release/alpha-2`
- **Type**: `/enhance`

## Why

`/flows/[id]/config` is where a business user assembles a workflow, and it is
the one screen in Wayfinder that assumes knowledge the product never teaches.
Three gaps, all on the same surface:

1. **Nothing explains how steps are joined.** A step is connected by dragging
   from the dot on its right edge to the dot on the left edge of the next step.
   Nothing on the canvas says so. An author who does not discover the gesture
   ends up with a set of unconnected steps, which is not a workflow — the runtime
   walks edges, so an unjoined step never runs.
2. **The empty-canvas call to action is `+ Add step`.** It says what the button
   does mechanically, not what the author is trying to achieve.
3. **After the first step there is no visible next move.** The only way to add a
   second step is the header's `Add step` button or discovering the drag
   gesture. Nothing on the canvas points rightwards along the flow.

Together these three changes are meant to read as one lesson: *steps run left to
right, and they have to be joined up.*

Scope is the canonical canvas at `/flows/[id]/config`. The former admin editor
at `/admin/flows/[id]` is already a redirect to that route
(`apps/web/src/app/(admin)/admin/flows/[id]/page.tsx`), so there is one canvas to
change and both entry points inherit it.

## What changes

### 1. Disconnected-steps warning

When the canvas holds **more than one step** and at least one step has **no edge
at all** (neither incoming nor outgoing), a warning appears at the top of the
canvas.

- Yellow, matching the existing stale-reference banner (`#fff8e1` background,
  `#e7c200` border, `#886b00` text) so the canvas has one warning language.
- Centred horizontally at the top of the pane, and deliberately **wide and
  short** — it overlays the canvas, so it spends horizontal space rather than
  vertical and keeps the working area visible. Concretely: copy and diagram sit
  **side by side** — copy left-aligned in the remaining space, `364px × 40px`
  diagram strip on the right — inside a banner up to `900px` wide and under
  `90px` tall, so it covers a small fraction of a standard desktop pane.
- Copy:

  > Some steps aren't joined up yet. Every step needs to be joined to the others
  > to be part of the workflow — drag from the dot on the right of one step to
  > the dot on the left of the next to link them in order.

- To the right of the copy, a **mini animated diagram** demonstrating the gesture: two
  step cards side by side, a pointer travelling from the source dot on the right
  of the first card to the target dot on the left of the second, drawing the
  connector as it goes, then a snap pulse on the target before the loop resets.

A step counts as disconnected only when it has no edge in either direction. A
step wired into the graph the "wrong" way round is still joined, and is not this
warning's business — the existing stale-reference banner covers broken data
bindings.

The warning is advisory. It does not block saving, publishing, or running.

### 2. Empty-canvas button copy

`+ Add step` becomes `+ Create your first step in your workflow`.

### 3. Ghost "next step" button

With one or more steps on the canvas, a second button sits **to the right of the
right-most step**, in canvas coordinates, so it pans and zooms with the flow and
always reads as "the flow continues this way".

- Label: `+ Create the next step in your workflow`.
- Semi-transparent at rest so it is clearly a prompt rather than a step, opaque
  on hover and on keyboard focus. Transparency is capped so the blended label
  still clears WCAG AA contrast — see **Accessibility** below.
- Hidden when the right-most step is saved as **never done**. A never-done step
  loops until the operator ends it, so no step can follow it and offering one
  would be a lie.

**Whether the new step is auto-connected** depends on how many loose ends the
graph has:

- Exactly one step has no outgoing edge → that step is the unambiguous
  continuation point, so the new step is created **and joined to it**, exactly as
  though the author had dragged a connector out of it.
- Zero or more than one → the flow has open branches and there is no single
  correct parent, so the new step is created **unconnected** and the author
  chooses. In this case the disconnected-steps warning then appears and teaches
  the gesture, which is the intended hand-off between the two features.

Note the single open end is not necessarily the right-most step (an author can
drag steps anywhere). The button is always positioned beside the right-most step
as specified, but connects from the single open end when there is one.

## Design

### New module — `apps/web/src/lib/canvas/canvas-guidance.ts`

Pure functions over the React Flow node/edge shapes, no React, unit-tested
independently of the canvas.

```ts
export const STEP_NODE_WIDTH = 224;   // w-56, shared by every node component
export const STEP_NODE_HEIGHT = 78;   // a two-line step card
export const NEXT_STEP_GAP = 56;      // "a bit of space" to the right

interface GuidanceNode {
  id: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  type?: string;
  data: Record<string, unknown>;
}
interface GuidanceEdge { source: string; target: string }

export function findDisconnectedNodeIds(
  nodes: GuidanceNode[],
  edges: GuidanceEdge[],
): string[];

export interface NextStepAnchor {
  position: { x: number; y: number };   // the new step's top-left corner
  nodeHeight: number;                   // so the prompt centres against the step
  connectFromNodeId: string | null;
}

export function findNextStepAnchor(
  nodes: GuidanceNode[],
  edges: GuidanceEdge[],
): NextStepAnchor | null;
```

- `findDisconnectedNodeIds` returns `[]` when there are fewer than two nodes, and
  otherwise every node id absent from both ends of every edge. Order follows the
  input so the result is stable across renders.
- `findNextStepAnchor` returns `null` for an empty canvas, and `null` when the
  right-most node is never-done. The right-most node is the greatest
  `position.x`, tie-broken by `position.y` then `id` so the anchor never jitters
  between equally-placed steps. Position is `rightMost.x + width + NEXT_STEP_GAP`
  at the right-most node's `y`, where `width` is the node's measured width when
  React Flow has reported one and `STEP_NODE_WIDTH` before then. `nodeHeight`
  follows the same measured-then-fallback rule, and lets the view centre the
  prompt in the band the new step will occupy instead of clipping it to the top
  edge of a much taller card.
- Never-done is read from the conversational node's saved config
  (`data.config.neverDone`, mirrored onto `data.neverDone` by `toRfNode`). Only
  conversational steps carry the flag; every other type is treated as
  continuable.

### New component — `apps/web/src/components/canvas/disconnected-steps-warning.tsx`

Presentational. Takes `count: number` and renders an empty (invisible) live
region when it is zero, so the announcement region is stable across the
transition and the component stays trivially testable.

The diagram is inline SVG with CSS-driven animation. Keyframes live in
`apps/web/src/styles/globals.css` alongside the existing `run-progress-*` rules,
which already establish the pattern — including a
`@media (prefers-reduced-motion: reduce)` block. Under reduced motion the
diagram holds the finished state: connector drawn, pointer resting on the target
dot. No JavaScript timers; the animation is declarative and costs nothing when
the banner is absent.

### `apps/web/src/components/canvas/flow-canvas-viewport.tsx`

- Empty-state button copy updated.
- The warning banner is rendered as a pane overlay (`absolute top-3`, centred,
  `pointer-events-none`), above the React Flow surface, matching how the
  stale-reference banner already works at the bottom.
- The ghost button is rendered inside React Flow's `<ViewportPortal>`
  (`@xyflow/react` 12.10.2, verified exported) so it shares the flow's coordinate
  system and transforms with pan and zoom. It is absolutely positioned at the
  anchor via `transform: translate(x, y)`.
- New prop `onAddNextStep(anchor: NextStepAnchor)`. The viewport computes the
  anchor and the disconnected count itself from the nodes and edges it is already
  given, so the caller gains one callback rather than several derived props.

### `apps/web/src/app/(user)/flows/[id]/config/_content.tsx`

`handleAddNextStep(anchor)` sets `pendingConnect` to
`{ fromNodeId: anchor.connectFromNodeId, position: anchor.position }` when there
is a parent to connect from, otherwise records just the position, then opens the
existing node-type picker. The picker's `handleSelectNodeType` already routes
through `createAndEditNode(type, position, fromNodeId?)`, which persists the node,
optionally wires the edge, and opens the config modal — so the new button reuses
the drag-out path end to end rather than adding a second way to create a step.

`pendingConnect`'s type widens from `{ fromNodeId: string; position }` to
`{ fromNodeId: string | null; position }` to carry the unconnected case.

## Accessibility

`apps/web` targets WCAG 2.2 AA and `validate.sh` check 15 runs `jsx-a11y` strict
independently of the general lint pass, so both new pieces are specified against
that bar (`docs/guides/accessibility.md`).

- The banner is a **polite live region** (`role="status"`). It appears in
  response to the author's own edit, so it must be announced without stealing
  focus or interrupting — `role="alert"` would be wrong for advisory guidance.
  The region element is always mounted and only its contents toggle; a live
  region that mounts already populated is announced unreliably.
- The diagram is decorative: `aria-hidden="true"` on the SVG, with the copy above
  it carrying the whole instruction. Nothing is conveyed by the animation alone
  (SC 1.1.1), and reduced motion is honoured (SC 2.3.3).
- The banner is `pointer-events-none` so it never swallows a click meant for the
  canvas beneath it.
- Banner colours reuse the stale-reference banner's `#886b00` on `#fff8e1`,
  already in use on this pane.
- The ghost button is a real `<button>`, keyboard focusable and in the tab order,
  and reaches full opacity on `:hover` **and** `:focus-visible` so a keyboard
  user never reads it at reduced contrast. At rest its opacity is capped at
  `0.7`: `#1a1814` at 70% over the canvas surface blends to roughly `#5a5751`,
  which is about 6.9:1 against `#faf9f7` — comfortably past the 4.5:1 floor of
  SC 1.4.3. Transparency is applied to the button as a whole rather than to the
  text colour, so the treatment stays a single reversible rule.
- Both the empty-state and ghost buttons carry their full instruction as their
  accessible name, so they are distinguishable out of context (SC 2.4.6).

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The ghost button overlaps an existing step whose author has dragged it into the gap to the right of the right-most step | Medium | The anchor sits `NEXT_STEP_GAP` beyond the right-most node's right edge by construction, so nothing can already be there — a node further right would itself be the right-most node. Confirmed by a unit test that anchors by `x`, not insertion order. |
| The banner obscures steps positioned near the top of the pane | Medium | Height is capped near `110px` and the banner is `pointer-events-none`, so an obscured step stays draggable and clickable through it; the author can also pan. Accepted: an advisory that is never seen does not teach. |
| The disconnected warning fires while a step is mid-creation, flickering as the author works | Medium | A step created from the ghost button with a single open end is joined in the same action, so the common path never transiently trips the warning. The unconnected branch case is the deliberate hand-off described above. |
| `ViewportPortal` behaviour changes on a React Flow upgrade | Low | ADR-008 already requires an exact pin and routes upgrades through `/enhance`. The API is verified against the installed `@xyflow/react@12.10.2` rather than assumed. |
| Blanket `opacity` on the ghost button drops its label below AA contrast | Low | Capped at `0.7` with the contrast arithmetic recorded above, and full opacity on hover and focus. |
| Copy is long enough to wrap to several lines on a narrow viewport, eating vertical space | Low | The canvas is documented as desktop-only (PRD §5 non-goals: "No mobile-optimised canvas"). The banner is width-capped and centred; wrapping on a narrow pane is acceptable degradation. |

## Out of scope

- No change to how the runtime treats unconnected steps. The warning is
  advisory; execution semantics are untouched.
- No auto-layout, no snapping, no repositioning of existing steps.
- No change to the header's `Add step` button.
- No new domain, application, or adapter code; no migration.

## Acceptance criteria

- [ ] An empty flow canvas shows exactly one call to action, reading
      `+ Create your first step in your workflow`, and no ghost button.
- [ ] With one step present, a button reading
      `+ Create the next step in your workflow` is visible to the right of that
      step, and creating a step from it produces two steps joined by one edge.
- [ ] With two steps and no edge between them, the yellow banner is visible at
      the top of the pane containing the string "aren't joined up yet"; drawing
      an edge between them removes it without a page reload.
- [ ] With one step present and that step saved with `neverDone`, no ghost button
      is rendered.
- [ ] With two open branches, creating a step from the ghost button produces a
      step with no edges, and the banner appears.
- [ ] `./validate.sh` passes, including check 15 (`jsx-a11y` strict).
- [ ] `VERSION` and root `package.json` both read `0.21.2`.

## Testing

**Unit — `apps/web/src/lib/canvas/canvas-guidance.test.ts`** (written first)

- `findDisconnectedNodeIds`
  - returns `[]` for zero and one node, even when that node has no edges
  - finds a node with no edges among several connected ones
  - treats a node with only an incoming edge, and one with only an outgoing
    edge, as connected
  - returns several ids in input order when several steps are loose
- `findNextStepAnchor`
  - `null` on an empty canvas
  - anchors to the right-most node by `x`, not by insertion order
  - offsets by the measured width when present, by `STEP_NODE_WIDTH` otherwise
  - `connectFromNodeId` is the single open end for a linear chain of steps
  - `connectFromNodeId` is `null` when two branches are open
  - `connectFromNodeId` is the single open end even when that end is not the
    right-most node on screen
  - `null` when the right-most node is a never-done conversational step
  - a never-done step that is *not* right-most does not suppress the button

**E2E — `apps/web/e2e/enhance-workflow-canvas-onboarding.spec.ts`**

- An empty flow's canvas shows `+ Create your first step in your workflow`; the
  ghost next-step button is absent.
- After creating one step, the ghost `+ Create the next step in your workflow`
  button appears; clicking it opens the type picker and creating a step yields
  two joined steps and no warning.
- A flow with a deliberately unjoined step shows the yellow warning with the
  joined-up copy and the diagram, and the warning clears once the step is joined.

`./validate.sh` after each sub-component and before the final commit.

## Rollout

No feature flag. No migration. No configuration. Purely additive presentation on
one screen; reverting is a straight revert of the commit.
