# Phase — Branch Rules on Edges

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: 0.28.0 — **MINOR** (new column on `app_flow_edges`)
- **Base branch**: `release/alpha-2` (enhancement to shipped branching behaviour)
- **Depends on**: ADR-026 (branch choice at step advance), ADR-015 (version snapshots)
- **Extends**: ADR-008 §Edge handling — that decision pins edges to React Flow's
  default `smoothstep`. Forked edges now render through a custom edge type so the
  badge has somewhere to live; unforked edges keep the `smoothstep` look exactly.

## 1. Goal

When a step forks into two or more next steps, the AI currently picks a branch by
reading the *destination* step's metadata — `doneWhen`, falling back to
`aiInstruction`/`instruction`. That metadata describes what the destination step
*does*, not the condition under which the workflow should go there. The two are
often unrelated: "Collect the supplier's insurance certificate" says nothing
about *when* a session should take that path rather than the other one.

This phase lets the author state the condition on the connector itself — the
place the condition actually belongs — and makes a fork with an unstated
condition visible on the canvas while the flow is being authored, rather than
silently mis-routing at run time.

## 2. Business rules

| # | Rule | Behaviour |
| - | ---- | --------- |
| 1 | An edge may carry a **branch rule** — free text stating when to take it | Stored on the edge, not the destination node |
| 2 | Branch choice prompt: edge rule **wins**, destination metadata is the **fallback** | An edge with a rule contributes that rule; an edge without one falls back to `doneWhen` → `aiInstruction` → `instruction`, exactly as today |
| 3 | A rule is only meaningful where there is a choice | The indicator and the advisory only consider source nodes with **2 or more** outgoing edges |
| 4 | A fork whose edges lack rules is an authoring defect | Canvas advisory, in the same band as the disconnected-steps warning |
| 5 | Rules survive publish | `FlowSnapshotEdge` carries the edge config, so a published version routes by the rules that were in force when it was published |

Rule 2 is what keeps every existing flow behaving identically: no flow has an
edge rule today, so every branch keeps its current fallback description until an
author writes one.

## 3. UI / visible behaviour

- **Indicator on forked edges.** Where a source node has 2+ outgoing edges, each
  of its edges renders a clickable badge at the edge midpoint. Two states: a
  **warning** badge (⚠, amber, matching the existing advisory palette) when no
  rule is set, and a **rule-set** badge (✓) with the rule text as its accessible
  label and tooltip when one is. An edge from a node with a single outgoing edge
  renders no badge at all — nothing to choose between.
- **Branch rule modal.** Clicking the badge opens a small dialog: the source and
  destination step names as context, one multiline input labelled "When should
  the workflow take this path?", and Save / Cancel. When a rule already exists,
  the input is pre-filled and a **Remove rule** action clears it.
- **Canvas advisory.** Modelled on `DisconnectedStepsWarning` and rendered in the
  same warning band: names the forking step(s), carries the same ⚠ icon the badge
  uses so the copy and the canvas agree, and states the fix — click the marked
  connector and add a rule.
- **Empty/again states.** No forks → no badges, no advisory. All forked edges
  ruled → badges stay (showing ✓) but the advisory disappears.

## 4. Data & types

| Type | Change |
| ---- | ------ |
| `FlowEdge` (domain) | `+ config: Record<string, unknown>` |
| `NewFlowEdge` (domain) | `+ config?: Record<string, unknown>` |
| `FlowSnapshotEdge` (domain) | `+ config?: Record<string, unknown>` — optional so legacy snapshots read back unchanged |
| `BranchDescriptor` (domain, new) | `{ id, name, rule?, purpose? }` — what the branch-choice prompt is built from |
| `BuildBranchChoicePromptInput.branchNodes` (port) | `+ rule?: string` |

New pure domain module `entities/branch-rule.ts`:

- `readBranchRule(config): string | undefined` — reads and trims
  `config.branchRule`, returning `undefined` for blank/missing.
- `withBranchRule(config, rule): Record<string, unknown>` — sets or deletes the
  key, leaving any other edge config untouched.
- `buildBranchDescriptors(nodes, outgoingEdges)` — the single implementation of
  "rule wins, metadata falls back", replacing the logic currently triplicated
  across the chat stream route, `confirm-step.ts`, and the scheduler.

## 5. Files & packages touched

**domain**
- `entities/flow-edge.ts` (modify), `entities/branch-rule.ts` (create),
  `entities/branch-rule.test.ts` (create), `entities/flow-version.ts` (modify —
  snapshot carries config), `entities/index.ts` (modify)
- `ports/session-agent.ts` (modify), `ports/flow-edge-repository.ts` (modify —
  `updateConfig`)

**application**
- `use-cases/flow/set-flow-edge-branch-rule.ts` + test (create),
  `use-cases/flow/index.ts` (modify)

