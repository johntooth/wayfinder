# Implementation Summary — Branch Rules on Edges (v0.28.0)

- **Version**: 0.27.6 → **0.28.0** (MINOR — new column on `app_flow_edges`)
- **Base branch**: `release/alpha-2`
- **Phase doc**: `edge-branch-rules.phase.md` (this folder)
- **E2E**: `apps/web/e2e/enhance-branch-rules.spec.ts` (written, run in CI)

## What changed

When a step forked, the AI chose a branch by reading the *destination* step's
`doneWhen`, falling back to `aiInstruction`/`instruction`. That metadata says
what the destination step does once reached, not when the workflow should go
there — "Capture the amount of the purchase" is a job description, not a routing
condition. The author now states the condition on the connector itself, and a
fork whose connectors say nothing is visible on the canvas while the flow is
being authored rather than mis-routing silently at run time.

## How it works

**Storage.** `app_flow_edges` gains `config jsonb NOT NULL DEFAULT '{}'`, holding
`branchRule`. jsonb rather than a `branch_rule` column so a second edge property
needs no further migration. `FlowEdge.config` is required; `NewFlowEdge.config`
and `FlowSnapshotEdge.config` are optional so legacy snapshots read back as `{}`.

**Precedence — the rule that keeps existing flows unchanged.**
`buildBranchDescriptors` (domain, `entities/branch-rule.ts`) is now the single
definition of how a fork is described to the model: the edge's own rule wins,
and an edge without one falls back to `doneWhen` → `aiInstruction` →
`instruction`, exactly as before. No flow has a rule until an author writes one,
so branching behaviour is unchanged on upgrade.

The prompt labels the two differently — `Take this branch when: …` for a stated
rule, `This step's own description: …` for the fallback — because labelling them
identically invites the model to read a job description as a routing condition,
which is the bug this enhancement exists to fix.

**Triplication removed.** The chat stream route, `confirm-step.ts` and the
scheduler each had their own copy of the fallback chain, already drifting (only
the route used `doneWhenGuidance`). All three now call `buildBranchDescriptors`.

**Canvas.** Every edge renders through `BranchRuleEdge`, which draws the plain
smoothstep edge unless the edge is part of a fork — it reads sibling edges from
the React Flow store, so the badge appears the moment a second edge is drawn out
of a step. The badge is ⚠ when un-ruled and ✓ when ruled; clicking it opens a
single-field modal. `MissingBranchRulesWarning` sits in the existing canvas
warning band, names the forking steps, and renders the same ⚠ glyph the badge
uses via the shared `BranchRuleIcon` — an advisory describing an icon the canvas
does not show would be worse than none.

**Restore.** `FlowVersionRepository.restore` deletes and re-inserts every edge
row. Without carrying `config`, restoring a version would have stripped every
branch rule with no error surfaced. Found during `/doc-review`, covered by test.

## Files

| Layer | Files |
| ----- | ----- |
| domain | `entities/branch-rule.ts` (+ test), `entities/flow-edge.ts`, `entities/flow-version.ts` (+ test), `entities/index.ts`, `ports/flow-edge-repository.ts`, `ports/session-agent.ts` |
| application | `use-cases/flow/set-flow-edge-branch-rule.ts` (+ test), `use-cases/flow/index.ts` |
| adapters | `db/schema/wayfinder.ts`, `drizzle/0043_organic_vengeance.sql`, `repositories/drizzle-flow-edge-repository.ts`, `repositories/drizzle-flow-version-repository.ts`, `agents/flow-session-graph.ts` (+ test) |
| apps/web | `components/canvas/branch-rule-edge.tsx`, `branch-rule-modal.tsx`, `branch-rule-icon.tsx`, `missing-branch-rules-warning.tsx`, `flow-canvas-viewport.tsx`, `lib/canvas/rf-adapters.ts`, `lib/canvas/canvas-guidance.ts` (+ test), `app/(user)/flows/[id]/config/_content.tsx`, `server/routers/flow.ts`, `lib/container.ts`, `lib/chat/confirm-step.ts`, `lib/scheduler/scheduled-session-fire-handler.ts`, `app/api/chat/[sessionId]/stream/route.ts`, `execute-turn.ts` |

## Migration

`0043_organic_vengeance.sql` — `ALTER TABLE "app_flow_edges" ADD COLUMN "config"
jsonb DEFAULT '{}'::jsonb NOT NULL`. Additive with a default, so existing rows
backfill to `{}`; declared `-- data-impact: preserved`. (The safety test only
requires a declaration for row-affecting statements; this one carries it anyway
because the phase doc committed to it and it tells a reviewer what happens to
existing edges.)

## Tests

- `branch-rule.test.ts` — read/write helpers and descriptor precedence, including
  blank rules, the `__TEMPLATE_COMPLETE__` sentinel, and a missing destination.
- `flow-version.test.ts` — config through the snapshot round trip, plus a legacy
  snapshot edge with no `config` key.
- `set-flow-edge-branch-rule.test.ts` — set, trim, clear, preserve unrelated keys.
- `flow-session-graph.test.ts` — the prompt states a rule as a condition and a
  purpose as a description, and stays well-formed with neither.
- `canvas-guidance.test.ts` — `isForkedEdge` and `findForksMissingBranchRule`.
- Full suites green: domain 638, application 910, adapters 639, web 804.

## Deviations from the approved summary

- `IFlowEdgeRepository` also gained `findById`. The use case merges the rule into
  whatever config the edge already carries, which needs a read first; the
  alternative was trusting a client-supplied config and racing other edits.
- The advisory's copy names the forking steps rather than counting connectors,
  matching `UnclaimedSignaturesWarning`. A count alone is not actionable.

## Known limitations

- Rules are free text, evaluated by the model. Nothing validates that a fork's
  rules are mutually exclusive or collectively exhaustive.
- Publishing a flow with an un-ruled fork is still allowed — the warning is
  advisory, like the disconnected-steps one.
- Existing flows are not migrated: no destination metadata is copied into a rule.
