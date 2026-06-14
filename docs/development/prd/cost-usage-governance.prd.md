# PRD — Cost / Usage Governance

> Adds per-flow and per-team (org-unit) token-spend **recording** and optional
> **budgets/quotas** with warn-then-block enforcement, plus an admin governance
> dashboard. Route to the Documentation Review skill before any code is written.

- **Status**: Draft
- **Date**: 2026-06-14
- **Author**: Solo / Claude Code
- **Target version**: 1.47.0 (bump: **MINOR** — new table, new domain ports, new
  adapter, additive columns; no breaking change. See `docs/guides/versioning.md`.)

## 1. Problem

Wayfinder already records every LLM call's tokens and USD cost in
`ai_usage_events`, and the admin overview dashboard visualises sessions and AI
confidence. But spend is recorded only by **user** and **conversation** — there
is no **flow** or **team** attribution, and there is no concept of a **budget**
or **quota** anywhere in the codebase. So the procurement question that sells
governance — *"how do we stop a runaway flow from spending $10k?"* — has no
answer today. An admin can see cost after the fact but cannot cap it, and cannot
say which flow or team is responsible.

## 2. Users / Personas

- **Admin / Operator** — sets optional budgets per flow and per team, watches a
  governance dashboard showing spend and budget utilisation, and trusts that an
  over-budget flow is automatically stopped rather than merely reported.
- **Flow Owner** — wants to know their flow's running cost and to be warned
  before it is throttled, so a legitimately expensive flow can have its limit
  raised rather than silently failing.
- **Procurement / Finance stakeholder** — needs the assurance (and the audit
  trail) that no single flow or team can run away with spend beyond a configured
  ceiling.

## 3. Goals

- Every LLM call is recorded with its originating **flow**, **session/run**, and
  **team**, in addition to the existing user/conversation attribution, so spend
  is attributable along all four dimensions.
- An admin can optionally set a **budget** scoped to a **flow** or a **team**,
  expressed in **USD**, over a **period** (`per_run` or `monthly`), with a
  configurable **warn threshold** (default 80%).
- **All quotas are OFF by default.** A scope with no enabled budget behaves
  exactly as today — recording only, no enforcement, no added latency path that
  blocks.
- When current-period spend for an enabled budget crosses the warn threshold, a
  warning is raised (audit event + admin-visible signal); when it reaches 100%
  of the limit, further LLM calls for that scope are **blocked** — the call
  returns a `QUOTA_EXCEEDED` `DomainError` and the session pauses with a clear
  message instead of continuing to spend.
- The admin governance dashboard visualises spend by flow and by team over a
  period, and shows each enabled budget's utilisation (ok / warn / blocked),
  building on the existing Recharts overview dashboard.
- Enforcement is provider-agnostic and lives behind the `ILanguageModel` port
  (a decorator), so it covers every call path uniformly.

## 4. Non-goals

- **No per-user budgets.** Limits are settable only at **flow** and **team**
  scope. (User attribution is still recorded for analytics.)
- **No currency other than USD.** Budgets reuse the existing `cost_usd`; AUD /
  FX conversion is explicitly out of scope (see §11).
- **No real-time hard guarantee to the cent.** Enforcement is checked
  before each call against recorded spend; a single in-flight call may push a
  scope slightly past its limit before the next call is blocked. Budgets are a
  governance ceiling, not a metered prepay wall.
- **No auto-raising or auto-purchasing of budget.** Raising a limit is a manual
  admin action.
- **No first-class Team entity.** "Team" remains the existing free-text
  `core_users.team` string; a team budget keys on that string value.
