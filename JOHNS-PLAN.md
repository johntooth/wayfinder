# John's Plan — Platform Capabilities for Tool-Sourced Report Assembly

- **Status**: Planning input. Not a phase doc — see §6 for how it becomes one.
- **Date**: 2026-08-24 (supersedes the 2026-08-21 draft)
- **Base branch**: `main` (new feature surface, per **Release Branching** in `CLAUDE.md`)
- **Repo state at drafting**: `0.31.0`

> **What changed from the previous draft.** That draft was a Redline integration
> plan with feature-shaped headings: four items, each specified in terms of what
> Redline needs. This one restates the work as **platform capabilities that stand
> on their own**, with Redline demoted to a motivating consumer (§5). The
> substance is not a rewrite for its own sake — checking the previous draft
> against the code found that most of its items describe general gaps in
> Wayfinder that are live today, and that two of its four items were specified
> against behaviour that does not exist. Corrections are marked inline.
>
> References to Womblex have been removed throughout. Wayfinder consumes MCP
> servers; what sits behind one of them is not Wayfinder's concern and must not
> appear in its domain model.

---

## 0. Scope and the test that shapes it

Eight capabilities. Each one must pass:

> **If Redline never ships, is this still worth building?**

Anything that fails that test is specified as an integration, not a feature. All
eight pass, and the evidence in each section is drawn from Wayfinder's current
behaviour rather than from a prospective integration. In several cases the
general version is also *less* code than the Redline-specific version in the
previous draft, because it needs no per-server discriminator.

| # | Capability | Stands alone because, today… | Schema |
|---|---|---|---|
| C1 | An MCP tool result reaches the model intact | every tool result from every server is clipped at 4,000 characters | none |
| C2 | A value records how it was produced | a human-corrected value is indistinguishable from an AI-generated one | none |
| C3 | A tool result can become a value without the model retyping it | every tool result reaches a value only by passing through model prose | none |
| C4 | Extraction records can take tool-sourced values | no external data source can contribute to an extraction run | migration |
| C5 | CSV export | run results are downloadable only as XLSX or JSON | none |
| C6 | Trust boundary and scope-bearing arguments | an internal sidecar cannot be used in a flow at all | column |
| C7 | The AI can request structured input mid-turn | the AI can only ask for a report schema, not for values | none |
| C8 | A session keeps a durable working set | gathered facts scroll out of the window and collide on key | new table |

**Not in scope:** registering any particular MCP server; the handoff between a
guided flow and an extraction run beyond what C4 requires; anything in another
repository.

---

## 1. The capabilities

### C1 — An MCP tool result reaches the model intact

**What it is.** The audit budget and the model-context budget are two different
budgets. Today they are one.

**Why it stands alone.** `packages/adapters/src/mcp/mcp-tool-prepass.ts` sets
`AUDIT_RESULT_MAX_CHARS = 4_000` and clips every tool result with
`… [truncated]`. That clipped string is not only what gets persisted — it is
what `renderToolResults` (`mcp-turn-helpers.ts:136`) injects into the gathered
context for the structured turn. Every MCP server in the product is affected: a
CRM returning records, a pricing service returning a table, any tool returning
more than a couple of pages of text. The model is reasoning over a truncated
payload and has no way to know what was removed.

**Correction to the previous draft.** Item 3 there specified a per-server
"verbatim-only" flag to keep results away from "the summarising pre-pass". The
pre-pass does not summarise — its `summary` goes to the audit payload only, and
`record.result` (the raw output) is what reaches the model. The defect is the
truncation, and fixing it needs no flag, no column and no per-server
discriminator.

**Acceptance criteria**

- **Given** an MCP server whose tool returns a 20,000-character result, **when** a
  conversational step's tool pre-pass calls it, **then** the full result is
  present in the gathered context passed to the structured turn.
- **Given** that same call, **when** the audit record is persisted, **then**
  `McpToolCallRecord.result` is bounded by the audit budget and marked as
  abridged — the audit copy is capped, the model copy is not.
- **Given** a result exceeding the context budget, **when** it is assembled into
  gathered context, **then** the step states how much was withheld and why,
  rather than appending a truncation marker to a silently clipped string.
- **Given** a result within budget, **when** it is rendered to the model, **then**
  no truncation marker appears.

*Test layer: adapter unit tests on `mcp-tool-prepass.ts`. No e2e.*
*Version: PATCH — a defect in a shipped limit.*

---

### C2 — A value records how it was produced

**What it is.** Origin becomes a first-class property of a field value: AI-generated,
operator-supplied, tool-sourced, or derived.

