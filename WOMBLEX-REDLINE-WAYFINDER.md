# Womblex → Redline → Wayfinder

**A provenance-preserving pipeline for assembling structured reports from
unstructured documents.**

- **Status**: Architecture note / planning input. Not a phase doc.
- **Date**: 2026-08-20
- **Scope**: Wayfinder only. Womblex and Redline are treated as external systems
  with fixed contracts — this document contains **no build items for either**.
- **Audience**: whoever runs `/new-feature` next. This note exists to make that
  run cheap: it fixes the boundaries, names what Wayfinder already has, and
  isolates the delta.

---

## 1. The three systems

| System        | Responsibility                                                                                                                                     | Hard boundary                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Womblex**   | Ingests unstructured data; persists rich structured assets — elements, chunks, table cells, form fields, graph edges — as Parquet and/or Postgres. | Source of truth. No LLM generation, no report assembly. Produces high-fidelity, **versioned** data assets.                             |
| **Redline**   | A strict read-only MCP gateway over Womblex outputs. Exposes tools for schema discovery and verbatim retrieval.                                    | **No LLM data generation.** Returns byte-identical source text and structures only. Headless, stateless, refuses to paraphrase.        |
| **Wayfinder** | The human-in-the-loop orchestrator: the UI where an LLM assists a person to assemble a structured report, and the governance layer around it.      | Owns UI, user intent, workflow state, audit, and export. Delegates **all** source-data fetching to Redline. Never invents source data. |

The guarantee the three make together: **Womblex extracts it, Redline serves it
verbatim, Wayfinder orchestrates the human-guided assembly and export.** Every
cell in a finished report traces back to a specific Womblex element on a specific
document, and that trace is auditable.

---

## 2. Wayfinder's specific role

This is the part that matters for this repo. Wayfinder is **not** the extractor
and **not** the data gateway. In this pipeline it is exactly four things:

### 2.1 The human-in-the-loop surface

The AI does not decide the report's shape on its own. When it needs a schema —
"what columns should this report have?", "what does this field mean?" — it stops
and asks the operator through a **rendered form in the chat**, not through prose.
The human names the column, defines the field, sets the type. That answer becomes
the query contract against Redline.

This is Wayfinder's existing positioning applied to a new job: a procurement
officer, HR manager, or ops lead drives a document-heavy process without writing
code or prompts (see **Wayfinder — Product Positioning** in `CLAUDE.md`).

### 2.2 The orchestrator of the loop, not the holder of the corpus

Five hundred documents do not fit in a context window, and Redline must never be
asked to return five hundred documents' worth of text in one call. Wayfinder owns
the iteration: navigate → fetch a narrow verbatim slice → record it against its
source → move to the next document. Redline is the paginated catalogue and
retrieval system; Wayfinder is the notebook that accumulates.

### 2.3 The provenance enforcer at the point of assembly

Redline guarantees verbatim **on the wire**. That guarantee is worthless if
Wayfinder pipes the response through a model that summarises it before it reaches
the report. Wayfinder must carry Redline's bytes through to the cell, and persist
the `(document, element, offset)` reference alongside the value. **§5.1 is the
single most important item in this document** — the current MCP path breaks this.

### 2.4 The governance and egress layer

Audit logging, confidence display, human review gates, spend metering, retention,
and export. Everything that already wraps Wayfinder's guided sessions and
extraction runs applies here unchanged, plus a CSV egress path that does not yet
exist.

### What Wayfinder must **not** do here

- Never paraphrase, normalise, or "clean up" a value Redline returned and still
  present it as source data. A derived value is allowed only if it is labelled as
  derived and its source snippet is retained beside it.
- Never fetch Womblex data by any route other than Redline's MCP tools. No direct
  DB connection to Womblex from `apps/*` or `packages/adapters`.
- Never write to Womblex. The pipeline is one-directional.
- Never treat Redline's schema output as stable across Womblex versions — schema
  is discovered at runtime, per document set, not compiled in.

---

## 3. What Wayfinder already has

Most of this pipeline is already built. The reuse map, with real paths:

