# ADR-026 — Usage Governance Enforcement (budget decorator on `ILanguageModel`)

- **Status**: Accepted (scoped by `cost-usage-governance.prd.md`, target v1.47.0)
- **Date**: 2026-06-14

## Context

`cost-usage-governance.prd.md` introduces optional per-flow and per-team budgets
that must **stop** a runaway flow, not just report it after the fact. The
codebase already records spend: `UsageTrackingAdapter`
(`packages/adapters/src/observability/usage-tracking-adapter.ts`) decorates the
`ILanguageModel` port and writes an `ai_usage_events` row (tokens + `cost_usd`)
after every call. What is missing:

1. **Attribution.** `ai_usage_events` records `user_id` and `conversation_id` but
   not the originating **flow**, **session/run**, or **team**. The
   `ILanguageModel` call inputs (`GenerateObjectInput`, `StreamTextInput`,
   `StreamObjectInput`) carry `purpose` and `userId` but no flow/session/team.
2. **Enforcement.** There is no budget concept and no place that can refuse a
   call.

Constraints:

- **Hexagonal boundary (ADR-001).** Budget evaluation must be pure domain; the
  application and domain layers must not import an AI SDK. Only
  `packages/adapters` knows how a call is made.
- **Uniform coverage.** Every call path (the LangGraph agent, auto-nodes, ad-hoc
  calls) must be governed without sprinkling checks at each call site.
- **Off by default.** Existing behaviour must be byte-for-byte unchanged when no
  budget is enabled — no added latency, no blocking.

## Decision

### 1. Thread call context through the port

Extend the three `ILanguageModel` input types with optional `flowId`,
`sessionId`, and `team` (the call context), alongside the existing `userId` and
`purpose`:

```ts
export interface GenerateObjectInput<TSchema = unknown> {
  readonly purpose: string;
  readonly userId?: string | null;
  readonly flowId?: string | null;      // new
  readonly sessionId?: string | null;   // new
  readonly team?: string | null;        // new
  // …unchanged…
}
```

`UsageTrackingAdapter` records these onto `ai_usage_events`; the new enforcement
decorator reads them. Calls made without context (no active session) record
nulls and are treated as **un-scoped → not enforced**.

### 2. Enforcement is a decorator on `ILanguageModel`, ordered outermost

A new `QuotaEnforcingLanguageModel`
(`packages/adapters/src/observability/quota-enforcing-adapter.ts`) wraps the
port exactly as `UsageTrackingAdapter` does. The wrapping order in
`apps/web/src/lib/container.ts` is:

```ts
withQuotaEnforcement(withUsageTracking(provider), budgetRepo, usageRepo, auditLog)
```

so the quota check runs **before** the inner usage-tracking + provider call and
can short-circuit. Per call:

1. `budgetRepo.findEnabledForFlowAndTeam(flowId, team)`. **If it returns nothing,
   pass straight through** — this is the off-by-default zero-overhead path.
2. For each enabled budget, compute current-period spend via
   `usageRepo.summarize` with a scope+period filter (`per_run` → `sessionId`;
   `monthly` → flow/team since start of the calendar month).
3. `evaluateBudget(budget, spendUsd)` (pure domain) returns `ok` / `warn` /
   `blocked`.
4. On `warn`, write a `budget.warn` `core_audit_log` event and proceed. On
   `blocked`, write `budget.blocked` and return
   `err(domainError("QUOTA_EXCEEDED", …))` **without** calling the inner model.
5. When both a flow and a team budget apply, the **stricter** (first to block)
   wins.

Returning the Result error (never throwing) keeps the Result-pattern boundary
intact.

### 3. Budget evaluation is pure domain

`packages/domain/src/entities/budget.ts` owns the `Budget` shape and a pure
function:

```ts
export const evaluateBudget = (
  budget: Budget,
  spendUsd: number,
): { status: "ok" | "warn" | "blocked"; ratio: number } => { … };
```

No dates, no IO — the caller supplies the already-summed spend. This keeps the
threshold/limit logic unit-testable with zero dependencies and reusable by the
dashboard (`utilisation`) and the enforcer alike.

### 4. Spend computed on the fly (no counter table in v1)

Current-period spend is a `SUM(cost_usd)` over `ai_usage_events` filtered by
scope and period window, served by `IUsageRepository.summarize` (extended
`UsageFilter` with `flowId`, `sessionId`, `team`, `since`, `until`). Indexes on
`(flow_id, created_at)` and `(team, created_at)` keep it cheap at current volume.
A materialised counter is deferred (PRD §11) — the off-by-default short-circuit
means most calls never run the query.

### 5. Blocked → session pause, not crash

A `QUOTA_EXCEEDED` Result propagates to the calling use-case (`run-turn`,
`run-auto-node`), which pauses the session and surfaces a clear system message
("This flow has reached its usage budget — contact an administrator to
continue") instead of failing hard. Raising or disabling the budget lets the
session resume on the next turn.

## Consequences

**Positive**

- One enforcement point covers every call path; call sites only have to pass
  context, not check budgets.
- Mirrors the proven `UsageTrackingAdapter` pattern — same shape, same tests
  style, same wiring spot.
- Off-by-default with a one-lookup short-circuit means existing deployments are
  unaffected and pay no cost until a budget is enabled.
- Budget logic is pure domain → trivially unit-testable and shared with the
  dashboard.

**Negative**

- Enforced calls add a spend query per call until a counter table is introduced.
- Blocking is based on already-recorded spend, so the call that crosses the limit
  still completes (last-call overshoot) and streamed calls are checked only at
  start. Acceptable for a governance ceiling; revisit with the counter table.
- Context must be threaded through every call site; a missed site silently
  under-records and under-enforces. Mitigated by centralising context in the
  agent graph where sessions live.

## Open questions — to resolve at build

- **Audit-event volume.** A long over-threshold run could emit a `budget.warn`
  per call. Consider de-duplicating (one warn per scope per period) at build.
- **`monthly` boundary.** Use deployment-local calendar month vs UTC — pick one
  and document it; default UTC start-of-month.
- **Disabled-vs-deleted budget** semantics during an active blocked session —
  confirm both immediately unblock.
