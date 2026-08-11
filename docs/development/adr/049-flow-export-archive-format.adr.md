# ADR-049 — Flow Portability: A Zip Archive Around the Existing Snapshot

- **Status**: Proposed (scoped by `flow-portability.prd.md`)
- **Date**: 2026-08-11
- **Builds on**: ADR-015 (flow versioning snapshots — the serialisation this
  reuses rather than reinvents), ADR-006 (flow schema), ADR-031 (skills library),
  ADR-032 (MCP flags and transport — the tool references an archive must carry),
  ADR-033 (immutable audit log — export is an audited event)

## Context

A flow cannot leave the database it was authored in. There is no export, import,
clone or duplicate anywhere in the codebase. Three consequences follow.

A customer with a staging environment cannot promote a flow to production. They
must rebuild it on the production canvas by hand and hope the two match —
unacceptable for the regulated deployments this product targets, all of which
have a change-control process that assumes artefacts move between environments.

Nothing can ship with the product. `wayfinder.prd.md` §4 states the design
intent plainly — "no seeded AU Gov Procurement flow… flow owners create and
configure flows manually via the admin canvas" — so every install begins at a
blank canvas, and the reference procurement flow exists only as loose `.docx`
files in `docs/templates/`. The most valuable asset the product could ship is
currently unshippable.

And a flow cannot be backed up, diffed, or reviewed outside a database client.

The serialisation problem, however, is already solved. Flow versioning stores a
self-contained frozen copy of a flow's full definition:

```typescript
export interface FlowSnapshot {
  kind?: FlowType;
  flow: FlowSnapshotMeta;
  nodes: FlowSnapshotNode[];
  edges: FlowSnapshotEdge[];
  extraction?: ExtractionSchema;
}
```

— `packages/domain/src/entities/flow-version.ts`

