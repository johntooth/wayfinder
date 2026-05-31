# Phase — Flow Versioning / Change History

- **Status**: Sketched (awaiting `/doc-review`)
- **Target version**: TBD (bump: **MINOR** — new table, new domain entity, new
  port)
- **PRD**: `docs/development/prd/flow-versioning.prd.md`
- **ADR**: `docs/development/adr/015-flow-versioning-snapshots.adr.md`
- **Depends on**: v1.18.0 (flows, nodes, edges, `core_audit_log`)

## 1. Goal

Capture an **immutable snapshot** of a flow's full definition on every publish,
expose version history with read-only inspection, and allow non-destructive
restore (restore = create a new version from a past snapshot).

## 2. Approach

Snapshot-on-publish (ADR-015):

1. On publish, assemble a self-contained `FlowSnapshot` (`flow` + `nodes` +
   `edges`), allocate the next `version_number` per flow, and insert one
   `app_flow_versions` row — all in one transaction.
2. History lists are metadata-only (no heavy snapshot payload).
3. Restore rewrites the live flow/nodes/edges from a snapshot (preserving the
   captured node `id`s) and records a new version noting the source.
4. A migration back-fills `version_number = 1` for every already-published flow.

## 3. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow-version.ts` | New `FlowVersion` entity + `FlowSnapshot` value object. |
| domain | `packages/domain/src/ports/flow-version-repository.ts` | New `IFlowVersionRepository` (`create`, `listForFlow`, `getByNumber`, `latestNumber`). |
| application | `packages/application/src/use-cases/flows/publish-flow-version.ts` | Assemble snapshot, allocate number, persist (wraps existing publish). |
| application | `packages/application/src/use-cases/flows/list-flow-versions.ts` | History metadata, newest first. |
| application | `packages/application/src/use-cases/flows/get-flow-version.ts` | One full snapshot for read-only view. |
| application | `packages/application/src/use-cases/flows/restore-flow-version.ts` | Apply snapshot to live rows + create new version. |
| adapters | `packages/adapters/src/repositories/drizzle-flow-version-repository.ts` | Implements the port. |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | New `app_flow_versions` table. |
| adapters | `packages/adapters/drizzle/<next>.sql` | Migration: create table + unique index + back-fill published flows. |
| apps/web | `flowVersion` tRPC router (`list`, `get`, `restore`) | New router; extend `flow.publish` to take optional `changeSummary` and create a version. |
| apps/web | `/admin/flows/[id]`, `/flows/[id]/config` | Version-history panel: list, read-only view, restore. |
| apps/web | `apps/web/lib/container.ts` | Construct repository + use-cases. |

## 4. Database changes

### New table: `app_flow_versions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `flow_id` | uuid FK → `app_flows` | cascade delete, indexed |
| `version_number` | integer | monotonic per flow |
| `snapshot` | jsonb | full `{ flow, nodes, edges }` |
| `change_summary` | text | nullable |
| `published_by_user_id` | uuid FK → `core_users` | |
| `published_at` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Unique index on `(flow_id, version_number)`. Allocate the next number inside the
insert transaction.

**Back-fill:** insert `version_number = 1` for every `app_flows` row with
`status='published'`, snapshotting its current nodes/edges.

## 5. Implementation order (tests first)

1. `FlowVersion` / `FlowSnapshot` types; `app_flow_versions` schema + migration
   (incl. back-fill); repository test → repository.
2. `PublishFlowVersion` test (snapshot completeness, number allocation,
   concurrency retry) → use-case; extend `flow.publish`.
3. `ListFlowVersions` / `GetFlowVersion` tests → use-cases.
4. `RestoreFlowVersion` test (non-destructive, node-id preservation, new-version
   recorded) → use-case.
5. tRPC `flowVersion` router + canvas version-history panel.

Write the test file before each implementation file (CLAUDE.md rule).

## 6. ADR required

ADR-015 (written) — snapshot-on-publish vs. branching vs. change-log; snapshot
shape; restore-as-new-version; node-id preservation; back-fill.

## 7. Risks / open questions

Carried from PRD §12: snapshot storage growth, node-id preservation on restore,
restoring under active sessions (no session-version pinning in v1),
version-number concurrency, and back-fill correctness.

## 8. Acceptance criteria

Mirror PRD §10. At minimum:

- [ ] Publish creates a complete, numbered snapshot with publisher + optional
      summary.
- [ ] `flowVersion.list` is metadata-only, newest first; `flowVersion.get`
      returns exact captured definition read-only.
- [ ] `flowVersion.restore` rewrites live rows from the snapshot, preserves node
      ids, and records a new version; no prior snapshot mutated/deleted.
- [ ] Migration back-fills version 1 for every published flow.
- [ ] `flow.version.published` / `flow.version.restored` audit events written.
- [ ] No ORM import outside `packages/adapters`.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.
