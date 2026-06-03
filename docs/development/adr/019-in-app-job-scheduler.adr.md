# ADR-019 — In-app Job Scheduler

- **Status**: Proposed
- **Date**: 2026-06-03
- **Relates to**: ADR-009 (document generation), Scheduling PRD, Approvals PRD

## Context

Scheduling introduces two timed needs: per-session **scheduled nodes** (wait N
days, then continue; remind weekly) and system **procedure jobs** (regenerate the
master document for newly approved records). Wayfinder has `job_registry` for
*tracking* job health but nothing that *fires* work. We must choose an engine
that is durable across restarts, observable, and adds no infrastructure the
project does not already run (Postgres core; Redis present for some adapters).

## Decision

### A Postgres-backed poller over `app_session_schedules`

Schedule state is persisted in `app_session_schedules` (`status`,
`next_fire_at`, recurrence fields). A single worker ticks on a short interval and
claims due rows with row-level locking:

```sql
SELECT * FROM app_session_schedules
WHERE status = 'active' AND next_fire_at <= now()
ORDER BY next_fire_at
FOR UPDATE SKIP LOCKED
LIMIT :batch;
```

For each claimed row the worker fires the effect (advance/recur the session, or
run a registered procedure), then either computes the next `next_fire_at`
(recurring, within `max_occurrences`) or sets `status = 'completed'`. The worker
registers itself in `job_registry` and updates `last_run_at` / `next_run_at` /
`error_count` each tick. Time is injected via an `IClock` port so firing is
unit-testable without waiting.

`FOR UPDATE SKIP LOCKED` gives safe claiming (no double-fire) and a clean path to
multiple workers later without changing the data model.

### System procedures share the same engine

The **record-regeneration procedure** is registered with the scheduler on a fixed
cadence. Each run scans `app_session_approvals` for `approved` rows not yet
regenerated, calls `IDocumentGenerator` (ADR-009) over each snapshot, writes the
updated document to storage, and marks the approval regenerated. It is idempotent
on the "regenerated" marker.

### Rejected alternatives

| Option | Why not (v1) |
| ------ | ------------ |
| **BullMQ (Redis)** | Redis exists for some adapters but is not guaranteed core infra; schedule state would split from app data, complicating audit/queryability. Strong future scale option. |
| **pg-boss** | Durable and Postgres-based, but owns its own schema/queue tables; we already need queryable per-session schedule rows in `app_` for the UI, so a thin poller over our own table is simpler. |
| **External cron / n8n** | Divorces timing from flow state and audit; the whole point is to keep scheduled flow behaviour inside Wayfinder. n8n remains the path for *external side-effects*, not flow timing. |

### Catch-up policy

After downtime, `relative`/`at` schedules fire once on catch-up (not once per
missed window); `cron` schedules compute the next valid time forward from now.
Sub-minute precision is explicitly out of scope.

## Consequences

**Positive**

- Durable across restarts; state lives in Postgres alongside session data.
- No new infrastructure required for v1.
- Health is visible in `job_registry`; firing is testable via `IClock`.
- `SKIP LOCKED` leaves a clean horizontal-scale path.

**Negative**

- Polling has latency bounded by the tick interval (acceptable; needs are
  day-scale, not second-scale).
- A single worker is a single point of execution until multi-worker is added
  (rows are safe to claim concurrently when it is).

## Open questions

- Tick interval and batch size defaults (start conservative; tune from load).
- Whether procedure cadence is config or hard-coded for v1 (lean: env/config).