**Why it stands alone.** `ExtractionFieldResult` is
`{ key, value, confidence, rationale }` — there is no origin. `applyFieldEdit`
records a human correction by stamping `confidence: 1` and writing
"Manually corrected by …" into the **rationale prose**. `result-grid.tsx` and
`result-grid-model.ts` contain no reference to edited, manual or corrected state.
So in the shipped product a value a person typed and a value the model guessed
both render "High confidence", are visually identical, and are indistinguishable
in the exported workbook. Nobody can filter a run for "which values did a human
set" without reading rationale sentences. That is an audit weakness now.

**Cost note.** `app_extraction_records.fields` is a `jsonb` column typed as
`ExtractionFieldResult[]`, so adding an origin key needs **no SQL migration**.
Absent means AI-generated, and existing rows are correct by default.

**Granularity.** Per *value*, not per record. A record legitimately mixes origins —
a quoted figure, a model summary and a computed total in one row — and only
per-value origin can describe that. A per-record column would be cheaper for the
admin dashboards to aggregate and is wrong for the normal case.

**Acceptance criteria**

- **Given** a field value a person corrected, **when** the results grid renders it,
  **then** it is visibly distinct from an AI-generated value without relying on
  the rationale prose.
- **Given** a run containing both AI-generated and human-corrected values, **when**
  it is exported, **then** origin is its own column in every format, not a
  sentence inside `rationale`.
- **Given** a record written before this change, **when** it is read, **then** it
  reads as AI-generated and nothing fails.
- **Given** a value supplied by a tool call, **when** it is stored, **then** its
  origin is tool-sourced and it carries a reference the platform can hand back to
  that tool to re-resolve.
- **Given** a tool-sourced reference of arbitrary internal structure, **when**
  Wayfinder stores, renders or exports it, **then** it round-trips unchanged and
  no part of it is parsed or validated.
- **Given** a value computed from other values, **when** it is rendered, **then**
  it is marked derived and exposes the values it was computed from.

*Test layer: domain unit tests on the value type; component test on `result-grid.tsx`.*
*Version: MINOR.*

The fifth criterion is the boundary guard, and it is directly testable: a
reference with a fabricated internal shape must survive a full round trip
untouched. Wayfinder must never grow a typed model of another system's
addressing scheme.

**Confidence labelling.** Where a value's origin means its confidence describes
something different — selection rather than accuracy — the label follows from
origin and does not need its own mechanism. Two admin dashboards average
confidence across sessions and steps; averaging two different measures into one
number is meaningless, so those dashboards are in scope for this capability, not
a follow-up. A half-applied relabel is worse than none.

---

### C3 — A tool result can become a value without the model retyping it

**What it is.** A structured tool result can land in a structured place without a
model re-authoring it in prose first.

**Why it stands alone.** Today every MCP result enters a **prompt string** and
whatever reaches a field is the model's restatement of it. For any tool that is
authoritative for its data — a pricing service, a records system, a reference
API — a model-restated value is strictly worse than the value itself, and the
failure is silent. This is the general form of what the previous draft called the
"verbatim channel"; stated this way it names no server.

**Acceptance criteria**

- **Given** a step whose tool returns structured results, **when** the model
  selects one as the answer for a field, **then** the stored value is
  byte-identical to what the tool returned.
- **Given** the model's prose restates a tool value inexactly, **when** the field
  is written, **then** the tool's value is stored and the prose is not.
- **Given** a tool marked authoritative for a field, **when** that tool call
  fails, **then** the step surfaces an error and no model-authored substitute is
  written.

*Test layer: application unit tests on the step executor.*
*Version: MINOR.*

---

### C4 — Extraction records can take tool-sourced values

**What it is.** An extraction run can populate values from tool calls, not only
from documents whose bytes Wayfinder holds.

**Why it stands alone.** `FlowNodeType` is
`"conversational" | "auto" | "scheduled" | "approval" | "mcp"` — MCP exists only
as a *flow* node. There are no MCP references anywhere in
`packages/application/src/use-cases/extraction/` or
`apps/web/src/components/extraction/`. And `app_extraction_documents.storage_key`
is `NOT NULL`, so every extraction document must have bytes in Wayfinder's own
object storage. Together these mean **no external data source can contribute to
an extraction run at all** — which is where records, the results grid,
confidence and every export live.

This is the largest of the eight and the one the previous draft did not carry.
Its absence is why that draft's items 2 and 4 appeared independent while both
depended on a connection that does not exist.

**Acceptance criteria**

