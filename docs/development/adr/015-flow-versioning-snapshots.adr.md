# ADR-015 — Flow Versioning via Immutable Snapshots

- **Status**: Proposed (Phase 6+; scoped by `flow-versioning.prd.md`)
- **Date**: 2026-05-31

## Context

`flow-versioning.prd.md` adds history and rollback to flows, which are mutable
in place today with no record of prior state. We must choose how a "version" is
represented and stored. Three models were considered:

- **A — Immutable snapshot on publish.** Each publish writes a complete, frozen
  copy of the flow definition (`flow` + `nodes` + `edges` + configs) as one row.
- **B — Full version branching.** Flows carry `version_number` + `parent_flow_id`;
  versions form a tree; sessions pin to a version.
- **C — Field-level change-log.** Record diffs (who/what/when) to a changes
  table; reconstruct state by replaying diffs.

Wayfinder's flow definition is already a small, self-contained set of `app_*`
rows with `jsonb` node config (ADR-006), and the product need is "see what it
was, and roll back" — not concurrent divergent development.

## Decision

Adopt **Option A — immutable snapshot on publish.**

### Snapshot shape

A version stores a self-contained `FlowSnapshot` as `jsonb`:

```ts
export interface FlowSnapshot {
  flow: FlowSnapshotMeta;   // name, description, icon, expertRole, contextDocs, ...
  nodes: FlowNode[];        // full config per node
  edges: FlowEdge[];
}
```

Because the snapshot is complete and frozen, a version survives any later edit
or deletion of the live rows. No joins to reconstruct history; no diff replay.

### Table

`app_flow_versions` (id, flow_id, version_number, snapshot jsonb,
change_summary, published_by_user_id, published_at, created_at, updated_at) with
a unique index on `(flow_id, version_number)`. The next number is allocated and
inserted in the **same transaction** as the publish so concurrent publishes
cannot collide.

### Restore semantics

Restore is **non-destructive and forward-only**: applying version N rewrites the
live `app_flows` / `app_flow_nodes` / `app_flow_edges` to match the snapshot
**and** creates a *new* version (N+1) whose summary records "restored from
version N". No snapshot row is ever mutated or deleted. History therefore always
moves forward, even for rollbacks.

Restore **preserves the original node `id`s** captured in the snapshot rather
than regenerating them, so any `current_node_id` reference held by a session
still resolves after a restore.

### Back-fill

A migration inserts a `version_number = 1` snapshot for every existing
`status='published'` flow, so history is complete from day one. Draft-only flows
get no version until their first publish.

### Why not branching (B)

Branching solves concurrent divergent flow development and per-session version
pinning — neither is a v1 need. It adds a version tree, parent pointers, and
merge questions that the product does not require yet. Snapshots do **not**
preclude branching later; a `parent_version_id` column could be added if the
need appears.

### Why not change-log (C)

Field-level diffs are the most storage-efficient but the most complex to read,
restore, and reason about (replay ordering, partial-apply failures). The
existing `core_audit_log` already captures *that* a flow changed and by whom;
duplicating a full structured diff store is not worth it when whole-snapshot
restore is the actual requirement.

## Consequences

**Positive**

- Trivial, reliable restore: load a snapshot, write it back. No replay.
- A version is fully self-contained and immutable — strong audit guarantees.
- Composes directly from existing `app_*` shapes; no schema reshaping.
- Does not foreclose branching or session-pinning as future enhancements.

**Negative**

- Each publish duplicates the full definition as `jsonb`; storage grows with
  publish count. Acceptable at expected flow sizes; a retention/pruning policy
  is deferred (PRD §11).
- Restoring under active sessions can shift the graph beneath a running session,
  because v1 does not pin sessions to versions. Documented as a limitation;
  session-version pinning is the recommended follow-up.

## Open questions

- **Session-version pinning** — should an in-progress session continue on the
  snapshot it started on? Enabled by this model; deferred to a follow-up phase
  (PRD §11/§12).
- **Retention** — cap the number of retained snapshots per flow, or keep all?
  Defer until storage is measured.
