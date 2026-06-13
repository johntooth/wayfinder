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

Editing in place also means an active chat can have the flow graph change
underneath it mid-run: a procurement officer halfway through a session can be
moved onto a node that did not exist when they started. The process a user is
running must stay stable for the life of that chat, regardless of edits or
publishes the owner makes in parallel.

## 2. Users / Personas

- **Flow Owner** — wants to publish with confidence, see the history of changes,
  compare against a previous version, and restore a known-good version if a new
  one is wrong.
- **Admin** — wants an organisation-wide audit trail of flow changes for
  oversight and compliance.
- **Procurement Officer (indirect)** — benefits from stable, restorable flows;
  not a direct user of the versioning UI.

## 3. Goals

- Every flow version is an **immutable snapshot** capturing the complete flow
  definition at that moment: flow metadata, all `app_flow_nodes`, all
  `app_flow_edges`, their `config` JSON, and the `context_docs` references.
- A version carries its own lifecycle `status` of `draft` or `published`.
  **Editing** a flow creates (or updates) a `draft` version; **publishing**
  promotes the latest draft to `published`. Live `app_flow_*` rows are no longer
  mutated in place — they are the working copy the current draft version
  reflects.
- Each version records a monotonically increasing `version_number` per flow,
  `published_by`, `published_at`, and an optional free-text `change_summary`.
- **New chats pin to the latest published version.** When a session starts it
  records the flow's current latest-published `version_number` and runs against
  that snapshot for its entire life. Later edits, publishes, or restores by the
  owner do **not** change the graph beneath an in-progress chat.
- A flow owner can list a flow's version history (number, status, author, date,
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
- **No re-pinning of an in-progress session.** A session pins to the published
  version live when it started and stays there until it concludes; there is no
  mid-session "upgrade this chat to the new version" action in v1.
- **No per-keystroke snapshot churn.** A flow has at most one open `draft`
  version at a time; editing updates that single draft snapshot rather than
  writing a new row per save. A new numbered version row appears only when a
  draft is first opened (from the published baseline) and when a publish/restore
  occurs.
- **No content-level diff of context documents** — snapshots record the
  document *references* (`context_docs`), not re-snapshots of extracted text.
- **No real-time collaborative / merge editing** (separate §11 item).
- **No visual side-by-side diff UI** required for v1 — read-only inspection of a
  snapshot is enough; a diff view is a future enhancement (§11).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `FlowVersion` (entity) | `packages/domain/src/entities/flow-version.ts` | new | id, flowId, versionNumber, status (`draft`/`published`), snapshot (`FlowSnapshot`), changeSummary, publishedByUserId, publishedAt, createdAt, updatedAt. |
| `FlowSnapshot` (value object) | `packages/domain/src/entities/flow-version.ts` | new | Serialised `{ flow, nodes[], edges[] }` — the full definition, self-contained. |
| `IFlowVersionRepository` (port) | `packages/domain/src/ports/flow-version-repository.ts` | new | `create`, `listForFlow`, `getByNumber`, `latestNumber`. |
| `DrizzleFlowVersionRepository` | `packages/adapters/src/repositories/drizzle-flow-version-repository.ts` | new | Implements the port against `app_flow_versions`. |
| `PublishFlowVersion` (use-case) | `packages/application/src/use-cases/flows/publish-flow-version.ts` | new | Wraps the existing publish: assembles the snapshot, allocates the next number, persists. |
| `ListFlowVersions` (use-case) | `packages/application/src/use-cases/flows/list-flow-versions.ts` | new | Returns history metadata (no heavy snapshot payload). |
| `GetFlowVersion` (use-case) | `packages/application/src/use-cases/flows/get-flow-version.ts` | new | Returns one full snapshot for read-only inspection. |
| `RestoreFlowVersion` (use-case) | `packages/application/src/use-cases/flows/restore-flow-version.ts` | new | Applies a snapshot back onto the live flow/nodes/edges **and** creates a new version recording the restore. |
| `app_flows`, `app_flow_nodes`, `app_flow_edges` | `packages/adapters/src/db/schema/wayfinder.ts` | existing | Read to build a snapshot; written by restore; reflect the current draft version. |
| `app_sessions` | `packages/adapters/src/db/schema/wayfinder.ts` | existing | Gains `flow_version_id` FK → `app_flow_versions`, captured at session start to pin the chat. |
| `core_audit_log` | `packages/adapters/src/db/schema/core.ts` | existing | Reuse: `flow.version.published` / `flow.version.restored` events. |

## 6. User stories

1. As a **flow owner**, when I edit a published flow my changes accumulate in a
   `draft` version; when I publish, that draft is promoted to `published` with an
   optional one-line summary of what I changed.
2. As a **flow owner**, I open a "Version history" panel on the canvas and see
   every version with number, status (draft/published), author, date, and summary.
3. As a **flow owner**, I click a past version and view its nodes, edges, and
   configs read-only.
