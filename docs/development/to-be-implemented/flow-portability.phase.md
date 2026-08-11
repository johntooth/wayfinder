# Phase — Flow Portability (Export / Import / Duplicate)

- **Status**: Draft — awaiting `/doc-review`
- **Target version**: **TBC** — **MINOR** (new feature, **no schema change**).
  The number is allocated at `/doc-review` against whichever line the build is
  scheduled on.
- **Base branch**: **TBC.** `CLAUDE.md` routes new features to `main`; these docs
  were authored on `release/alpha-2` at the requester's direction. Settle the
  line before building, and set the version and the `implemented/<line>/`
  destination from it.
- **PRD**: `docs/development/prd/flow-portability.prd.md`
- **ADR**: `docs/development/adr/049-flow-export-archive-format.adr.md`
- **Depends on**: ADR-015 (`FlowSnapshot` — the serialisation this reuses),
  ADR-006 (flow schema), ADR-031 (skills library), ADR-032 (MCP flags and
  transport), ADR-033 (audit log), `IObjectStorage` (assets), ADR-018 (approval
  nodes — already portable, no user id baked in)

## 1. Problem

A flow cannot leave the database it was authored in — there is no export,
import, clone or duplicate anywhere in the product. A customer cannot promote a
flow from staging to production, nothing can ship with the product (every install
begins at a blank canvas by design, `wayfinder.prd.md` §4), and a flow cannot be
backed up or reviewed outside a database client.

The serialisation, however, already exists: `FlowSnapshot`
(`packages/domain/src/entities/flow-version.ts`) is a self-contained frozen copy
of a flow's full definition, exercised on every publish and restore. What it
lacks is the binaries — `FlowContextDoc.storagePath` and
`ConversationalNodeConfig.documentTemplatePath` point into object storage, and
`documentTemplateContent` is only the extracted text — and id-free references,
since `skillRefs` and `McpToolRef.serverId` mean nothing on another deployment.

See the PRD for full detail.

## 2. Goals

- Export a flow as one `.zip`: manifest **plus** its templates and context
  documents.
- Import that archive into another deployment and get a working draft flow with
  nothing to re-upload.
- **Inspect before commit** — the dependency report is shown before any row is
  written.
- Unresolved dependencies degrade to a flagged draft, never a silent drop and
  never a refusal.
- Duplicate a flow in place with no file round-trip.
- Never export instance data of any kind.

## 3. Non-goals

Updating/merging an existing flow from an archive, a hosted gallery or
marketplace, exporting instance data, bundling KB collection contents, signing or
verifying archives, bulk export/import. (PRD §4.)

## 4. Approach

Per ADR-049. The archive is `manifest.json` + `assets/`; the manifest embeds
`FlowSnapshot` **verbatim** so new node types and config fields stay portable
without touching this feature. Dependencies export by stable name and resolve on
import. Import is two operations — `inspect` writes nothing, `import` commits.

The archive is **untrusted input**: no path inside it is ever used as a write
path (assets are re-keyed by the importer, making zip-slip structurally
impossible), ceilings are enforced before extraction, and every asset's `sha256`
is verified.

