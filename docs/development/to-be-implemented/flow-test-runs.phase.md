# Phase — Flow Test Runs (Preview & Seeded Step Test)

- **Status**: Draft — awaiting `/doc-review`
- **Target version**: **TBC** — **MINOR** (new feature + additive
  `app_sessions.mode` column + one new `app_` table). The number is allocated at
  `/doc-review` against whichever line the build is scheduled on.
- **Base branch**: **TBC.** `CLAUDE.md` routes new features to `main`; these docs
  were authored on `release/alpha-2` at the requester's direction. Settle the
  line before building, and set the version and the `implemented/<line>/`
  destination from it.
- **PRD**: `docs/development/prd/flow-test-runs.prd.md`
- **ADR**: `docs/development/adr/048-flow-test-sessions-and-seeded-context.adr.md`
- **Depends on**: ADR-006 (flow/session schema), ADR-007 (session-scoped
  LangGraph), ADR-015 (versioning — the published/draft split), ADR-026
  (operator-confirmed completion), ADR-018 (approver resolution — overridden
  under test), `ai_usage_events` (per-call cost, already recorded)

## 1. Problem

`StartSession` refuses anything unpublished
(`packages/application/src/use-cases/session/start-session.ts:31`), so the only
way to exercise a flow is to publish it to real operators. Testing one step is
not merely awkward but impossible: a step's prompt is built from
`gatheredContext`, which `GetSessionForTurn` aggregates across the session's
prior assistant turns (`get-session-for-turn.ts:77`), so a mid-flow step has no
behaviour until every step before it has been played through by hand.

See the PRD for full detail.

## 2. Goals

- Run an **unpublished draft** end to end from the canvas, in a modal, without
  publishing and without leaving the screen.
- Run **one step** with prior-step data simulated, seeing the reply, the
  readiness-gate outcome and any generated document.
- Seed from a **cloned real session**, a **saved hand-edited fixture**, or an
  **AI-generated** proposal.
- Report per-step cost, tokens, latency, turns to advance, confidence trajectory
  and gate outcome.
- Test sessions are invisible to every production listing, dashboard and
  approver queue.

## 3. Non-goals

Assertions / pass-fail automation, CI or scheduled runs, concurrent test sessions
on one flow, run diffing, mocked-model determinism, extraction-flow testing.
(PRD §4.)

## 4. Approach

Per ADR-048. A test run is an **ordinary session** carrying `mode = "test"`; the
seed is **materialised as ordinary rows** (synthetic assistant messages carrying
`GatheredContextItem[]`, plus `app_session_step_outputs` rows) before the first
turn. `run-turn`, `evaluate-step-readiness`, `buildSystemPrompt` and the stream
route are therefore **unchanged** — they read a session that looks like one that
genuinely reached node N.

A whole-flow run is the same mechanism started at the root with an empty seed.