It is deliberately stripped of row lifecycle state ("a snapshot records the
*definition*, not the row's lifecycle state") and it is exercised on every
publish and restore. It is the right payload; what it lacks is everything around
it.

Two gaps make a bare snapshot non-portable:

**Binaries live elsewhere.** `FlowContextDoc.storagePath` points into object
storage, and `ConversationalNodeConfig.documentTemplatePath` does the same for
uploaded `.docx`/`.xlsx` templates. `documentTemplateContent` holds only the
*extracted text*, used for prompting and reindexing — not the file. A flow whose
templates do not travel is a flow that generates nothing on arrival.

**Ids do not survive the trip.** `skillRefs` holds `app_skills` ids;
`McpToolRef` holds `{ serverId, toolName }`. Neither id means anything on
another deployment. Approval nodes, by contrast, are already portable —
`ApproverSourceMode` is `first_level_supervisor | second_level_supervisor |
dynamic`, resolved from the directory at runtime, so no user id is baked in.

## Decision

### 1. The unit of exchange is a zip archive, not a JSON file

```
<flow-name>-<version>-<date>.zip
  manifest.json
  assets/
    <asset-id>            # opaque, manifest-assigned
    <asset-id>
```

`manifest.json` carries a `FlowExportManifest`; `assets/` carries the raw
template and context-document bytes. Base64-inlining the binaries into a single
JSON was the alternative, and it fails on the thing it would have bought: a
manifest with a megabyte of base64 in it is no more diffable than a zip, while
being larger, slower, and forcing the whole payload through memory.

### 2. The manifest embeds `FlowSnapshot` verbatim

The manifest wraps rather than replaces:

```typescript
export interface FlowExportManifest {
  formatVersion: number;
  exportedAt: string;
  exportedFrom: { appVersion: string };
  snapshot: FlowSnapshot;
  dependencies: FlowExportDependency[];
  assets: FlowExportAsset[];
}
```

Reusing the snapshot means node config, edges, extraction schemas and every
future node type are carried without this feature knowing they exist. A new field
on `ConversationalNodeConfig` travels the day it is added, with no change here —
which is the property that keeps an export format from rotting.

### 3. External references export by stable name and resolve at import

`dependencies` records what the flow needs from its host deployment, keyed by
something that means the same thing on both sides:

```typescript
export interface FlowExportDependency {
  kind: "skill" | "mcp_tool" | "kb_collection";
  name: string;
  toolName?: string;
  nodeIds: string[];
}
```

Skills resolve by `Skill.name`, MCP tools by server name plus `toolName`. On
import each dependency is looked up; the node config is rewritten to point at the
local id where one is found.

### 4. Unresolved dependencies degrade; they do not block

An archive whose dependencies do not all resolve still imports. The flow lands as
**draft**, the unresolved references are listed on the inspection panel, and the
affected nodes are badged on the canvas.

Refusing the import would be the strict reading and the wrong one: a flow is
mostly steps, prompts and templates, and an author who is missing one MCP server
still wants the other nineteen nodes. What matters is that the gap is loud —
never a silent drop, and never a publishable flow with a dangling reference.

### 5. Import is inspect-then-commit

Two operations, not one. `inspectFlowImport` opens the archive, validates the
manifest, resolves dependencies and returns a `FlowImportInspection` **without
writing anything**. `importFlow` then commits.

The user is being asked to accept an artefact from another system into theirs.
Showing them what it contains and what will not resolve, before any row exists,
is the difference between an import and a surprise.

### 6. An import always creates a new flow

The imported flow is new, owned by the importer, and always `draft` — never
published, never merged into an existing flow. Node ids are regenerated and edges
rewritten against them in the same pass.

Updating an existing flow in place was considered and rejected in Decision 8. The
consequence is accepted deliberately: an archive is a way to *place* a flow, not
to patch one.

### 7. The archive is untrusted input

An imported archive is user-supplied data from an unknown source, and it is
handled as such:

- **No path in the archive is ever used as a write path.** Assets are addressed
  by manifest-assigned id; the importer re-keys every asset into object storage
  under its own generated path. Zip-slip is structurally impossible rather than
  defended against.
- **Ceilings before extraction**: maximum archive size, maximum uncompressed
  size, maximum asset count, maximum single-asset size. Exceeding any is a
  `VALIDATION_FAILED` Result, refused before extraction.
- **`sha256` per asset** in the manifest, verified on read; a mismatch fails the
  import rather than storing the bytes.
- **Manifest schema-validated** before any field is read.
- Every asset's `mimeType` is checked against the kinds the app accepts.

### 8. `formatVersion` is an integer with a strict policy

An archive whose `formatVersion` exceeds what this deployment supports is
**refused** with a message naming both versions. Older versions within the same
major are accepted and migrated forward on read.

Refusing forward-incompatible archives is the point: a deployment that
half-understands a newer manifest imports a flow that is quietly missing whatever
it did not recognise, and the author has no way to know.

### 9. Export is permission-gated and audited

Export is restricted to the flow's owner or an admin, and emits an audit event
via `IAuditLogger`. An archive contains `aiInstruction` text, applied skills and
whole context documents — for the customers this product targets, that is
organisational IP leaving the building in one click, and it belongs in
`core_audit_log`.

## Alternatives considered

**Single JSON file with base64 assets.** Rejected — see Decision 1.

**Snapshot-only export, templates re-uploaded by hand.** Rejected: the templates
*are* the flow's output. An import that generates nothing until an author
re-uploads eight `.docx` files has not moved the flow.

**Directory-of-files export, git-style.** Attractive for diffing and rejected for
delivery: a browser download is one file, and an operator moving a flow between
environments is not necessarily using git.

**Match flows across deployments by id and update in place.** Rejected: ids are
per-deployment, so the match is unreliable; and a successful match makes import a
destructive operation against an existing flow with live sessions pinned to its
published versions.

**Bundle referenced KB collections' contents.** Rejected for this format: a
collection can be arbitrarily large and is usually a deployment-wide asset rather
than a property of one flow. Collections are referenced by name and reported as
dependencies.

## Consequences

**Good**

- The serialisation is inherited from a mechanism already proven by publish and
  restore, so node types and config fields stay portable as they are added.
- Staging-to-production promotion, in-place duplication and shippable starter
  flows are one format and one import path.
- The inspection step makes a partial import a deliberate choice rather than a
  discovery made later on the canvas.
- No schema change: export reads existing tables and object storage, import
  writes through existing repositories.

**Bad / accepted**

- Import parses a user-supplied archive, which is the largest untrusted-input
  surface in the product. Decision 7 is the mitigation and its guards are
  acceptance criteria, not implementation detail.
- Regenerating node ids means an archive can never update an existing flow.
- `formatVersion` must be maintained honestly from the first release, including
  the read-side migrations, or Decision 8's refusal becomes a false alarm.
- An export is an exfiltration path that did not previously exist. Gating and
  auditing narrow it; they do not remove it.
