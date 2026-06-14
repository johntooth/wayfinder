# Phase — Cost / Usage Governance

- **Status**: To be implemented
- **Target version**: 1.47.0 (bump: **MINOR** — new table, additive columns, new
  domain ports, new adapter; no breaking change)
- **PRD**: `docs/development/prd/cost-usage-governance.prd.md`
- **ADR**: `docs/development/adr/026-usage-governance-enforcement.adr.md`
- **Depends on**: existing usage tracking (`ai_usage_events`,
  `UsageTrackingAdapter`), flows/sessions, `core_audit_log`, RBAC (ADR-021),
  and the admin overview dashboard.

## 1. Goal

Record LLM spend by **user, flow, session, and team**, let an admin set optional
**budgets** per flow and per team (USD, `per_run` or `monthly`, off by default),
**warn then block** when spend crosses the threshold/limit, and visualise spend +
budget utilisation in a new admin governance dashboard.

## 2. Approach

Hexagonal, decorator-based (mirrors the existing usage-tracking decorator):

1. Thread `flowId` / `sessionId` / `team` through the `ILanguageModel` call
   inputs so both recording and enforcement have scope.
2. `UsageTrackingAdapter` records the new fields; a new
   `QuotaEnforcingLanguageModel` decorator — ordered **outside** usage tracking —
   checks enabled budgets before each call and blocks with `QUOTA_EXCEEDED`.
3. Budget evaluation (`evaluateBudget`) is pure domain; current-period spend is
   summed on the fly from `ai_usage_events`.
4. A blocked call pauses the session with a clear message; admins manage budgets
   and watch spend on a new dashboard.

See ADR-026 for enforcement point, decorator order, and the spend-computation
decision.

## 3. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/budget.ts` | New `Budget` + pure `evaluateBudget(budget, spendUsd)`. |
| domain | `packages/domain/src/ports/budget-repository.ts` | New `IBudgetRepository` (`create`, `update`, `delete`, `findById`, `list`, `findEnabledForFlowAndTeam`). |
| domain | `packages/domain/src/entities/usage-event.ts` | Add `flowId`, `sessionId`, `team` to `UsageEvent` / `NewUsageEvent`. |
| domain | `packages/domain/src/ports/usage-repository.ts` | Extend `UsageFilter` (`flowId`, `sessionId`, `team`, `since`, `until`); add `summarizeBy(dimension)` for dashboard grouping. |
| domain | `packages/domain/src/ports/language-model.ts` | Add optional `flowId`, `sessionId`, `team` to the three call-input types. |
| domain | `packages/domain/src/result.ts` (error codes) | Add `QUOTA_EXCEEDED` to the `DomainError` code union. |
| application | `packages/application/src/use-cases/governance/get-governance-dashboard.ts` | Spend by flow/team over a period + budget utilisation. |
| application | `packages/application/src/use-cases/governance/{create,update,delete,list}-budget.ts` | Admin budget CRUD. |
| adapters | `packages/adapters/src/observability/quota-enforcing-adapter.ts` | New decorator + `withQuotaEnforcement` factory. |
| adapters | `packages/adapters/src/observability/usage-tracking-adapter.ts` | Record `flowId` / `sessionId` / `team`. |
| adapters | `packages/adapters/src/repositories/drizzle-budget-repository.ts` | Implements `IBudgetRepository`. |
| adapters | `packages/adapters/src/repositories/drizzle-usage-repository.ts` | Honour new filters; aggregate by flow/team/period. |
| adapters | `packages/adapters/src/db/schema/ai.ts` | Add `flow_id`, `session_id`, `team` + indexes to `ai_usage_events`. |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | New `app_usage_budgets` table. |
| adapters | `packages/adapters/drizzle/<next>.sql` | Migration: alter `ai_usage_events`, create `app_usage_budgets` + indexes. |
| adapters | agent graph `packages/adapters/src/agents/flow-session-graph.ts` | Pass `flowId` / `sessionId` / `team` into every model call. |
| apps/web | `apps/web/src/server/routers/governance.ts` | New admin router: `spendByFlow`, `spendByTeam`, `utilisation`, `budgets.{list,create,update,delete}`. |
| apps/web | `apps/web/src/server/router.ts` | Register `governance` router. |
| apps/web | `apps/web/src/app/(admin)/admin/dashboards/governance/{page.tsx,_content.tsx}` | New Recharts dashboard (spend by flow/team, utilisation, overruns). |
| apps/web | `apps/web/src/app/(admin)/admin/page.tsx` | Link/card to the governance dashboard. |
| apps/web | `apps/web/src/lib/container.ts` | Wire `withQuotaEnforcement(withUsageTracking(provider))`, budget repo, governance use-cases. |
| apps/web | session call paths (`run-turn`, `run-auto-node`) | Surface `QUOTA_EXCEEDED` → pause session with a clear message. |