- **Given** an extraction flow configured with an MCP tool, **when** a run
  executes, **then** values may be populated from tool calls as well as from
  uploaded documents.
- **Given** an extraction run with no uploaded documents at all, **when** it
  completes, **then** it is a valid run — the pipeline does not require Wayfinder
  to hold document bytes.
- **Given** a record whose values came from a tool, **when** the run results are
  viewed, **then** those values carry tool-sourced origin per C2 and the record
  resolves without a source document.

*Test layer: application unit tests on the extraction use-cases.*
*Version: MINOR. Migration: `app_extraction_documents.storage_key` becomes
nullable — additive, `-- data-impact: preserved`.*

---

### C5 — CSV export

**What it is.** A third download format on the extraction run-results screen,
beside XLSX and JSON.

**Why it stands alone.** It always did. Nothing about it is Redline-shaped.

**The scope the source material missed.** The artifact route only *serves*
objects; it never produces them (`run-results.tsx:101` says so). The change set:

| File | Change |
|---|---|
| `packages/domain/src/entities/audit-export.ts` | Export the escaping (`escapeCsvField` / `cell` are module-private) or extract a shared helper. No CSV library. |
| `packages/domain/` (new) | Pure `toExtractionCsv(fields, records)`, unit-tested independently of HTTP and storage, following `toAuditCsv`'s quoting rules. |
| `packages/application/src/use-cases/extraction/export-run-results.ts` | Write `results.csv` beside the XLSX and JSON; add `csvKey` to the output; add `"csv"` to the `formats` array on the `extraction_run.exported` audit event. **The data-egress event fires here, not in the route.** |
| `apps/web/src/app/api/synthesise/runs/[runId]/artifacts/[artifact]/route.ts` | Add `csv: "text/csv"` to the `MIME` map and an `export-csv` branch to `resolveArtifact`. |
| `apps/web/src/components/extraction/run-results.tsx` | Widen `ExportFormat` to `"xlsx" \| "json" \| "csv"` and replace the two-way ternary at line 109 — it cannot express a third format. |

**Permissions need no work.** `authoriseRunAccess` runs once in the route before
artifact resolution, so a new artifact key inherits the check.

**Placement.** "Download Excel" is the primary button; JSON sits behind a
secondary dropdown. CSV goes in that menu, next to Download JSON.

**Provenance columns.** Resolved by C2 rather than decided here. Once origin is a
property of every value, the CSV carries it for the same reason it carries the
value. The previous draft's D3 asked whether the CSV should be a separate
provenance-carrying artifact; that question only existed because provenance was
being treated as an extra bolted onto one export.

**Acceptance criteria**

- **Given** a completed run, **when** the operator exports, **then** `results.csv`
  is written beside `results.xlsx` and `results.json`, and the audit event's
  `formats` includes `"csv"`.
- **Given** a value containing a comma, a double quote and a newline, **when** it
  round-trips through the CSV into a spreadsheet, **then** it is unchanged.
- **Given** a run never exported, **when** the CSV artifact is requested, **then**
  the existing 410 applies.
- **Given** a user without access to the run, **when** they request the CSV
  artifact, **then** they get the existing 403/404 and no file.

*Test layer: domain unit test for shaping and escaping, no HTTP. Route behaviour
is covered by the existing artifact tests.*
*Version: MINOR.*

---

### C6 — Trust boundary and scope-bearing arguments

**What it is.** Two related gaps in how the platform admits an MCP server and how
it fills that server's arguments.

**Why it stands alone.** `communicatesExternally` conflates "reaches the public
internet" with "is a third party", and is enforced as a hard refusal in four
places: `run-mcp-node.ts:85`, `mcp-server-directory.ts:26`, `mcp.ts:179`, and
`flow-import-resolve.ts:79` — that last one meaning flows using such a server
cannot even be imported. Any internal sidecar or on-prem service hits the same
wall today.

Separately, MCP node arguments default to `{ kind: "ai" }` and are resolved by a
language model via `resolveFieldValues`. For an argument that scopes data access
— a tenant, account or corpus key — a model-chosen value is a cross-tenant read.

**Correction to my own earlier framing.** Literal pinning already exists:
`valueSources[key] = { kind: "literal", value }` resolves directly without the
model, as does `step_field`. The gap is not that pinning is impossible — it is
that the **default is `ai`** and nothing lets a flow author declare an argument
as scope-bearing so it cannot be left on that default. This is a much smaller
change than "add argument pinning".

**Acceptance criteria**

- **Given** an MCP server inside the deployment's trust boundary, **when** an
  administrator registers it, **then** it can be selected in flows without being
  classified as externally-communicating.
