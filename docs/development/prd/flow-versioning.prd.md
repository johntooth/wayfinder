# PRD — Flow Versioning / Change History

> Phase 6+ feature drawn from `wayfinder.prd.md` §11 ("Out of scope / future
> work"). Introduces **immutable snapshots on publish** with history listing,
> read-only inspection, and non-destructive restore. Route to the Documentation
> Review skill before any code is written.

- **Status**: Draft
- **Date**: 2026-05-31
- **Author**: Solo / Claude Code
- **Target version**: TBD (bump: **MINOR** — new table, new domain entity, new
  port; no breaking change. See `docs/guides/versioning.md`.)

## 1. Problem

A flow's configuration (metadata, nodes, edges, node configs, context-document
references) is mutable in place. Publishing overwrites the live config with no
record of what came before, who changed it, or why. A flow owner who breaks a
published flow has no way to see the prior state or roll back, and there is no
audit of how a flow evolved over time — which matters for regulated
procurement processes where "what did the process look like on this date?" is a
real question.

## 2. Users / Personas

- **Flow Owner** — wants to publish with confidence, see the history of changes,
  compare against a previous version, and restore a known-good version if a new
  one is wrong.
- **Admin** — wants an organisation-wide audit trail of flow changes for
  oversight and compliance.
- **Procurement Officer (indirect)** — benefits from stable, restorable flows;
  not a direct user of the versioning UI.

## 3. Goals

- Publishing a flow creates an **immutable snapshot** capturing the complete
  flow definition at that moment: flow metadata, all `app_flow_nodes`, all
  `app_flow_edges`, their `config` JSON, and the `context_docs` references.
- Each snapshot records a monotonically increasing `version_number` per flow,
  `published_by`, `published_at`, and an optional free-text `change_summary`.
- A flow owner can list a flow's version history (number, author, date,
  summary), newest first.
- A flow owner can open any past version read-only and see exactly the
  definition it captured.
- A flow owner can **restore** a past version: this creates a *new* version
  from that snapshot and sets it live — the operation is non-destructive (no
  snapshot is ever mutated or deleted).
- Existing published flows are back-filled with an initial version on migration
  so history is complete from day one.

## 4. Non-goals

- **No full version branching / parallel trees.** History is a linear sequence
  of snapshots per flow (see ADR-015 for the rejected branching model).
- **No pinning of in-progress sessions to a version.** Snapshots make this
  possible later; it is explicitly deferred (§11, §12).
- **No autosave snapshots on draft save.** Snapshots are created on **publish**
  (and on restore) only.
- **No content-level diff of context documents** — snapshots record the
  document *references* (`context_docs`), not re-snapshots of extracted text.
- **No real-time collaborative / merge editing** (separate §11 item).
- **No visual side-by-side diff UI** required for v1 — read-only inspection of a
  snapshot is enough; a diff view is a future enhancement (§11).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `FlowVersion` (entity) | `packages/domain/src/entities/flow-version.ts` | new | id, flowId, versionNumber, snapshot (`FlowSnapshot`), changeSummary, publishedByUserId, publishedAt, createdAt, updatedAt. |
| `FlowSnapshot` (value object) | `packages/domain/src/entities/flow-version.ts` | new | Serialised `{ flow, nodes[], edges[] }` — the full definition, self-contained. |
| `IFlowVersionRepository` (port) | `packages/domain/src/ports/flow-version-repository.ts` | new | `create`, `listForFlow`, `getByNumber`, `latestNumber`. |
| `DrizzleFlowVersionRepository` | `packages/adapters/src/repositories/drizzle-flow-version-repository.ts` | new | Implements the port against `app_flow_versions`. |
| `PublishFlowVersion` (use-case) | `packages/application/src/use-cases/flows/publish-flow-version.ts` | new | Wraps the existing publish: assembles the snapshot, allocates the next number, persists. |
| `ListFlowVersions` (use-case) | `packages/application/src/use-cases/flows/list-flow-versions.ts` | new | Returns history metadata (no heavy snapshot payload). |
| `GetFlowVersion` (use-case) | `packages/application/src/use-cases/flows/get-flow-version.ts` | new | Returns one full snapshot for read-only inspection. |
| `RestoreFlowVersion` (use-case) | `packages/application/src/use-cases/flows/restore-flow-version.ts` | new | Applies a snapshot back onto the live flow/nodes/edges **and** creates a new version recording the restore. |
| `app_flows`, `app_flow_nodes`, `app_flow_edges` | `packages/adapters/src/db/schema/wayfinder.ts` | existing | Read to build a snapshot; written by restore. |
| `core_audit_log` | `packages/adapters/src/db/schema/core.ts` | existing | Reuse: `flow.version.published` / `flow.version.restored` events. |

## 6. User stories

1. As a **flow owner**, when I publish, a version is recorded with an optional
   one-line summary of what I changed.
2. As a **flow owner**, I open a "Version history" panel on the canvas and see
   every published version with number, author, date, and summary.
