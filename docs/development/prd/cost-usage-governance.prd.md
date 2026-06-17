# PRD — Cost / Usage Governance

> Adds per-**user** token-spend **caps** — a configurable USD limit over a
> **daily**, **weekly**, or **monthly** period, **off by default** — with
> warn-then-block enforcement, plus an admin governance dashboard that shows
> spend by user and by flow. Flow/session attribution is recorded for dashboard
> analytics only; the budget key is the user. Route to the Documentation Review
> skill before any code is written.

- **Status**: Draft
- **Date**: 2026-06-14 (revised 2026-06-17: simplified from per-flow / per-team
  budgets with on-demand org-structure resolution to **per-user cost caps** over
  daily / weekly / monthly periods. Flow + session attribution is retained for
  **dashboard analytics only**, not as a budget key; the org-tier "team" model,
  the `IOrgStructure` port, the Entra/HR resolvers, and the team level dropdown
  are dropped.)
- **Author**: Solo / Claude Code
- **Target version**: 1.48.0 (bump: **MINOR** — new table, additive columns, new
  domain port, new adapter; no breaking change. Repo is at 1.47.5, so the next
  MINOR is 1.48.0. See `docs/guides/versioning.md`.)

## 1. Problem

Wayfinder already records every LLM call's tokens and USD cost in
`ai_usage_events`, and the admin overview dashboard visualises sessions and AI
confidence. But spend is recorded only by **user** and **conversation**, and
there is no concept of a **budget** or **cap** anywhere in the codebase. So the
governance question that sells the feature — *"how do we stop one user from
running up $10k of spend?"* — has no answer today. An admin can see cost after
the fact but cannot cap it.

## 2. Users / Personas

- **Admin / Operator** — sets an optional spend cap per user, watches a
  governance dashboard showing spend by user and by flow plus cap utilisation,
  and trusts that an over-budget user is automatically stopped rather than merely
  reported.
- **End user** — wants to know when they are approaching their cap and be warned
  before being blocked, so a legitimately heavy user can have their limit raised
  rather than silently failing mid-task.
- **Procurement / Finance stakeholder** — needs the assurance (and the audit
  trail) that no single user can run away with spend beyond a configured ceiling.

## 3. Goals

- Every LLM call is recorded with its originating **flow** and **session/run**,
  in addition to the existing user/conversation attribution, so spend can be
  visualised by flow on the dashboard. (Flow/session are **analytics only** —
  they are not a budget key.)
- An admin can optionally set a **cap** scoped to a **user**, expressed in
  **USD**, over a **period** (`daily`, `weekly`, or `monthly`), with a
  configurable **warn threshold** (default 80%). A user may have at most one cap
  per period (so up to three: a daily, a weekly, and a monthly cap).
- **All caps are OFF by default.** A user with no enabled cap behaves exactly as
  today — recording only, no enforcement, no added latency path that blocks.
- When a user's current-period spend for an enabled cap crosses the warn
  threshold, a warning is raised (audit event + admin-visible signal); when it
  reaches 100% of the limit, further LLM calls for that user are **blocked** —
  the call returns a `QUOTA_EXCEEDED` `DomainError` and the session pauses with a
  clear message instead of continuing to spend.
- The admin governance dashboard visualises spend by user and by flow over a
  period, and shows each enabled cap's utilisation (ok / warn / blocked),
  building on the existing Recharts overview dashboard.
- Enforcement is provider-agnostic and lives behind the `ILanguageModel` port
  (a decorator), so it covers every call path uniformly.

## 4. Non-goals

- **No per-flow or per-team budgets.** Caps are settable only at **user** scope.
  Flow attribution is still recorded for dashboard analytics, but it is not a
  budget key, and there is no team/org-unit concept.
- **No org-structure resolution.** No Entra/HR manager-chain walk, no
  `IOrgStructure` port, no team level dropdown, no org-tier roll-up. (Removed
  from the earlier revision of this PRD.)
- **No currency other than USD.** Caps reuse the existing `cost_usd`; AUD / FX
  conversion is explicitly out of scope (see §11).
- **No real-time hard guarantee to the cent.** Enforcement is checked before each
  call against recorded spend; a single in-flight call may push a user slightly
  past their limit before the next call is blocked. Caps are a governance
  ceiling, not a metered prepay wall.
- **No auto-raising or auto-purchasing of a cap.** Raising a limit is a manual
  admin action.