Build bottom-up (domain → application → adapters → web), test file before
implementation file (`CLAUDE.md`). The zip library must be **verified in
`node_modules`** for its real API and its streaming/size-limit support before
step 5 — `CLAUDE.md` forbids relying on training data for third-party API shapes.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow-export.ts` | new — `FlowExportManifest`, `FlowExportAsset`, `FlowExportDependency`, `FlowImportInspection`, `FLOW_EXPORT_FORMAT_VERSION` |
| domain | `packages/domain/src/entities/flow-export-manifest.ts` | new — pure `validateManifest(unknown)` and `migrateManifest(manifest)` (older supported versions forward; newer refused) |
| domain | `packages/domain/src/entities/flow-export-dependencies.ts` | new — pure `collectDependencies(snapshot)`: walks node config for `skillRefs`, `allowedMcpToolRefs`, KB refs |
| domain | `packages/domain/src/entities/flow-import-rewrite.ts` | new — pure `rewriteSnapshot(snapshot, resolution)`: regenerates node ids, rewrites edges, points config at local ids, flags unresolved |
| domain | `packages/domain/src/ports/flow-archive.ts` | new — `IFlowArchiveWriter.write(manifest, assets)`, `IFlowArchiveReader.read(bytes)` with the ceilings as input |
| domain | `packages/domain/src/entities/flow-version.ts` | **unchanged** — `FlowSnapshot` reused as-is |
| application | `packages/application/src/use-cases/flow/export-flow.ts` | new — authorise, build the snapshot, collect dependencies, stream assets from `IObjectStorage`, emit `flow.exported` |
| application | `packages/application/src/use-cases/flow/inspect-flow-import.ts` | new — read + validate + resolve; **writes nothing** |
| application | `packages/application/src/use-cases/flow/import-flow.ts` | new — rewrite, store assets under fresh keys, create the flow as `draft`, emit `flow.imported` |
| application | `packages/application/src/use-cases/flow/duplicate-flow.ts` | new — in-place clone; copies assets rather than sharing keys |
| adapters | `packages/adapters/src/flows/zip-flow-archive.ts` | new — implements both archive ports; the only place the zip library appears |
| adapters | `packages/adapters/src/flows/dependency-resolver.ts` | new — resolve skill names and MCP server+tool names to local ids |
| web | `apps/web/src/server/routers/flow.ts` | add `export`, `inspectImport`, `import`, `duplicate` — permission-gated |
| web | `apps/web/src/app/api/flows/[id]/export/route.ts` | new — archive download (binary, not tRPC) |
| web | `apps/web/src/app/api/flows/import/route.ts` | new — archive upload, size-capped |
| web | `apps/web/src/components/flows/flow-import-dialog.tsx` | new — file picker → inspection panel → commit |
| web | `apps/web/src/components/flows/flow-row-actions.tsx` | Export / Duplicate actions on flow rows |
| web | `apps/web/src/components/canvas/*` | Export on the canvas toolbar; warning badge on nodes with unresolved dependencies |
| web | `apps/web/src/lib/container.ts` | wire the archive adapter, resolver and four use-cases |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — manifest types and validation.** Write
   `flow-export-manifest.test.ts` **first**: (a) a well-formed manifest
   validates; (b) a missing/extra/mistyped field fails with an actionable
   message; (c) `formatVersion` greater than `FLOW_EXPORT_FORMAT_VERSION` is
   refused with **both** versions named; (d) an older supported version migrates
   forward. Then implement. Domain stays dependency-free.

2. **Domain — dependency collection.** `flow-export-dependencies.test.ts`:
   `skillRefs` on multiple nodes collapse to one dependency listing all
   `nodeIds`; `allowedMcpToolRefs` produce `{ kind: "mcp_tool", name, toolName }`;
   a flow with no external references produces an empty list; approval nodes
   contribute nothing (no user ids exist to carry).

3. **Domain — import rewrite.** `flow-import-rewrite.test.ts`: (a) every node id
   is regenerated and no original id survives; (b) every edge is rewritten and
   none is orphaned; (c) a resolved dependency rewrites node config to the local
   id; (d) an unresolved one leaves the node flagged and the config's stale
   reference cleared, not left dangling; (e) the rewrite is pure — the input
   snapshot is not mutated.

4. **Application — export.** `export-flow.test.ts`: (a) the manifest embeds the
   snapshot verbatim; (b) every referenced template and context doc appears as an
   asset with a matching `sha256`; (c) **no** session, message, document,
   approval or step-output data appears anywhere in the output — assert over the
   whole payload; (d) a non-owner non-admin gets `FORBIDDEN`; (e) `flow.exported`
   is emitted to the audit logger.

5. **Adapters — the archive.** *Verify the zip library in `node_modules` first
   and record the choice in this doc.* `zip-flow-archive.test.ts`: round-trips a
   manifest and assets; **rejects an entry whose path escapes the archive root**
   (`../`); enforces archive size, uncompressed size, asset count and per-asset
   size ceilings **before** extraction; a malformed zip and a missing manifest
   each return a Result error rather than throwing; an asset whose `sha256`
   mismatches fails and its bytes are not returned.

6. **Application — inspect.** `inspect-flow-import.test.ts`: (a) returns
   resolved and unresolved dependencies correctly; (b) **writes no row and no
   object** — assert counts before and after; (c) a refused `formatVersion`
   surfaces as a Result error, not an inspection; (d) ambiguous name resolution
   (two skills sharing a name) is reported as a warning.

7. **Application — import.** `import-flow.test.ts`: (a) always creates a new
   flow, owned by the importer, `status: "draft"`; (b) no existing flow is
   modified by any import; (c) assets are stored under **freshly generated
   keys**, never a path from the archive; (d) an archive with unresolved
   dependencies still imports, with the flow not publishable until resolved;
   (e) `flow.imported` is emitted.

8. **Application — duplicate.** `duplicate-flow.test.ts`: independent draft copy,
   suffixed name, fresh node ids, its own asset copies; deleting the original's
   template leaves the copy's intact.

9. **Web — routes and tRPC.** Binary download and upload route handlers (upload
   size-capped at the edge, before the archive reader sees it); `flow.export`,
   `flow.inspectImport`, `flow.import`, `flow.duplicate`. Router tests cover the
   authorisation boundary on each.

10. **Web — UI.** Import dialog: file picker → inspection panel (flow name,
    description, node count, asset list, resolved/unresolved dependency table) →
    commit. Export and Duplicate on flow rows; Export on the canvas toolbar.
    Warning badges on imported nodes with unresolved dependencies.

11. **Version + validate.** Set `VERSION` and root `package.json#version` to the
    number allocated at `/doc-review`. Run `./validate.sh`; fix all failures.
    Move this doc to `docs/development/implemented/<line>/v<version>/` with an
    implementation summary.

## 7. Acceptance criteria

Mirror PRD §10. In particular:

- [ ] Export produces a `.zip` of `manifest.json` + `assets/`; the manifest
      validates and embeds `FlowSnapshot` verbatim.
- [ ] Every referenced template and context doc is bundled with a matching
      `sha256`.
- [ ] No instance data of any kind appears in an archive — asserted over the
      whole payload.
- [ ] Dependencies export by name; no local skill or MCP server id appears in a
      manifest.
- [ ] `inspectFlowImport` writes no row and no object.
- [ ] Unresolved dependencies import as a flagged draft that cannot be published
      until resolved.
- [ ] Import always creates a new flow; no existing flow is ever modified.
- [ ] Node ids are regenerated, edges rewritten, none orphaned.
- [ ] **Zip-slip is impossible** — a `../` entry is rejected, and no archive path
      is used as a write path.
- [ ] Size, count and per-asset ceilings are enforced before extraction.
- [ ] A newer `formatVersion` is refused naming both versions; an older supported
      one migrates forward.
- [ ] Malformed zip, missing manifest and invalid manifest each return an
      actionable Result error — never a throw across a boundary.
- [ ] Export is owner/admin only and audited; import is audited.
- [ ] Duplicate produces an independent copy with its own assets.
- [ ] Round trip into a clean deployment with the same skills and MCP servers
      yields an equivalent snapshot modulo regenerated ids.
- [ ] The zip library appears only in `packages/adapters`; ports in `domain`;
      Result at every boundary; `VERSION` = `package.json#version`;
      `./validate.sh` passes.

## 8. Risks / open questions

Carried from PRD §12:

- **Import is the largest untrusted-input surface in the product.** Zip-slip,
  decompression bombs, oversized assets and manifest drift. ADR-049 §7 is the
  mitigation and its guards are acceptance criteria above, not implementation
  detail.
- **Export is a new exfiltration path** — prompt IP, skills and whole context
  documents in one click. Open: whether export warrants a permission distinct
  from flow edit.
- **`formatVersion` discipline** — the refuse-newer policy only works if the
  version is incremented honestly and read-side migrations are maintained from
  the first release.
- **Asset size** — ceilings are required and their defaults are unconfirmed;
  both sides need streaming rather than buffering.
- **Name collisions** — two skills sharing a name, or two MCP servers exposing
  the same tool name, make resolution ambiguous. Open: reject as ambiguous, or
  take the most recently updated and warn. Step 6(d) reports it either way.
- **Zip library choice** — verify in `node_modules` at step 5 and record the
  decision here before writing the adapter.
- **Duplicate copies assets** rather than sharing keys, so storage grows per
  duplicate. Accepted: shared keys would let one flow's template deletion corrupt
  another's.

## 9. Approved change summary

Recorded per the `/new-feature` lifecycle; approved 2026-08-11.

**Headline.** A flow's definition exports as a portable `.zip` — a JSON manifest
plus the uploaded templates and context documents — then imports into another
deployment or clones in place. The manifest reuses the existing `FlowSnapshot`
shape (ADR-015), so the serialisation already exists and is already proven by
versioning. Import is inspect-then-commit: the archive is opened and reported on
— what resolves, what does not — before a single row is written.

- **Goal** — staging-to-production promotion, shippable starter flows, in-place
  duplication, and a flow definition reviewable outside the database.
- **Business rules** — definition only, never instance data; references export by
  stable name; unresolved references degrade to a flagged draft; import always
  creates a new draft flow owned by the importer; node ids regenerated and edges
  rewritten.
- **UI** — Export/Duplicate on flow rows and the canvas; an Import dialog whose
  inspection panel precedes any write; warning badges on unresolved nodes.
- **Data** — `FlowExportManifest`, `FlowExportAsset`, `FlowExportDependency`,
  `FlowImportInspection`, `IFlowArchiveReader` / `IFlowArchiveWriter`.
- **Database** — none.
- **Risks** — untrusted-archive handling (zip-slip, bombs, drift); export as an
  exfiltration path; `formatVersion` discipline; asset size; name collisions.
- **Out of scope** — merging into an existing flow, a marketplace, instance data,
  KB contents, signed archives.