- **Given** a tool argument declared scope-bearing, **when** a flow author
  configures the node, **then** it cannot be left on the AI default and the
  editor says why.
- **Given** such an argument pinned to a literal or organisation-scoped value,
  **when** the step runs, **then** the value sent to the tool is the pinned one
  regardless of what the transcript or the model proposes.

*Test layer: application unit tests on `run-mcp-node.ts` and `resolveFieldValues`;
domain test for the classification.*
*Version: MINOR — a column on `admin_mcp_servers`, additive with a default,
`-- data-impact: preserved`.*

---

### C7 — The AI can request structured input from the operator mid-turn

**What it is.** Generalising the payload of a mechanism that already exists.

**Why it stands alone.** `v0.31.0` shipped the suspend/resume machinery, and it is
genuinely general: a tool call is detected mid-turn, the turn suspends, state
persists at `session_messages.schema_request` (jsonb, nullable), a card renders,
and submit resumes as a fresh turn — with `status` tracking
pending/submitted/dismissed so a dismissal does not kill the thread.

The **payload** is not general. Every row is a schema field *definition*:
`SchemaRequestFieldDraft { label, type, required, options, min, max, instruction }`,
and `parseSchemaRequestSubmission` refuses an empty list with "A report schema
needs at least one field." The node config key is `schemaRequestToolName`,
singular. So the AI can ask *"what columns should this report have?"* It cannot
ask *"what is the contract value?"* as a typed input, *"which of these three
candidates is right?"*, or *"confirm these five extracted values"* — all the same
machinery with a different payload.

**Acceptance criteria**

- **Given** a node configured with a tool that requests operator input, **when**
  the model calls it mid-turn, **then** the turn suspends and a form renders
  against the shape that tool declared — schema definition being one shape, not
  the only one.
- **Given** a request for typed values rather than field definitions, **when** the
  card renders, **then** it collects values against the declared types using the
  same suspend/resume machinery, with no new mechanism.
- **Given** a node declaring more than one input-requesting tool, **when** the
  model calls any of them, **then** the matching form renders.
- **Given** a pending request, **when** the operator reloads, **then** the form is
  restored with anything already entered.
- **Given** a pending request, **when** the operator dismisses it, **then** the
  session stays actionable and the model is told it was declined.
- **Given** a submitted form, **when** the next turn runs, **then** the submission
  is readable as structured data, persisted outside the message thread, and
  audited.
- **Given** tool arguments naming an unsupported input type, **when** the form is
  seeded, **then** that row degrades to a safe default rather than the operator
  getting no form.

*Test layer: domain unit tests on the request and submission types; component
test on the card.*
*Version: MINOR. The payload column is already nullable jsonb, so widening the
shape is non-destructive.*

---

### C8 — A session keeps a durable working set

**What it is.** The place a session holds what it has gathered so far, as
structured data the operator can see and correct.

**Why it stands alone.** Something exists — `accumulateInsights(messages)` — and
every one of its limits is a general defect:

- **Re-derived from the transcript every turn.** Nothing is stored as a working set.
- **Flat `key → string`.** No type, no origin, no confidence, no reference.
- **Model-authored only.** `contextGathered` comes from the AI turn payload; a
  tool result cannot write into it.
- **Invisible to the operator.** `contextGathered` has no references in any
  component. ("Flow Insights" in the admin nav is unrelated — analytics over
  completed sessions.)
- **Bounded by the visible message window,** so facts scroll out and are gone.
- **One global key space, last-write-wins** (`values.set(item.key, item.value)`).
  Gathering the same field across two subjects means the second silently
  overwrites the first.

The last two are live data-loss bugs in any long session, with no external data
source involved. This capability is what lets a long gather exist at all; every
other capability here improves the quality of a value.

**Acceptance criteria**

- **Given** a session that gathered facts many turns ago, **when** the message
  window has advanced past them, **then** those facts are still available to the
  next turn.
- **Given** facts gathered about two different subjects using the same field
  name, **when** the working set is read, **then** both are present and
  separately addressable.
- **Given** an entry in the working set, **when** it is read, **then** it carries
  its origin per C2 — model-authored, tool-sourced or operator-supplied — not
  just a key and a string.
- **Given** a tool result, **when** a value from it enters the working set,
  **then** it is written as data, not by the model restating it in prose.
- **Given** a session in progress, **when** the operator views it, **then** they
  can see what has been gathered and correct or remove an entry.
- **Given** an operator correction to an entry, **when** the next turn runs,
  **then** the model sees the corrected value.