- **No billing, invoicing, or chargeback export** this round (listed in §11).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `Budget` (entity) | `packages/domain/src/entities/budget.ts` | new | `userId`, `period` (`daily` \| `weekly` \| `monthly`), `limitUsd`, `warnThresholdPct`, `enabled`. Plus a pure `evaluateBudget(budget, spendUsd)` → `{ status: 'ok' \| 'warn' \| 'blocked'; ratio }`. |
| `IBudgetRepository` (port) | `packages/domain/src/ports/budget-repository.ts` | new | `create`, `update`, `delete`, `findById`, `list`, `findEnabledForUser(userId)` — returns the user's enabled caps (zero to three) so every applicable period is checked. |
| `UsageEvent` / `NewUsageEvent` | `packages/domain/src/entities/usage-event.ts` | existing → extend | Add `flowId`, `sessionId` (both nullable). |
| `UsageFilter` | `packages/domain/src/ports/usage-repository.ts` | existing → extend | Add `userId`, `flowId`, `sessionId`, `since`, `until` so spend can be summed per user per period; add `summarizeBy(dimension)` (`user` \| `flow`) for dashboard grouping. |
| `ILanguageModel` call inputs | `packages/domain/src/ports/language-model.ts` | existing → extend | Add optional `flowId`, `sessionId` to `GenerateObjectInput` / `StreamTextInput` / `StreamObjectInput`. `userId` already exists and is the enforcement key. |
| `QuotaEnforcingLanguageModel` (adapter) | `packages/adapters/src/observability/quota-enforcing-adapter.ts` | new | Decorator wrapping `ILanguageModel`; checks the acting user's enabled caps before each call (mirrors `UsageTrackingAdapter`). |
| `DrizzleBudgetRepository` (adapter) | `packages/adapters/src/repositories/drizzle-budget-repository.ts` | new | Implements `IBudgetRepository` against `app_usage_budgets`. |
| `GetGovernanceDashboard` (use-case) | `packages/application/src/use-cases/governance/get-governance-dashboard.ts` | new | Spend by user/flow over a period + cap utilisation. |
| `Create/Update/Delete/ListBudgets` (use-cases) | `packages/application/src/use-cases/governance/*.ts` | new | Admin cap CRUD. |
| `ai_usage_events` | `packages/adapters/src/db/schema/ai.ts` | existing → extend | Add `flow_id`, `session_id` columns + indexes. |
| `app_usage_budgets` | `packages/adapters/src/db/schema/wayfinder.ts` | new | Per-user cap config table. |
| `core_audit_log` | `packages/adapters/src/db/schema/core.ts` | existing | Reuse: write `budget.warn` / `budget.blocked` audit events. |

## 6. User stories

1. As an **admin**, I open the governance dashboard and see spend broken down by
   user and by flow over the last 30 days, and which users cost the most.
2. As an **admin**, I set a $50 `daily` cap and a $500 `monthly` cap on a heavy
   user, each enabled, with an 80% warn threshold.
3. As an **admin**, when that user's spend for the current day reaches $40, I see
   their cap flip to **warn** on the dashboard and a `budget.warn` audit event is
   written.
4. As an **admin**, when that user's daily spend reaches $50, their next LLM call
   is **blocked**, the session pauses with a clear message, and a
   `budget.blocked` audit event is recorded; raising or disabling the cap lets
   the user resume.
5. As an **end user**, I can see my running spend against my cap so I can request
   a higher limit before I am throttled.
6. As an **admin**, a user with **no enabled cap** behaves exactly as today —
   fully recorded, never blocked.

## 7. Pages / surfaces affected

- **`/admin/dashboards/governance`** (new) — spend-by-user and spend-by-flow
  charts, cap utilisation table (ok / warn / blocked), spend-over-time, and
  overrun highlights. Built with Recharts, mirroring
  `admin/dashboards/overview/_content.tsx`.
- **`/admin`** hub — add a link/card to the governance dashboard.
- **Cap management** — a CRUD surface (within the governance page or
  `/admin/governance/budgets`) to create/enable/disable per-user caps. The user
  picker is a plain user lookup; the period is a `daily` / `weekly` / `monthly`
  select.
- **tRPC** — new `governance` router (admin-only): `spendByUser`, `spendByFlow`,
  `utilisation`, and `budgets.{list,create,update,delete}`.
- **Agent / session call paths** — `run-turn`, `run-auto-node`, and the agent
  graph (`flow-session-graph.ts`) must pass `flowId` / `sessionId` into every
  `ILanguageModel` call so recording has context. (`userId` is already passed.)
- **Session pause path** — when a call returns `QUOTA_EXCEEDED`, the calling
  use-case surfaces a system message and pauses the session rather than failing
  hard.
- **Wiring** — `apps/web/src/lib/container.ts` wraps the model as
  `withQuotaEnforcement(withUsageTracking(provider))` and injects the budget
  repository + governance use-cases.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `ai_usage_events` | ADD `flow_id uuid` (nullable, FK → `app_flows`, `on delete set null`), `session_id uuid` (nullable). Indexes on `(flow_id, created_at)` and `(session_id)`. | n/a (existing `ai_`) |
| `app_usage_budgets` | NEW — `id` uuid PK, `user_id uuid` (FK → `core_users.id`, `on delete cascade`), `period text` (`daily` \| `weekly` \| `monthly`), `limit_usd real`, `warn_threshold_pct smallint default 80`, `enabled boolean default false`, `created_at`, `updated_at`. Unique index on `(user_id, period)`. | yes (`app_`) |

