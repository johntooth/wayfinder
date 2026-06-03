# PRD — Scheduling (Scheduled Nodes & Procedure Jobs)

- **Status**: Draft
- **Date**: 2026-06-03
- **Author**: Richy Brasier
- **Target version**: 1.26.0  (bump: **MINOR** — new node type, new table,
  new scheduler runtime; additive)

## 1. Problem

Some flows need to act on a clock, not just on conversation: "re-check in 30
days", "remind weekly until approved", "regenerate the master record nightly
once items are approved". Wayfinder has a `job_registry` table for tracking job
health but **no scheduler** that fires anything — recurring work today would have
to live entirely outside the app in n8n/cron, divorced from flow state and audit.

Two distinct needs share one engine:

1. **Per-session scheduled nodes** — a flow node that pauses the session and
   resumes (once or recurring) at a time derived from flow metadata.
2. **System procedure jobs** — app-level recurring jobs not bound to one session.
   The first consumer is the **record-regeneration procedure** that takes
   approved records (from the Approvals feature) and updates / regenerates the
   master generated document (the "update the template" path).

## 2. Users / Personas

- **Flow author** — wants a step that means "wait N days, then continue".
- **Operator** — should see that a session is *scheduled* and when it will fire.
- **Platform owner** — needs a durable, observable scheduler whose health shows
  up in `job_registry`, with no new infrastructure beyond what already runs.

## 3. Goals

- A new **`scheduled` node type**: pauses the session and fires once or
  recurring, with the time derived from flow/session metadata (relative,
  absolute, or cron).
- An **in-app scheduler** that durably persists due times, claims due work
  safely, fires it, and reschedules or completes it.
- A **record-regeneration procedure** that periodically scans approved-but-not-
  regenerated records and updates the master generated document via the existing
  document generator — delivering the "update the template on approval" outcome.
- Scheduler and each procedure report **health to `job_registry`**
  (`last_run_at`, `next_run_at`, `status`, `error_count`).

## 4. Non-goals

- A general user-facing job scheduler/cron UI for arbitrary tasks.
- Sub-minute precision or high-frequency scheduling.
- Distributed multi-worker coordination beyond safe row claiming (single worker
  this phase; horizontal scale is future work).
- Defining approval semantics (owned by the Approvals PRD).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `SessionSchedule` | `packages/domain/src/entities/session-schedule.ts` | new | One per-session scheduled/recurring instance. |
| `FlowNode` (type `scheduled`) | `packages/domain/src/entities/flow-node.ts` | existing | Add `scheduled` to the union + config shape. |
| `IScheduleRepository` | `packages/domain/src/ports/schedule-repository.ts` | new | `create`, `claimDue`, `markFired`, `complete`, `cancel`. |
| `IClock` | `packages/domain/src/ports/clock.ts` | new | Injectable time for testable firing. |
| `Job` | `packages/domain/src/entities/job.ts` | existing | Health rows for the worker + each procedure. |

## 6. User stories

1. As a flow author, I add a `scheduled` node configured "relative: 30 days" and
   the flow waits that long before continuing.
2. As an operator, I can see a session is scheduled and its next fire time.
3. As the platform, due schedules fire even across restarts (durable in
   Postgres), without firing twice.
4. As a records process, approved records are regenerated into the master
   document by a recurring procedure without manual intervention.
5. As a platform owner, I can see scheduler and procedure health in the jobs
   view.

## 7. Pages / surfaces affected

- Flow canvas — new `scheduled` node type + config panel (kind, spec, recurring,
  max occurrences).
- Session chat — a "scheduled — next: <time>" status line.
- Admin jobs view — scheduler worker + record-regeneration procedure health.
- tRPC: `schedule.listForSession`, `schedule.cancel` — new.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_session_schedules` | NEW | yes (app_) |
| `job_registry` | rows for `scheduler_worker`, `record_regeneration_procedure` (no schema change) | n/a |

`app_session_schedules` columns: `id`, `session_id`, `flow_id`, `node_id`,
`kind` (`relative`|`cron`|`at`), `spec` (text), `recurring` (bool),
`next_fire_at`, `last_fired_at` (nullable), `occurrence_count` (int),
`max_occurrences` (nullable), `status`
(`active`|`completed`|`cancelled`|`failed`), `payload` (jsonb), `created_at`,
`updated_at`. Index on `(status, next_fire_at)` for the due-claim query.

## 9. Architectural decisions

- **ADR-019 — In-app job scheduler** (new): a Postgres-backed poller using
  `SELECT … FOR UPDATE SKIP LOCKED` over `app_session_schedules`, run by a single
  worker registered in `job_registry`; rejected alternatives (BullMQ/Redis,
  pg-boss, external cron) and the future scale path are recorded there.
- The **record-regeneration procedure** is a system schedule that calls the
  existing `IDocumentGenerator` (ADR-009) over approved snapshots from
  `app_session_approvals`, writing the updated document to storage.

## 10. Acceptance criteria

- [ ] A `scheduled` node can be added, configured, and saved.
- [ ] Reaching it creates an `active` `app_session_schedules` row with a computed
      `next_fire_at`; the session pauses.
- [ ] The worker claims due rows safely (no double-fire), advances/recurs the
      session, and updates `next_fire_at` / completes.
- [ ] Firing survives a process restart (state is in Postgres, not memory).
- [ ] The record-regeneration procedure regenerates the master document for newly
      approved records and is idempotent.
- [ ] Scheduler and procedure update `job_registry` health each run.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.

## 11. Out of scope / future work

- Horizontal scale (multiple scheduler workers / leader election).
- A general-purpose cron UI for arbitrary admin tasks.
- Calendar/business-day awareness and timezone-per-user firing.

## 12. Risks / open questions

- Engine choice trade-offs (durability vs new infra) — settled in ADR-019.
- Clock skew / missed windows after long downtime — fire-once-on-catch-up policy
  for relative/at schedules; cron computes the next valid time forward.
- Coupling to Approvals: the regeneration procedure reads approval state; the
  contract (approved snapshot shape + "regenerated" marker) must be stable.