| Capability                                                          | Where it lives                                                                                                                          | State                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Remote MCP client (SSE + streamable-HTTP), admin-registered servers | `packages/domain/src/entities/mcp-server.ts`, `packages/adapters/src/mcp/`, `apps/web/src/app/(admin)/admin/mcp-servers/`               | Built. Redline registers here with no new plumbing.                            |
| Deny-by-default tool allowlisting per step                          | `selectAllowedTools` in `packages/adapters/src/mcp/mcp-tool-prepass.ts`                                                                 | Built.                                                                         |
| MCP as a first-class flow node type                                 | `FlowNodeType = … \| "mcp"` (`packages/domain/src/entities/flow-node.ts`), `packages/application/src/use-cases/session/run-mcp-node.ts` | Built. Returns **raw** tool output — the verbatim-safe path.                   |
| Conversational tool loop during a chat turn                         | `McpToolPrepass` + `apps/web/src/app/api/chat/[sessionId]/stream/mcp-turn-helpers.ts`                                                   | Built, but **paraphrases** — see §5.1.                                         |
| Tool-call audit records                                             | `McpToolCallRecord` (`mcp-server.ts`), persisted per turn                                                                               | Built. Result truncated at 4,000 chars (`AUDIT_RESULT_MAX_CHARS`).             |
| Batch processing of N documents against a fixed schema              | ADR-033 extraction flows: `app_extraction_runs` / `_documents` / `_records`, in-process poller in `apps/api`                            | Built. This is the 500-document engine — see §6.                               |
| Results grid with source-document linking                           | `apps/web/src/components/extraction/result-grid.tsx`, `run-results.tsx`; `source_document_ids` on each record                           | Built.                                                                         |
| Structured field vocabulary (name, type, required, constraints)     | `TemplateField`, structured-conversation editor (`docs/development/prd/structured-conversation.prd.md`)                                 | Built. The schema-form vocabulary already exists — it just isn't AI-triggered. |
| Per-field confidence, rationale, human review gate                  | `fields jsonb` on `app_extraction_records`; pre-generation confidence gate                                                              | Built.                                                                         |
| Export: XLSX + JSON                                                 | `apps/web/src/app/api/synthesise/runs/[runId]/artifacts/[artifact]/route.ts`, `packages/adapters/src/exports/xlsx-writer.ts`            | Built. **No CSV** — see §5.3.                                                  |
| CSV writing precedent (pure, domain-level, unit-tested escaping)    | `toAuditCsv` in `packages/domain/src/entities/audit-export.ts`                                                                          | Built. Reuse the escaping, don't add a CSV library.                            |
| Spend metering, quotas, retention, audit                            | Decorated `ILanguageModel`; ADR-026/031; retention sweep                                                                                | Built, applies automatically.                                                  |

**Consequence: this is an integration and a UI feature, not a new subsystem.** No
new infrastructure, no new dependency on an MCP SDK (`@modelcontextprotocol/sdk`
is already in `packages/adapters/package.json`), no new job runner.

---

## 4. The contract Wayfinder consumes from Redline

Stated here as a **consumer expectation**, so Wayfinder can be designed against
it. Building it is Redline's work, not this repo's.

- **Discovery** — a tool that returns the available document sets and, for a
  given one, its dynamic column headers and types (`get_schema`). Wayfinder
  treats the response as data, never as a compiled type.
- **Navigation** — a tool that lists documents as **metadata only** (id, title,
  page count, pre-extracted entity names). Cheap enough to scan a corpus without
  reading a byte of body text.
- **Verbatim retrieval** — a tool that returns byte-identical text/cells for a
  given document id plus element/chunk reference (`get_verbatim_data`), and its
  paginated sibling for walking a document's elements. Every response carries the
  reference needed to cite it back.
- **Pagination is mandatory.** Wayfinder assumes every retrieval tool is bounded
  and pages; it will not request a whole corpus in one call.
- **Determinism.** The same reference returns the same bytes. Wayfinder caches on
  that assumption and cites on it.

If any of these are missing or renamed, Wayfinder's failure mode is a clear
error, not a silent fallback to model-generated text.

---

## 5. The delta — what Wayfinder must build

Five workstreams. Ordered by dependency; §5.1 gates everything else.

### 5.1 A verbatim tool-result channel _(blocking, do first)_

**The problem.** `McpToolPrepass.run()` executes the tool loop with
`generateText(...)` and returns `summary: result.text.trim()`
(`packages/adapters/src/mcp/mcp-tool-prepass.ts:173`). What reaches the turn's
context is a **model's prose account** of what the tools said — a paraphrase.
Routing Redline through this path destroys the byte-identical guarantee at the
first hop inside Wayfinder, and no amount of strictness on Redline's side can
recover it.

**What's needed.**

- A verbatim path that carries tool results into the turn **unmodified**,
  alongside (not instead of) the existing summarising pre-pass. The MCP _node_
  path already does this — `run-mcp-node.ts` returns `called.data.output` raw —
  so the shape exists; it needs to be available to a conversational turn.
- A per-server or per-tool flag marking a server as **verbatim-only**, so
  Redline's results can never be routed through the summarising path by
  misconfiguration. Server-enforced, not a UI convention.