Columns are snake_case; `id` / `created_at` / `updated_at` present per
convention. Cross-schema FK from `ai_usage_events.flow_id` to `app_flows.id` is
acceptable (single Postgres database). Current-period spend is computed on the
fly by summing `ai_usage_events.cost_usd` for the user over the period window
(no separate counter table in v1 — see §11). The period window is **`daily`** =
since 00:00 of the current day, **`weekly`** = since 00:00 Monday of the current
week, **`monthly`** = since the start of the current calendar month — all in UTC
(see §12).

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
  usage-tracking + provider run), how flow/session context is threaded through
  the port for recording, the **per-user cap model** (caps key on `user_id`;
  spend summed on the fly per period window), on-the-fly period-spend computation
  vs a counter table, the warn-then-block model, opt-in/off-by-default semantics,
  and the `QUOTA_EXCEEDED` → session-pause contract.

## 10. Acceptance criteria

- [ ] Every LLM call writes an `ai_usage_events` row carrying `flow_id` and
      `session_id` whenever those are known (in addition to the existing
      `user_id` / `conversation_id`).
- [ ] With **no enabled cap**, behaviour is identical to today: calls are
      recorded and never blocked, with no spend query on the hot path.
- [ ] An admin can create, enable, disable, edit, and delete a per-user cap via
      the `governance.budgets` tRPC procedures; a user has at most one cap per
      period (`daily` / `weekly` / `monthly`).
- [ ] When a user's current-period spend for an enabled cap reaches the warn
      threshold, `evaluateBudget` returns `warn`, the dashboard shows `warn`, and
      a `budget.warn` audit event is written.
- [ ] When a user's current-period spend reaches the limit, the next LLM call for
      that user returns `QUOTA_EXCEEDED`, the session pauses with a clear message,
      and a `budget.blocked` audit event is written. Raising/disabling the cap
      lets the session resume.
- [ ] `daily` caps sum spend since 00:00 UTC of the current day; `weekly` since
      00:00 UTC Monday; `monthly` since the start of the current UTC calendar
      month.
- [ ] When more than one of a user's caps is enabled (e.g. daily and monthly),
      all apply and the **stricter** (first to block) wins.
- [ ] The governance dashboard renders spend by user and by flow over a selected
      period and a utilisation table with ok / warn / blocked status.
- [ ] No AI SDK / framework import is added outside `packages/adapters`; budget
      evaluation has no external deps (ESLint boundary check passes).
- [ ] `./validate.sh` passes; `VERSION` and root `package.json#version` are
      `1.48.0` and match.

## 11. Out of scope / future work

- **Per-flow and per-team budgets** and any org-tier / team scope.
- **Org-structure resolution** (Entra manager chain / HR sheet), the
  `IOrgStructure` port, and a team level dropdown.
- **AUD / multi-currency** caps and a configurable FX rate.
- **Chargeback / billing export** (CSV / finance integration) of spend by
  user/flow.
- **Cap-approaching email notifications** (reusing the v1.35 notification
  outbox) — this round raises audit events + dashboard signals only.
- **Pre-call cost estimation / token pre-flight** to block a call *before* it
  starts based on predicted cost (this PRD blocks based on already-recorded
  spend).
- **A materialised per-period spend counter** for high call volumes.

## 12. Risks / open questions

- **Context threading.** Recording depends on `flowId` / `sessionId` reaching the
  `ILanguageModel` call; enforcement depends on `userId` (already passed). Every
  call site (agent graph, auto-nodes, ad-hoc calls) must pass flow/session; calls
  that don't will record nulls for those analytics dimensions but are still
  enforced by user. **Mitigation:** thread flow/session where sessions exist.
- **On-the-fly spend query cost.** Each enforced call sums `ai_usage_events` for
  the user/period. Indexed on `(user_id, created_at)`; acceptable at current
  volume. A counter table is the optimisation if needed (§11). **Off-by-default
  means zero query when no cap exists** — short-circuit if `findEnabledForUser`
  returns nothing.
- **Last-call overshoot.** Spend is checked before a call; the call that crosses
  the limit still completes, so a user can land slightly over. Documented as
  intended (governance ceiling, not metered prepay).
- **Streaming cost timing.** Streamed calls only know final token usage after the
  stream ends, so a long stream is checked at start, not mid-stream. Acceptable
  for v1; noted for the counter-table follow-up.
- **Period boundary.** `daily` / `weekly` / `monthly` windows use UTC
  (00:00 day / Monday week start / 1st of month). Documented; deployment-local
  calendars are out of scope for v1.
- **Blocked-session UX.** A paused session must clearly tell the user *why*
  ("usage cap reached — contact an administrator") and not look like a crash.
- **Audit-event volume.** A long over-threshold run could emit a `budget.warn`
  per call. De-duplicate (one warn per user per period) at build.