- **Given** a completed session, **when** its working set is handed to an
  extraction run or an export, **then** it transfers as structured data.

*Test layer: domain unit tests on the working-set type; application tests on
read and write; component test for the operator view.*
*Version: MINOR. Migration: a new table — additive.*

---

## 2. Sequencing

Ordered by what is broken now and what unblocks what, not by which is most
visible.

1. **C8** — the working set. Live data loss, and the substrate the rest writes into.
2. **C2** — value origin. No migration, and it fixes an audit gap in the shipped product.
3. **C1** — result truncation. A defect, self-contained, benefits every MCP server.
4. **C7** — generalise the input payload. Machinery already exists.
5. **C3** — tool result to value without model restatement. Depends on C2's origin.
6. **C4** — tool-sourced extraction values. The largest; depends on C2 and C3.
7. **C5** and **C6** — independent; drop in wherever there is room.

C5 is the natural candidate to ship first if something small and complete is
wanted early. It depends on nothing.

---

## 3. Open decisions

The previous draft carried four. D1 and D2 were decided and shipped in `0.31.0`.
D3 dissolves under C2 — provenance is a property of every value, so no export
needs a separate decision about carrying it. D4 becomes C2 itself.

| # | Decision | Blocks | Owner | Status |
|---|---|---|---|---|
| E1 | What is the model-context budget for a tool result, and is it per-server or global? | C1 | Architecture | Open |
| E2 | Does the working set live per session, or per session *and* subject, with subjects declared by the flow? | C8 | Architecture | Open |
| E3 | Does an operator-corrected working-set entry lock against further model overwrite? | C8 | Product | Open |
| E4 | Which admin dashboards keep a single confidence aggregate once origins differ? | C2 | Reporting owner | Open |

E1 and E2 are the two worth resolving before a phase doc is written. E3 and E4
can be answered during build.

---

## 4. Risks

- **C8 is the largest unbuilt thing here and the one everything else assumes.**
  If it is deferred, C3 and C4 have nowhere durable to write, and the plan
  reverts to improving values that a long session will lose anyway.
- **A half-applied origin display is worse than none.** If C2 ships partially, a
  reviewer sees a familiar confidence label on a value whose confidence now means
  something else. The admin dashboards are the quiet case — nobody reviews an
  average.
- **C4 touches the extraction pipeline's core assumption** that a record derives
  from documents Wayfinder holds. Scope it against the retention sweep, the
  exceptions bucket and the per-run ceiling guard, not just the happy path.
- **Nothing here should name an MCP server.** The moment a capability, table
  column or domain type names one, this plan has become an integration again and
  the coupling it exists to avoid is back.

---

## 5. Redline as a motivating consumer

Recorded so the origin of these capabilities is not lost, and contained to this
section so it does not leak into the specifications above.

[Redline](https://github.com/DeepCivic/Redline) is a read-only MCP server that
serves source data verbatim and refuses to generate. It is the first server that
makes each of the eight capabilities above pay off at once, which is why they
surfaced together. It is **not** their justification — each one is justified by
Wayfinder's current behaviour in its own section.

Three facts about it bear on planning, none of which belong in a specification:

- **It is under construction.** Version `0.0.0`, no tags, no release, active
  daily development. Its own status document opens with "Under construction".
- **Its tool surface is provisional.** Three of the five tools it exposes today
  are marked for deletion in its own outstanding work, and the tools this kind of
  work would want are unbuilt. Building against current tool names would be
  building against names scheduled to disappear.
- **Its architectural shape is settled** — addressing by identifier, retrieval
  bounded by rows and characters, values never truncated to meet a budget,
  accumulation explicitly the client's responsibility. C8 exists because
  Wayfinder is that client and does not currently accumulate reliably.

Because nothing above names it, its churn costs Wayfinder flow configuration and
nothing else. There is no contract test between the two repositories and neither
is versioned against the other; if a closer coupling is ever proposed, that gap
is the first thing to close.

---

## 6. How this becomes work

This file is planning input at the repo root, deliberately outside the normal
docs lifecycle. Nothing here is a plan of record until it goes through the
skills:

1. `/new-feature` against `main`, producing a PRD per capability — or per
   coherent group — and the ADRs they need. C8 and C4 each warrant their own.
2. Phase docs in `docs/development/to-be-implemented/`, one per capability, so
   they can ship independently.
3. `/doc-review` before any build.
4. `/build`, then `./validate.sh`, then the phase doc moves to
   `docs/development/implemented/alpha-3/v<version>/`.

Version bumps are planned per capability above and applied by `/build`, never by
this file.