**adapters**
- `db/schema/wayfinder.ts` (modify), `drizzle/00xx_*.sql` (generated),
  `repositories/drizzle-flow-edge-repository.ts` (modify),
  `repositories/drizzle-flow-version-repository.ts` (modify — `restore` deletes
  and re-inserts every edge row, so it must carry `config` back or a restore
  silently strips every rule),
  `agents/flow-session-graph.ts` (modify — prompt states the rule)

**apps/web**
- `lib/canvas/rf-adapters.ts` (modify — `EDGE_TYPES`, `toRfEdges`),
  `lib/canvas/canvas-guidance.ts` (modify — `findForksMissingBranchRule`)
- `components/canvas/branch-rule-edge.tsx`, `branch-rule-modal.tsx`,
  `missing-branch-rules-warning.tsx` (create)
- `components/canvas/flow-canvas-viewport.tsx`,
  `app/(user)/flows/[id]/config/_content.tsx`, `server/routers/flow.ts`,
  `lib/container.ts` (modify)
- Branch-choice call sites: `app/api/chat/[sessionId]/stream/route.ts`,
  `lib/chat/confirm-step.ts`, `lib/scheduler/scheduled-session-fire-handler.ts`
  (modify — all three delegate to `buildBranchDescriptors`)

## 6. Database & migration impact

- Table `app_flow_edges` (group prefix `app_`), one added column:
  `config jsonb NOT NULL DEFAULT '{}'::jsonb`.
- Generated migration (never `drizzle-kit push`). Additive with a default, so
  existing rows are backfilled to `{}` and nothing is destroyed:
  `-- data-impact: preserved — additive nullable-safe column with a default;
  existing edges read back as {} and keep their current fallback branch behaviour`.

## 7. Implementation order (tests before implementation)

1. `branch-rule.test.ts` → `branch-rule.ts` (read/write helpers,
   `buildBranchDescriptors` precedence and fallback).
2. Schema column + generated migration + `migration-safety` passes.
3. Repository `updateConfig` + `SetFlowEdgeBranchRule` use case + tRPC mutation.
4. Snapshot round-trip: `flow-version.test.ts` covers config through
   `buildFlowSnapshot` → `flowEdgesFromSnapshot`, including a legacy snapshot
   with no `config` key; version restore re-inserts edge rows with their config.
5. Prompt: `buildBranchChoicePrompt` states a supplied rule and falls back
   otherwise; the three call sites switch to `buildBranchDescriptors`.
6. Canvas: `findForksMissingBranchRule` (guidance test first), then the edge
   component, modal, advisory, and viewport wiring.

## 8. Tests

- `packages/domain/src/entities/branch-rule.test.ts` — helpers and descriptor
  precedence (rule wins; blank rule falls back; single-edge case).
- `packages/domain/src/entities/flow-version.test.ts` — config survives the
  snapshot round trip; legacy snapshot without `config` reads back as `{}`.
- `packages/application/src/use-cases/flow/set-flow-edge-branch-rule.test.ts` —
  sets, clears, and preserves unrelated config keys.
- `packages/adapters/src/agents/flow-session-graph.test.ts` — prompt renders the
  rule for ruled branches and the metadata fallback for un-ruled ones.
- `apps/web/src/lib/canvas/canvas-guidance.test.ts` — forks missing rules are
  found; single-outgoing-edge nodes are ignored; fully-ruled forks are clean.
- `apps/web/e2e/enhance-branch-rules.spec.ts` — **written, not run locally**
  (CI runs it): fork a step, see the warning badge and advisory, open the edge
  modal, save a rule, badge flips to the ruled state and the advisory clears
  once every forked edge is ruled.

## 9. Risks

- **Prompt regression.** The three branch-choice call sites drift today; folding
  them into one helper is the fix but changes the runtime path for every
  branching session. Mitigated by asserting the exact fallback order in tests.
- **jsonb default on a hot table.** `app_flow_edges` is small (edges per flow),
  so the rewrite is negligible, but the column is `NOT NULL DEFAULT` rather than
  nullable to keep reads free of null checks.
- **Custom edge type.** Registering `EDGE_TYPES` changes how *every* edge
  renders, not only forked ones. The component must render a plain edge when no
  badge applies. This extends ADR-008's edge-handling decision.
- **Silent rule loss on restore.** `restore` deletes and re-inserts every edge
  row; missing `config` there would strip rules with no error surfaced. Covered
  by test rather than review.

## 10. Out of scope

- Validating or compiling rules — free text, evaluated by the model.
- Blocking publish on a fork with no rules; this stays advisory, like the
  disconnected-steps warning.
- Rules on any edge that is not part of a fork.
- Migrating destination metadata into edge rules automatically.