## 4. Database changes

### Alter `ai_usage_events`

| Column | Type | Notes |
|--------|------|-------|
| `flow_id` | uuid FK → `app_flows` (`on delete set null`) | nullable |
| `session_id` | uuid | nullable |
| `team` | text | nullable |

Indexes: `(flow_id, created_at)`, `(team, created_at)`, `(session_id)`.

### New table `app_usage_budgets`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `scope` | text | `flow` \| `team` |
| `scope_ref` | text | flow id or team name |
| `period` | text | `per_run` \| `monthly` |
| `limit_usd` | real | |
| `warn_threshold_pct` | smallint | default 80 |
| `enabled` | boolean | default false |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Unique index on `(scope, scope_ref, period)`.

## 5. Environment variables

None. Budgets are data (DB-configured via the admin UI), not env config.

## 6. Implementation order (tests first)

1. **Domain**: `evaluateBudget` test → `budget.ts`; add `QUOTA_EXCEEDED` code;
   extend `UsageEvent`, `UsageFilter`, and `ILanguageModel` inputs.
2. **Schema + migration**: alter `ai_usage_events`, create `app_usage_budgets`.
3. **Budget repo**: `drizzle-budget-repository.test.ts` → adapter.
4. **Usage repo**: extend filter/aggregation tests → repo changes.
5. **Recording**: update `UsageTrackingAdapter` (record new fields) + test.
6. **Enforcement**: `quota-enforcing-adapter.test.ts` (off-by-default pass-through,
   warn, block, flow-vs-team stricter-wins, per_run vs monthly windows) →
   adapter + `withQuotaEnforcement`.
7. **Use-cases**: governance dashboard + budget CRUD tests → use-cases.
8. **Wiring**: container decorator order; thread context in the agent graph;
   `governance` router; register in root router.
9. **UI**: governance dashboard page + budget management; admin hub link.
10. **Session pause**: surface `QUOTA_EXCEEDED` in `run-turn` / `run-auto-node`.

Write the test file before each implementation file (CLAUDE.md rule). Run
`./validate.sh` and fix all failures before declaring done.

## 7. ADR required

ADR-026 (written) — enforcement decorator on `ILanguageModel`, decorator order,
context threading, on-the-fly spend computation, warn-then-block, off-by-default,
and the `QUOTA_EXCEEDED` → session-pause contract.

## 8. Risks / open questions

Carried from PRD §12 and ADR-026: context threading coverage, on-the-fly spend
query cost (counter table is the follow-up), last-call overshoot, streaming check
timing, team-string drift, blocked-session UX, decorator order, `budget.warn`
audit de-duplication, and the `monthly` calendar boundary (default UTC).

## 9. Acceptance criteria

Mirror PRD §10. At minimum:

- [ ] LLM calls record `flow_id` / `session_id` / `team` when known.
- [ ] No enabled budget ⇒ identical to today (recorded, never blocked, no spend
      query).
- [ ] Admin can CRUD + enable/disable flow and team budgets.
- [ ] Warn threshold flips status to `warn` + writes `budget.warn`; limit blocks
      the next call with `QUOTA_EXCEEDED`, pauses the session, writes
      `budget.blocked`; raising/disabling resumes.
- [ ] `per_run` sums by session; `monthly` sums since start of month; flow + team
      both apply with stricter-wins.
- [ ] Governance dashboard renders spend by flow/team + utilisation table.
- [ ] No framework import outside `packages/adapters`; `./validate.sh` passes;
      `VERSION` and `package.json#version` are `1.47.0` and match.