- **No billing, invoicing, or chargeback export** this round (listed in §11).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `Budget` (entity) | `packages/domain/src/entities/budget.ts` | new | `scope` (`flow` \| `team`), `scopeRef`, `period` (`per_run` \| `monthly`), `limitUsd`, `warnThresholdPct`, `enabled`. Plus a pure `evaluateBudget(budget, spendUsd)` → `{ status: 'ok' \| 'warn' \| 'blocked'; ratio }`. |
| `IBudgetRepository` (port) | `packages/domain/src/ports/budget-repository.ts` | new | `create`, `update`, `delete`, `findById`, `list`, `findEnabledForFlowAndTeam(flowId, team)`. |
| `UsageEvent` / `NewUsageEvent` | `packages/domain/src/entities/usage-event.ts` | existing → extend | Add `flowId`, `sessionId`, `team` (all nullable). |
| `UsageFilter` | `packages/domain/src/ports/usage-repository.ts` | existing → extend | Add `flowId`, `sessionId`, `team`, `since`, `until` so spend can be summed per scope per period; add `summarizeBy(dimension)` for dashboard grouping. |
| `ILanguageModel` call inputs | `packages/domain/src/ports/language-model.ts` | existing → extend | Add optional `flowId`, `sessionId`, `team` to `GenerateObjectInput` / `StreamTextInput` / `StreamObjectInput` (the call context). |
| `QuotaEnforcingLanguageModel` (adapter) | `packages/adapters/src/observability/quota-enforcing-adapter.ts` | new | Decorator wrapping `ILanguageModel`; checks enabled budgets before each call (mirrors `UsageTrackingAdapter`). |
| `DrizzleBudgetRepository` (adapter) | `packages/adapters/src/repositories/drizzle-budget-repository.ts` | new | Implements `IBudgetRepository` against `app_usage_budgets`. |
| `GetGovernanceDashboard` (use-case) | `packages/application/src/use-cases/governance/get-governance-dashboard.ts` | new | Spend by flow/team over a period + budget utilisation. |
| `Create/Update/Delete/ListBudgets` (use-cases) | `packages/application/src/use-cases/governance/*.ts` | new | Admin budget CRUD. |
| `ai_usage_events` | `packages/adapters/src/db/schema/ai.ts` | existing → extend | Add `flow_id`, `session_id`, `team` columns + indexes. |
| `app_usage_budgets` | `packages/adapters/src/db/schema/wayfinder.ts` | new | Budget config table. |
| `core_audit_log` | `packages/adapters/src/db/schema/core.ts` | existing | Reuse: write `budget.warn` / `budget.blocked` audit events. |

## 6. User stories

1. As an **admin**, I open the governance dashboard and see spend broken down by
   flow and by team over the last 30 days, and which flows cost the most.
2. As an **admin**, I set a $50 `per_run` budget on the "RFQ Drafting" flow and a
   $2,000 `monthly` budget on the "Procurement" team, each enabled, with an 80%
   warn threshold.
3. As an **admin**, when the "RFQ Drafting" flow's current run reaches $40 spend,
   I see it flip to **warn** on the dashboard and a `budget.warn` audit event is
   written.
4. As an **admin**, when that run reaches $50, the next LLM call is **blocked**,
   the session pauses with a clear message, and a `budget.blocked` audit event is
   recorded; raising the limit lets the user resume.
5. As a **flow owner**, I can see my flow's running cost so I can request a higher
   limit before it is throttled.
6. As an **admin**, a flow or team with **no enabled budget** behaves exactly as
   today — fully recorded, never blocked.

## 7. Pages / surfaces affected

- **`/admin/dashboards/governance`** (new) — spend-by-flow and spend-by-team
  charts, budget utilisation table (ok / warn / blocked), spend-over-time, and
  overrun highlights. Built with Recharts, mirroring
  `admin/dashboards/overview/_content.tsx`.
- **`/admin`** hub — add a link/card to the governance dashboard.
- **Budget management** — a CRUD surface (within the governance page or
  `/admin/governance/budgets`) to create/enable/disable budgets per flow/team.
- **tRPC** — new `governance` router (admin-only): `spendByFlow`, `spendByTeam`,
  `utilisation`, and `budgets.{list,create,update,delete}`.
- **Agent / session call paths** — `run-turn`, `run-auto-node`, and the agent
  graph (`flow-session-graph.ts`) must pass `flowId` / `sessionId` / `team` into
  every `ILanguageModel` call so recording and enforcement have context.
- **Session pause path** — when a call returns `QUOTA_EXCEEDED`, the calling
  use-case surfaces a system message and pauses the session rather than failing
  hard.
- **Wiring** — `apps/web/src/lib/container.ts` wraps the model as
  `withQuotaEnforcement(withUsageTracking(provider))` and injects the budget
  repository + governance use-cases.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `ai_usage_events` | ADD `flow_id uuid` (nullable, FK → `app_flows`, `on delete set null`), `session_id uuid` (nullable), `team text` (nullable). Indexes on `(flow_id, created_at)`, `(team, created_at)`, `(session_id)`. | n/a (existing `ai_`) |
| `app_usage_budgets` | NEW — `id` uuid PK, `scope text` (`flow` \| `team`), `scope_ref text` (flow id or team name), `period text` (`per_run` \| `monthly`), `limit_usd real`, `warn_threshold_pct smallint default 80`, `enabled boolean default false`, `created_at`, `updated_at`. Unique index on `(scope, scope_ref, period)`. | yes (`app_`) |

Columns are snake_case; `id` / `created_at` / `updated_at` present per
convention. Cross-schema FK from `ai_usage_events.flow_id` to `app_flows.id` is
acceptable (single Postgres database). Current-period spend is computed on the
fly by summing `ai_usage_events.cost_usd` over the scope + period window (no
separate counter table in v1 — see §12).