4. As a **flow owner**, I restore a past version; the live flow returns to that
   definition and a new version is recorded noting it was restored from version N.
5. As a **procurement officer**, when I start a chat it runs the version that was
   the latest published at that moment, and it keeps running that same version
   until I finish — even if the owner publishes or restores while I am mid-chat.
6. As an **admin**, I see `flow.version.published` / `flow.version.restored`
   entries in the audit log.

## 7. Pages / surfaces affected

- `/admin/flows/[id]` and `/flows/[id]/config` (the canvas) — add a **Version
  history** panel/drawer: list, read-only view, restore action.
- **Publish action** — the existing "Publish" control now also creates a
  snapshot and accepts an optional change summary.
- **tRPC** — new `flowVersion.*` router: `list`, `get`, `restore`. Publishing
  today is a `status: "published"` transition on the `flow.update` mutation
  (`updateFlow` use-case); that transition is extended to promote the open draft
  version to `published` and accept an optional `changeSummary`. Editing
  mutations open/refresh the draft version.
- **Session start** — when a chat is created it resolves the flow's latest
  `published` version and stores its id on `app_sessions.flow_version_id`; the
  runner reads the pinned snapshot rather than the live `app_flow_*` rows.
- **Wiring** — `apps/web/lib/container.ts` constructs the version repository and
  use-cases.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_flow_versions` | NEW — id, flow_id uuid (FK → `app_flows`, cascade delete, indexed), version_number integer, status text (`draft`/`published`), snapshot jsonb (full `{ flow, nodes, edges }`), change_summary text (nullable), published_by_user_id uuid (FK → `core_users`, nullable until published), published_at timestamptz (nullable until published), created_at, updated_at | yes (`app_`) |
| `app_sessions` | ALTER — add `flow_version_id` uuid (FK → `app_flow_versions`, indexed) captured at session start to pin the chat to a version | yes (`app_`) |

A unique index on `(flow_id, version_number)` guarantees monotonic, gap-tolerant
numbering per flow. A partial unique index on `(flow_id)` where
`status = 'draft'` enforces **at most one open draft per flow**. The snapshot is
stored as `jsonb` so a version is fully self-contained and survives later edits
or deletions of live rows. Columns are snake_case; `id`/`created_at`/`updated_at`
present per convention.

A new chat resolves the flow's latest `status = 'published'` version (highest
`version_number`) and stores that id on `app_sessions.flow_version_id`; the
session then runs against that snapshot for its whole life. `published_by_user_id`
and `published_at` are nullable because a `draft` version has not been published
yet; they are set on promotion.

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

- **ADR-015 Flow Versioning via Immutable Snapshots** — selects immutable
  snapshots over branching or field-level change-log; defines the `FlowSnapshot`
  shape, the draft/published version lifecycle, restore-as-new-version semantics,
  session-version pinning, and the back-fill strategy.

## 10. Acceptance criteria

- [ ] Editing a published flow opens (or updates) a single `draft` version; a
      flow never has more than one `draft` at a time.
- [ ] Publishing promotes the open draft to `status = 'published'` with the next
      `version_number`, a complete snapshot, the publisher's id, and
      `published_at`.
- [ ] An optional change summary supplied at publish is stored and shown in the
      history list.
- [ ] A new chat records the flow's latest published `version_number` on
      `app_sessions.flow_version_id` at start and runs that snapshot.
- [ ] A publish or restore performed while a chat is in progress does **not**
      change the version that chat is running; the chat finishes on its pinned
      version.
- [ ] `flowVersion.list` returns history newest-first with number, status,
      author, date, and summary, and does **not** include the heavy snapshot
      payload.
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
- **Re-pinning / upgrading an in-progress chat** to a newer version mid-session.
  A chat completes on the version it started on; moving a live chat to a new
  version is a future enhancement.
- **Visual side-by-side diff** between two versions.
- **Per-save snapshot history** — only one open draft is kept per flow; the
  intermediate keystroke-level states are not retained as separate rows.
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
- **Restore / publish while sessions are active** — because each chat is pinned
  to the version it started on (`app_sessions.flow_version_id`), a restore or
  publish no longer changes the graph beneath a running session. The open
  question is the reverse: a long-lived chat may finish on an old version after
  the owner has published several newer ones. That is the intended v1 behaviour
  (stability over currency); a mid-session "upgrade" action is deferred (§11).
- **Resolving "latest published" atomically** — session start and publish race:
  a chat must pin to a single, consistent latest-published version even if a
  publish lands at the same moment. Resolve the latest published `version_number`
  and write `flow_version_id` within the session-create transaction.
- **Version-number concurrency** — two near-simultaneous publishes must not
  collide on `version_number`. The unique `(flow_id, version_number)` index
  forces a retry; allocate the next number inside the same transaction as the
  insert.
- **Back-fill correctness** — the migration must snapshot each published flow's
  *current* nodes/edges accurately; draft-only flows get no version until first
  publish.