- Verbatim payloads must not be truncated on the way to the report cell. The
  4,000-char `AUDIT_RESULT_MAX_CHARS` cap is an _audit-record_ budget; the value
  that populates a cell needs its own handling (store the reference, re-fetch on
  demand, or store the snippet at full fidelity).
- Decide where verbatim results are held — a turn-scoped store, `SessionStepOutput`,
  or an extraction record field — and make the `(document, element, offset)`
  reference a first-class part of that shape, not a string glued into the value.

This is the one item that needs an ADR of its own.

### 5.2 AI-driven form fields in chat

When the AI needs the human to define part of the report schema, it calls a tool
(e.g. `request_schema_definition`); Wayfinder intercepts it and renders an
interactive form in the message stream instead of streaming prose. The human
fills it, and the submitted schema becomes the argument set for Redline queries.

- Renders in the message feed (`apps/web/src/components/chat/message-feed.tsx`),
  as a card in the same family as `confirm-step-card.tsx` / `approval-gate.tsx`.
- Field vocabulary is the **existing** `TemplateField` one (name, type, required,
  min/max, options) — the structured-conversation editor already speaks it. Do
  not invent a second field language, and do not add a JSON-schema form library;
  the repo has `zod` + shadcn-style primitives in `apps/web/src/components/ui/`.
- The turn must **suspend** on the form and resume with the human's answer. Model
  this on the existing gate patterns (approval gate, step confirmation), not on a
  free-floating modal.
- The submitted schema is workflow state and must be persisted and audited — it
  is the definition of what the report claims to be.

### 5.3 CSV export

Today the run artifacts are `export-xlsx` and `export-json`
(`apps/web/src/app/api/synthesise/runs/[runId]/artifacts/[artifact]/route.ts`).
Add `export-csv`:

- Pure shaping + escaping in `packages/domain` following `toAuditCsv` — same
  quoting rules, unit-tested independently of HTTP and storage. No new library.
- Wire the artifact key, MIME (`text/csv`), and filename in the same route; add
  the button in `run-results.tsx` beside "Download Excel".
- Keep the run-ownership/permission check on the new artifact (§9 of ADR-033 —
  the v1.59.0 IDOR precedent applies to every run-artifact endpoint).
- Emit the same data-egress audit event the XLSX export emits.
- Decide whether the CSV carries provenance columns (source document, element
  ref) or ships values only. **Recommendation: include them**, since a CSV that
  loses its provenance is exactly what this architecture exists to prevent.

### 5.4 Registering and classifying Redline

- Redline is registered through the existing admin surface at
  `/admin/mcp-servers` — transport, URL, credential ref. No new admin screen.
- **Decision required.** `McpServer.communicatesExternally = true` means a server
  is registered but **cannot be selected in flows**: `run-mcp-node.ts:85` rejects
  it outright, and `mcp-server-directory.ts` filters it out of the flow editor.
  Redline is a sidecar on the private network reading a data store — it does not
  call out of the deployment — so it should be classified **`false` (internal)**.
  If it is classified `true`, this entire plan is blocked at the flow layer.
  Document the reasoning in the ADR; it is a governance claim, not a checkbox.
- Credentials resolve through the existing env-prefixed credential ref — the
  secret never leaves the adapter layer.

### 5.5 The iterative accumulation loop

For a corpus, the LLM must not carry findings in its context. It records each
verbatim finding, with its citation, as it goes; the report is assembled from the
accumulated store at the end.

- Under extraction flows this already exists: `app_extraction_records.fields
jsonb` is the accumulator, and `source_document_ids` is the citation link
  (§6 below). The work is to make Redline the **source** of those field values
  rather than a model reading document text.
- Under a guided chat session there is no accumulator today. If schema-definition
  chat is to produce a report over many documents, decide whether it (a) defines
  the schema and then **hands off to an extraction run**, or (b) gets a
  session-scoped scratchpad of its own. **(a) is strongly preferred** — it reuses
  the batch engine, the retry/resume semantics, the per-run cost ceiling, and the
  results grid, and avoids bending the one-session/one-conversation model that
  ADR-033 explicitly declined to bend.

---

## 6. Where the 500-document loop runs

Not in the chat session engine. ADR-033 already settled this: applying a fixed
schema across hundreds of documents is `flow_type = 'extraction'` — a separate
durable batch runner over `app_extraction_documents` (unit of work) and
`app_extraction_records` (unit of output), claimed with `FOR UPDATE SKIP LOCKED`,
with retries, resumability, bounded concurrency, cancellation, and a per-run cost
ceiling. `app_sessions` is never touched.

The mapping is direct:

| Plan concept                              | Existing Wayfinder mechanism                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Human defines the report schema           | Extraction schema in the flow version snapshot — now also settable via the §5.2 chat form |
| Iterate document by document              | Per-document task rows claimed by the extraction worker in `apps/api`                     |
| Fetch verbatim slices per document        | Redline MCP tools called from the per-record extraction step (§5.1 channel)               |
| Accumulate findings without context bloat | `fields jsonb` on each `app_extraction_record`                                            |
| Cite the source                           | `source_document_ids` + the element-level reference added in §5.1                         |
| Review before it counts                   | Existing confidence display, preview breakpoint, and human review gate                    |
| Export                                    | XLSX/JSON today, plus CSV from §5.3                                                       |

Chat's job is **schema definition, refinement, and inspection**. The batch
engine's job is **the corpus**. Keep that split.

---

## 7. Deployment

Redline runs as a **sidecar container**, not as code inside this repo.

- Separate image, separate repo, its own `Dockerfile`. Added as a service in
  `docker-compose.yml` for local development; Wayfinder reaches it by service
  name on the Docker network.
- In cloud deployments it sits in the same private network/VPC and is **never
  publicly exposed**. Wayfinder holds its internal URL in the MCP server record
  (admin-registered, per §5.4) — no new bespoke env var is required for the
  connection itself.
- Redline connects to Womblex with a **read-only database user**. That is the
  infrastructure-level enforcement of its no-write boundary; Wayfinder's
  `communicatesExternally = false` classification (§5.4) rests on it.
- Licence note: Wayfinder is **GPL-3.0** (`LICENSE`). Redline as a separate
  process communicating over MCP keeps its own licensing independent — one more
  reason not to vendor it into `packages/`.

---

## 8. Provenance rules (non-negotiable, once built)

1. A value presented as source data is byte-identical to what Redline returned.
2. Every such value carries a resolvable reference to its Womblex origin.
3. A value that is derived, inferred, or model-authored is visibly marked as such
   and retains the snippet it was derived from.
4. No Womblex read happens outside Redline's MCP tools.
5. Every tool call is audited; every export emits a data-egress audit event.
6. A Redline failure surfaces as an error. It never degrades to model-generated
   text.

Rules 1–4 need test coverage at the layer that owns them, per the testing rules
in `CLAUDE.md` — not an e2e spec.

---

## 9. Open decisions

| #   | Decision                                                                                                          | Owner                  | Blocks                                      |
| --- | ----------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------- |
| 1   | Redline classified `communicatesExternally: false`?                                                               | Architecture           | §5.4, and the whole plan if it lands `true` |
| 2   | Where verbatim payloads + element refs are persisted                                                              | Architecture (ADR)     | §5.1, §5.3                                  |
| 3   | Chat hands off to an extraction run (a) vs. session scratchpad (b)                                                | Product + architecture | §5.5, §6                                    |
| 4   | Does the CSV carry provenance columns?                                                                            | Product                | §5.3                                        |
| 5   | Whether the schema-definition form is a new node type or a tool-triggered card on an existing conversational node | Architecture           | §5.2                                        |

---

## 10. Out of scope

- Any build item inside Womblex or Redline. Womblex's output schemas are treated
  as a locked, documented foundation; Redline's pruning and MCP contract
  expansion are tracked in their own repos.
- Replacing Wayfinder's existing extraction path. Redline becomes an **additional
  source** for records that need provenance guarantees, not a rewrite of
  ADR-033.
- Public exposure of Redline, or multi-tenant Redline access control.
- Womblex writes of any kind.

---

## 11. How this becomes work

This note is planning input, not a plan of record. Turn it into docs the repo
recognises:

1. Run `/new-feature` against `main` (new feature → `main`, per **Release
   Branching** in `CLAUDE.md`).
2. Expected output:
   - PRD — `docs/development/prd/verbatim-report-assembly.prd.md`
   - ADR — the verbatim MCP channel (§5.1). This one is mandatory; it changes a
     governance guarantee.
   - ADR — Redline as an internal MCP server and its classification (§5.4), if
     decision #1 warrants its own record.
   - Phase docs in `docs/development/to-be-implemented/`, split so §5.1 lands
     before §5.2/§5.3 depend on it.
3. `/doc-review` before any build.
4. `/build` implements, runs `./validate.sh`, and moves each phase doc to
   `docs/development/implemented/alpha-3/v<version>/`.

**Version bump**: MINOR — new feature surface, and §5.1/§5.5 likely carry schema
impact. Current `VERSION` is `0.30.0`, so the first phase targets **0.31.0** on
`main`'s line. Planned here, applied by `/build`, never by this note.