## 9. Architectural decisions

### Existing ADRs assumed

- **ADR-001 Hexagonal Architecture** — `IBudgetRepository` is a domain port;
  enforcement is an adapter-layer decorator on the existing `ILanguageModel`
  port. Budget evaluation logic (`evaluateBudget`) is pure domain.
- **ADR-003 Monorepo Structure** — wiring lives in `apps/web/src/lib/container.ts`.
- **ADR-021 RBAC** — governance routes are admin-only (`adminProcedure`).

### New ADR introduced by this PRD

- **ADR-026 Usage Governance Enforcement** — enforcement point (a decorator on
  `ILanguageModel`, ordered outermost so it blocks before the inner
  usage-tracking + provider run), how flow/session/team context is threaded
  through the port, on-the-fly period-spend computation vs a counter table, the
  warn-then-block model, opt-in/off-by-default semantics, and the
  `QUOTA_EXCEEDED` → session-pause contract.

## 10. Acceptance criteria

- [ ] Every LLM call writes an `ai_usage_events` row carrying `flow_id`,
      `session_id`, and `team` whenever those are known.
- [ ] With **no enabled budget**, behaviour is identical to today: calls are
      recorded and never blocked.
- [ ] An admin can create, enable, disable, edit, and delete a budget scoped to a
      flow or a team via the `governance.budgets` tRPC procedures.
- [ ] When current-period spend for an enabled budget reaches the warn threshold,
      `evaluateBudget` returns `warn`, the dashboard shows `warn`, and a
      `budget.warn` audit event is written.
- [ ] When current-period spend reaches the limit, the next LLM call for that
      scope returns `QUOTA_EXCEEDED`, the session pauses with a clear message, and
      a `budget.blocked` audit event is written. Raising/disabling the budget lets
      the session resume.
- [ ] `per_run` budgets sum spend for the active `session_id`; `monthly` budgets
      sum spend for the flow/team since the start of the current calendar month.
- [ ] Both a flow budget and a team budget can apply to one call; the **stricter**
      (first to block) wins.
- [ ] The governance dashboard renders spend by flow and by team over a selected
      period and a utilisation table with ok / warn / blocked status.
- [ ] No AI SDK / framework import is added outside `packages/adapters`; budget
      evaluation has no external deps (ESLint boundary check passes).
- [ ] `./validate.sh` passes; `VERSION` and root `package.json#version` are
      `1.47.0` and match.

## 11. Out of scope / future work

- **Per-user budgets** and budgets at session/run scope set independently of a
  flow.
- **AUD / multi-currency** budgets and a configurable FX rate.
- **First-class Team entity** (a `core_teams` table) replacing the free-text
  `core_users.team`.
- **Chargeback / billing export** (CSV / finance integration) of spend by
  flow/team.
- **Budget-approaching email notifications** (reusing the v1.35 notification
  outbox) — this round raises audit events + dashboard signals only.
- **Pre-call cost estimation / token pre-flight** to block a call *before* it
  starts based on predicted cost (this PRD blocks based on already-recorded
  spend).
- **A materialised per-period spend counter** for high call volumes.

## 12. Risks / open questions

- **Context threading.** Recording and enforcement both depend on `flowId` /
  `sessionId` / `team` reaching the `ILanguageModel` call. Every call site
  (agent graph, auto-nodes, ad-hoc calls) must pass them; calls that don't will
  record nulls and be un-enforced. **Mitigation:** thread context where sessions
  exist; treat missing context as "no scope, not enforced" and audit it.
- **On-the-fly spend query cost.** Each enforced call sums `ai_usage_events` for
  the scope/period. Indexed on `(flow_id, created_at)` / `(team, created_at)`;
  acceptable at current volume. A counter table is the optimisation if needed
  (§11). **Off-by-default means zero query when no budget exists** — short-circuit
  if `findEnabledForFlowAndTeam` returns nothing.
- **Last-call overshoot.** Spend is checked before a call; the call that crosses
  the limit still completes, so a scope can land slightly over. Documented as
  intended (governance ceiling, not metered prepay).
- **Streaming cost timing.** Streamed calls only know final token usage after the
  stream ends, so a long stream is checked at start, not mid-stream. Acceptable
  for v1; noted for the counter-table follow-up.
- **Team string drift.** Team budgets key on the free-text `core_users.team`;
  renaming a team orphans its budget. Acceptable until a Team entity exists.
- **Blocked-session UX.** A paused session must clearly tell the user *why*
  ("usage budget reached — contact an administrator") and not look like a crash.
- **Decorator order.** Quota enforcement must wrap *outside* usage tracking so it
  can short-circuit before the provider call; getting the order wrong would
  record usage for a call that should have been blocked. Locked in ADR-026.