3. As a **flow owner**, I click a past version and view its nodes, edges, and
   configs read-only.
4. As a **flow owner**, I restore a past version; the live flow returns to that
   definition and a new version is recorded noting it was restored from version N.
5. As an **admin**, I see `flow.version.published` / `flow.version.restored`
   entries in the audit log.

## 7. Pages / surfaces affected

- `/admin/flows/[id]` and `/flows/[id]/config` (the canvas) — add a **Version
  history** panel/drawer: list, read-only view, restore action.
- **Publish action** — the existing "Publish" control now also creates a
  snapshot and accepts an optional change summary.
- **tRPC** — new `flowVersion.*` router: `list`, `get`, `restore`. The existing
  `flow.publish` procedure is extended to create the version (and take an
  optional `changeSummary`).
- **Wiring** — `apps/web/lib/container.ts` constructs the version repository and
  use-cases.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_flow_versions` | NEW — id, flow_id uuid (FK → `app_flows`, cascade delete, indexed), version_number integer, snapshot jsonb (full `{ flow, nodes, edges }`), change_summary text (nullable), published_by_user_id uuid (FK → `core_users`), published_at timestamptz, created_at, updated_at | yes (`app_`) |

A unique index on `(flow_id, version_number)` guarantees monotonic, gap-tolerant
numbering per flow. The snapshot is stored as `jsonb` so a version is fully
self-contained and survives later edits or deletions of live rows. Columns are
snake_case; `id`/`created_at`/`updated_at` present per convention.

**Migration back-fill:** for every existing `app_flows` row with
`status='published'`, insert a `version_number = 1` snapshot built from its
current nodes/edges so history is non-empty from day one.

## 9. Architectural decisions

### Existing ADRs assumed

- **ADR-001 Hexagonal Architecture** — `IFlowVersionRepository` is a domain
  port; Drizzle stays in `packages/adapters`.
- **ADR-006 Wayfinder Schema** — extends the `app_*` table family; node config
  remains `jsonb`, so a snapshot is a straightforward composition of existing
  shapes.

### New ADR introduced by this PRD

- **ADR-015 Flow Versioning via Immutable Snapshots** — selects snapshot-on-
  publish over branching or field-level change-log; defines the `FlowSnapshot`
  shape, the restore-as-new-version semantics, and the back-fill strategy.

## 10. Acceptance criteria

- [ ] Publishing a flow creates one `app_flow_versions` row with the next
      `version_number`, a complete snapshot, and the publisher's id.
- [ ] An optional change summary supplied at publish is stored and shown in the
      history list.
- [ ] `flowVersion.list` returns history newest-first with number, author, date,
      and summary, and does **not** include the heavy snapshot payload.
- [ ] `flowVersion.get` returns the exact captured nodes/edges/configs for a
      chosen version, rendered read-only on the canvas.
- [ ] `flowVersion.restore` rewrites the live flow/nodes/edges to match the
      chosen snapshot **and** creates a new version whose summary notes the
      source version; no prior snapshot row is mutated or deleted.
- [ ] After restore, reloading the canvas shows the restored definition.
- [ ] The migration back-fills a `version_number = 1` snapshot for every
      already-published flow.
- [ ] `flow.version.published` and `flow.version.restored` audit events are
      written to `core_audit_log`.
- [ ] No ORM import exists outside `packages/adapters` (ESLint boundary passes).
- [ ] `./validate.sh` passes; `VERSION` and root `package.json#version` match.

## 11. Out of scope / future work

- **Version branching / parallel trees** (rejected for v1 in ADR-015).
- **Pinning in-progress sessions to the version they started on** — the
  snapshot model enables it; deferred to a follow-up phase.
- **Visual side-by-side diff** between two versions.
- **Autosave / draft-level versioning** (snapshot every save).
- **Snapshotting context-document *content*** (only references are captured).
- **Retention / pruning policy** for old snapshots if storage grows.

## 12. Risks / open questions

- **Snapshot size** — a large flow's `jsonb` snapshot duplicates the full
  definition per publish. Acceptable for expected flow sizes (tens of nodes);
  a retention policy is listed in §11 if growth bites.
- **Restore vs. live node ids** — restoring rewrites `app_flow_nodes` /
  `app_flow_edges`. **Open:** preserve original node `id`s from the snapshot
  (so `current_node_id` references in any session still resolve) vs. regenerate.
  Recommend preserving snapshot ids to avoid orphaning session references.
- **Restore while sessions are active** — an active session points at the live
  flow via `current_node_id` and a `graph_checkpoint`. Restoring could change
  the node graph under a running session. v1 does not pin sessions to versions
  (§11); document the limitation and warn the owner on restore. Pinning is the
  recommended follow-up.
- **Version-number concurrency** — two near-simultaneous publishes must not
  collide on `version_number`. The unique `(flow_id, version_number)` index
  forces a retry; allocate the next number inside the same transaction as the
  insert.
- **Back-fill correctness** — the migration must snapshot each published flow's
  *current* nodes/edges accurately; draft-only flows get no version until first
  publish.