Build strictly bottom-up (domain → application → adapters → web), writing the
test file before each implementation file (`CLAUDE.md`).

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/session.ts` | add `SessionMode = "live" \| "test"`; `mode` on `Session` and `NewSession` (optional; absent reads `"live"`) |
| domain | `packages/domain/src/entities/flow-test-fixture.ts` | new — `FlowTestFixture`, `NewFlowTestFixture`, `TestSeedSource`, `SeedStepOutput` |
| domain | `packages/domain/src/entities/flow-test-report.ts` | new — `FlowTestStepReport`, `FlowTestRunReport` |
| domain | `packages/domain/src/entities/flow-test-seed.ts` | new — `validateSeedAgainstNodes(seed, nodes)`: pure, returns accepted items + rejects with reasons |
| domain | `packages/domain/src/ports/seed-proposer.ts` | new — `ISeedProposer.propose(...) -> Result<SeedProposal>` |
| domain | `packages/domain/src/ports/flow-test-fixture-repository.ts` | new — `listByFlow`, `findById`, `create`, `update`, `delete` |
| domain | `packages/domain/src/ports/session-repository.ts` | add `mode` filter to `SessionListPageOptions`; document the default as `"live"` |
| application | `packages/application/src/use-cases/session/start-session.ts` | accept `mode`, `startNodeId?`; when `mode === "test"` skip the published guard, resolve from **live rows**, set `flowVersionId: null` |
| application | `packages/application/src/use-cases/flow-test/start-test-run.ts` | new — authorise (owner/admin), start the session, materialise the seed, return the session |
| application | `packages/application/src/use-cases/flow-test/build-seed-from-session.ts` | new — clone gathered context + step outputs from a real session up to a node |
| application | `packages/application/src/use-cases/flow-test/generate-seed.ts` | new — `ISeedProposer` + `validateSeedAgainstNodes`; reports rejects, never substitutes silently |
| application | `packages/application/src/use-cases/flow-test/get-test-run-report.ts` | new — assemble `FlowTestRunReport` from sessions, messages, step outputs, `ai_usage_events` |
| application | `packages/application/src/use-cases/flow-test/delete-test-session.ts` | new — author-scoped delete; refuses a `live` session outright |
| application | `packages/application/src/use-cases/flow-test/sweep-test-sessions.ts` | new — retention sweep (default 30 days), driven by the existing scheduler (ADR-019) |
| application | `packages/application/src/use-cases/approval/*` (resolution path) | under `mode === "test"`, resolve the approver to the initiating author |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | `app_sessions`: `mode text not null default 'live'` + index on `(mode)`; new `app_flow_test_fixtures` |
| adapters | `packages/adapters/drizzle/<next>.sql` | migration, `-- data-impact: preserved` |
| adapters | `packages/adapters/src/repositories/drizzle-session-repository.ts` | map `mode`; apply the `mode` predicate on `listByUser`, `listAll`, `listByUserPage`, `listAllPage` |
| adapters | `packages/adapters/src/repositories/drizzle-analytics-repository.ts` | exclude `mode = 'test'` from every session-touching aggregate |
| adapters | `packages/adapters/src/repositories/drizzle-approval-repository.ts` | exclude test sessions from approver queues |
| adapters | `packages/adapters/src/repositories/drizzle-schedule-run-repository.ts` | exclude test sessions from scheduled-run selection |
| adapters | `packages/adapters/src/repositories/drizzle-flow-test-fixture-repository.ts` | new |
| adapters | `packages/adapters/src/ai/ai-seed-proposer.ts` | new — `generateObject`, temp 0, `purpose: "test-seed"`, output sanitised to the declared fields |
| web | `apps/web/src/server/routers/flow-test.ts` | new — `start`, `report`, `delete`, `listSeedableSessions`, `generateSeed`, `fixture.{list,create,update,delete}` |
| web | `apps/web/src/components/canvas/flow-test-modal.tsx` | new — near-full-screen modal, two panes |
| web | `apps/web/src/components/canvas/flow-test-seed-editor.tsx` | new — seed source picker + editable values |
| web | `apps/web/src/components/canvas/flow-test-step-report.tsx` | new — per-step metrics pane |
| web | `apps/web/src/components/canvas/*` (toolbar, node menu) | **Test** actions; node menu opens the modal pre-scoped to that step |
| web | `apps/web/src/lib/container.ts` | wire `ISeedProposer`, the fixture repository and the new use-cases |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — types and the pure seed validator.** Add `SessionMode` and `mode`;
   add the fixture, report and seed entities. Write
   `flow-test-seed.test.ts` **first**: (a) a seed whose values match each prior
   node's `TemplateField` types validates; (b) a value violating a field type is
   returned as a reject with a reason, not dropped; (c) a seed referencing a node
   absent from the draft is rejected; (d) an empty seed is valid (whole-flow
   run). Then implement. Domain stays dependency-free.

2. **Application — start a test run.** Write `start-session.test.ts` cases
   first: (a) `mode: "test"` on a `draft` flow succeeds; (b) `mode: "live"` on a
   draft still fails `VALIDATION_FAILED` (unchanged); (c) a test run resolves
   nodes/edges from the **live rows** and sets `flowVersionId: null`, even when a
   published version exists; (d) `startNodeId` sets `currentNodeId` to that node;
   (e) a caller without edit rights on the flow gets `FORBIDDEN`. Then implement.

3. **Application — materialise the seed.** Write `start-test-run.test.ts`
   first: (a) the seed writes assistant messages whose gathered-context items
   round-trip through `aggregateGatheredContext` **with no change to that query**;
   (b) step-output rows are created for each seeded prior node in the existing
   `StepOutputField[]` shape; (c) rejects from `validateSeedAgainstNodes` are
   returned and their values are not written; (d) an empty seed writes nothing.
   Then implement.

4. **Application — clone and generate.** `build-seed-from-session.test.ts`:
   copies gathered context and step outputs up to the chosen node, and copies
   **nothing else** (no documents, approvals or messages beyond the synthesised
   context). `generate-seed.test.ts`: proposer output is validated before it is
   offered, invalid values are reported, a proposer error degrades to an empty
   seed via Result rather than a throw.

5. **Adapters — schema, migration, mapping.** Add `mode` + its index and
   `app_flow_test_fixtures`; generate the migration with
   `-- data-impact: preserved`. Repository test asserts `mode` round-trips and
   that pre-existing rows read back as `"live"`.

6. **Adapters — the isolation predicate.** This is the phase's principal risk;
   cover it exhaustively. Apply `mode = 'live'` in **four** repositories and
   write a test per read path:
   - `drizzle-session-repository`: `listByUser`, `listAll`, `listByUserPage`,
     `listAllPage`
   - `drizzle-analytics-repository`: every session-touching aggregate
   - `drizzle-approval-repository`: approver queue reads
   - `drizzle-schedule-run-repository`: scheduled-run selection

   Each test seeds one `live` and one `test` session and asserts only the live
   one is returned. `findById` deliberately keeps returning test sessions — the
   modal needs it — so authorisation, not the predicate, guards that path.

7. **Adapters — seed proposer.** `ai-seed-proposer.test.ts`: output is
   constrained to the declared field keys, invented keys are dropped, temp 0 and
   the Langfuse purpose are set, a provider failure returns
   `AI_PROVIDER_FAILED` as a Result.

8. **Application — approvals under test.** Test first: an approval node reached
   in a `mode = "test"` session resolves the approver to the initiating author,
   and no approval row appears in any real supervisor's queue. Then implement.

9. **Application — report, delete, sweep.** `get-test-run-report.test.ts`
   asserts per-step cost/tokens/latency/turns/confidence/gate outcome assembled
   from `ai_usage_events` and session rows. `delete-test-session.test.ts`
   asserts a `live` session can never be deleted through this path. Wire the
   sweep to the existing scheduler.

10. **Web — tRPC.** Add `flowTest.*`, all author-gated. Router tests cover the
    authorisation boundary on every procedure.

11. **Web — UI.** The modal at approximately `max-w-[92vw] h-[88vh]` (against
    `max-w-3xl` for `NodeConfigModal`, `node-config-modal.tsx:464`): left pane
    run setup (scope, seed source, editable values), right pane the live
    transcript under a persistent **TEST** banner plus the step report. Canvas
    toolbar and node-menu actions. Closing returns to the canvas with position
    intact.

12. **Version + validate.** Set `VERSION` and root `package.json#version` to the
    number allocated at `/doc-review`. Run `./validate.sh`; fix all failures.
    Move this doc to `docs/development/implemented/<line>/v<version>/` with an
    implementation summary.

## 7. Acceptance criteria

Mirror PRD §10. In particular:

- [ ] A draft flow can be test-run by its owner or an admin; nobody can start a
      *live* session on it.
- [ ] A test run resolves from the live rows, not `latestPublished`.
- [ ] The seed round-trips through `aggregateGatheredContext` with that query
      unchanged, and renders in `<gathered_context>`.
- [ ] `run-turn`, `evaluate-step-readiness`, `buildSystemPrompt` and the stream
      route are unchanged — verified against the diff, not merely asserted.
- [ ] Seeds can be cloned, hand-edited and saved as a fixture, and re-run to
      produce a second run against identical inputs.
- [ ] A generated seed's invalid values are reported, never silently substituted.
- [ ] A document step under test produces a downloadable file from seeded values.
- [ ] Per-step cost, tokens, latency, turns, confidence and gate outcome are
      reported.
- [ ] Test sessions are excluded from all four repositories' read paths, with a
      test per path.
- [ ] An approval under test resolves to the author; the modal says so.
- [ ] Test sessions delete on demand and sweep after the retention window; test
      spend is attributed and not exempt from budgets.
- [ ] The modal never navigates away from the canvas.
- [ ] `domain` dependency-free; ports in domain; Result at every boundary;
      `VERSION` = `package.json#version`; `./validate.sh` passes.

## 8. Risks / open questions

Carried from PRD §12:

- **Isolation is the principal risk.** A missed read path leaks an author's
  experiments into a customer's reporting. Step 6 enumerates the four
  repositories; any new session read path added during the build must be added
  there too.
- **Approval divergence** is deliberate and is the one behaviour a test does not
  reproduce faithfully. Open: simulate a decision without creating an approval
  row at all.
- **Cloned seeds carry real data** into a persisted fixture — redact on clone,
  warn at save, or scope fixture visibility to the author. Unresolved.
- **Generated seeds can mislead** when a value violates a constraint; mitigated
  by validating before materialising.
- **Cost**: test runs spend real tokens. Open — whether test spend needs its own
  budget scope (ADR-031).
- **Retention default** of 30 days is proposed against a product with no
  retention policy anywhere else; confirm.
- **Modal vs. route**: a modal keeps the author on the canvas as required, but a
  run cannot be deep-linked or shared. Accepted for this version.

## 9. Approved change summary

Recorded per the `/new-feature` lifecycle; approved 2026-08-11.

**Headline.** An author can run a draft flow — or a single step of it — from a
near-full-screen modal on the canvas, without publishing and without leaving the
screen. Prior-step data is simulated three ways: cloned from a real session,
hand-edited as a saved fixture, or AI-generated from the prior nodes' declared
fields. The seed materialises as ordinary rows, so the runner needs no changes at
all — a test session simply looks like a real one. It carries `mode = "test"`, is
excluded from every production listing and dashboard, and reports per-step cost,
latency, turns-to-advance and gate outcomes back into the modal.

- **Goal** — authors prove a flow works before publishing; today the only route
  is publish-and-run, and a mid-flow step cannot be exercised at all.
- **Business rules** — test runs pin to live rows, not the published snapshot;
  the published-only guard is bypassed for `mode = "test"` and edit rights only;
  test sessions never appear in production surfaces; approvals resolve to the
  author; sessions are disposable and swept.
- **UI** — near-full-screen modal over the canvas; left pane run setup, right
  pane live transcript plus step report.
- **Data** — `SessionMode`, `FlowTestFixture`, `TestSeedSource`,
  `FlowTestStepReport`, `ISeedProposer`.
- **Database** — additive `app_sessions.mode` (+ index) and one new `app_` table;
  no change to messages or step outputs.
- **Risks** — the `mode = 'live'` predicate must reach every read path;
  approval divergence; cloned seeds carrying real data; generated seeds
  misleading; real token spend.
- **Out of scope** — assertions, CI runs, concurrency, run diffing, replaying a
  live session against a modified draft.
