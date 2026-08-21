# John's Plan — UI Updates for Verbatim Report Assembly

- **Status**: Planning input. Not a phase doc — see §8 for how it becomes one.
- **Date**: 2026-08-21
- **Source**: the UI-affecting workstreams of
  [`WOMBLEX-REDLINE-WAYFINDER.md`](WOMBLEX-REDLINE-WAYFINDER.md) (§5.1–§5.4, §7.0),
  extracted and corrected against the code as it stands at `0.30.0`.
- **Base branch**: `main` (new feature surface, per **Release Branching** in `CLAUDE.md`)
- **Target version**: **0.31.0** — MINOR. Item 3 adds a column to
  `admin_mcp_servers`; items 1 and 2 are additive feature surface.

---

## 0. Scope

Four UI changes. They are independent of each other and can ship in any order,
**except** that item 1 is only worth building once the verbatim tool-result
channel (§5.1 of the source note) exists — a schema form that feeds a
paraphrasing pipeline defeats its own purpose.

| # | Change | Surface | Blocked on |
|---|--------|---------|------------|
| 1 | AI-triggered schema-definition form in chat | `/chats/[sessionId]` | Verbatim channel (§5.1); open decisions D1, D2 |
| 2 | CSV export | `/synthesise/[id]/runs/[runId]` | Open decision D3 |
| 3 | Verbatim-only flag on the MCP server form | `/admin/mcp-servers` | Nothing |
| 4 | Confidence relabel + derived-field marker | Results grid, chat, XLSX | Verbatim channel (§5.1) |

**Not in scope:** any Womblex or Redline work; the verbatim channel itself
(adapter/application layer, needs its own ADR); the handoff mechanism between a
guided flow and an extraction run.

---

## 1. AI-triggered schema-definition form in chat

**What it is.** When the model needs the operator to define part of a report
schema, it calls a tool (e.g. `request_schema_definition`) instead of asking in
prose. Wayfinder intercepts the call and renders an interactive field editor in
the conversation. The submitted schema becomes the argument set for Redline
queries and is persisted as workflow state.

### Where it actually goes

The source note pointed at `confirm-step-card.tsx` and `approval-gate.tsx` as
the precedent. **Those are the wrong models.** Neither renders in the message
feed — both are siblings of `<MessageFeed>` in
`apps/web/src/app/(user)/chats/[sessionId]/_content.tsx`:

- `ConfirmStepCard` (line 490) is pinned above the composer, driven by
  `isAwaitingConfirmation`.
- `ApprovalGate` (line 502) sits inside `data-composer-stack`, driven by
  `currentNode.type === "approval"`.

Both are keyed off **session/node state**, not off a message. A tool call
arriving mid-turn is neither.

**The right precedent is `apps/web/src/components/chat/record-card.tsx`** — a
genuine in-feed card, keyed off `messageId`, that reads its fields through
`trpc.document.getFields` and edits them through `DocumentEditDialog`. It is
already the completion card for a structured conversation step (ADR-038 §4), and
it already renders exactly the field vocabulary this form needs to collect.

`message-feed.tsx` dispatches cards two ways today:

- off persisted message fields — `msg.document` → `DocumentCard`, `msg.record` →
  `RecordCard` (lines 385–427);
- off parsed message content — `parseApprovalDecisionMessage`,
  `parseApproverEditMessage`, `parseScheduledMessage`.

A schema-request card needs one of these two channels. Neither exists for it, so
this is a new discriminator on `SessionMessage`, not a component drop-in.

### The hard part: suspending the turn

There is **no existing mechanism** for suspending a live turn on a tool call.
The current answer to "the AI needs something from the human" is
`apps/web/src/app/api/chat/[sessionId]/stream/gate-holds.ts`: the pre-generation
gate appends `OUTSTANDING — still required from the user` to the next turn's
gathered context, and the model asks in prose on the following turn. Both named
gates park *between* steps.

So the form requires a decision (D1) and then real stream work: end the stream
cleanly, persist a pending-form state against the message, and resume as a new
turn on submit. Budget this as the bulk of item 1.

### Field vocabulary

Use the **extraction authoring vocabulary**, not `TemplateField`.

`TemplateField` (`packages/domain/src/entities/template-field.ts`) is a parse
product of a Word template tag: `raw: string` is required and holds the tag
text, and its type union includes `section`, `group` and `signature` — none of
which an AI-requested report schema can produce. The v2.9.0 structured
conversation work already rejects `section` on both client and server. Note also
that its polarity is `optional`, not `required`.

The authoring-side models are:

- `ExtractionFieldDraft` (`packages/domain/src/entities/extraction-schema.ts`) —
  `{ label, annotation, instruction, doneWhen }`
- `ExtractionFieldModel` (`apps/web/src/components/extraction/extraction-editor-model.ts`) —
  `{ label, type, optional, options, maxLength?, min?, max?, instruction, locked }`

And the UI already exists:
`apps/web/src/components/extraction/extraction-field-editor.tsx` (283 lines) is a
working editor over `ExtractionFieldModel`, with `EXTRACTION_TYPE_OPTIONS`
covering text / number / currency / date / email / yes-no / select / multiselect.
`components/canvas/template-field-editor.tsx` and
`components/canvas/structured-field-editor.tsx` are the author-time siblings.

**Reuse `ExtractionFieldEditor`.** This also keeps item 1 consistent with §6 of
the source note, which has the chat form setting the extraction schema in the
flow version snapshot.

### Component notes

- `apps/web/src/components/ui/` has **no select, checkbox or radio primitive** —
  only badge, button, card, dialog, field-group-label, input, label, sheet,
  spinner, table, textarea and the date/time pickers. The house pattern is a
  hand-rolled native `<select>`; see `extraction-field-editor.tsx:92`. Copy that,
  don't reach for a form library.
- `zod` (^3.23.8) is already in `apps/web`. Validate the submitted schema with it
  on the server; do not add a JSON-schema form renderer.

### Persistence and audit

The submitted schema is the definition of what the report claims to be, so it is
workflow state: persist it (`SessionStepOutput` or the flow version snapshot,
per D2) and emit an audit event on submit. Do not leave it living only in the
message thread.

### Acceptance criteria

- A tool call named by the flow's config renders a schema card in the feed rather
  than streaming prose.
- The card collects label, type, required, and type-specific config (options,
  min/max) for N fields, and rejects `section` / `group` / `signature`.
- The turn does not continue until the operator submits or dismisses.
- On submit, the schema is persisted, audited, and readable by the next turn.
- On dismiss, the session is left in a state the operator can act on — not a
  dead thread.
- Reload mid-form restores the pending card rather than losing it.

Per `docs/guides/e2e-test-policy.md`, decide explicitly whether this warrants a
Playwright spec; the card itself is a component test, the suspend/resume round
trip may not be.

---

## 2. CSV export

**What it is.** A third download format on the extraction run-results screen,
beside the existing XLSX and JSON.

### The scope the source note missed

§5.3 said to "wire the artifact key, MIME, and filename in the same route". That
route only *serves* objects — it never produces them. `run-results.tsx:101`
spells this out: hitting the artifact URL without exporting first serves a stale
file, or a 410 on a run never exported.

The full change set:

| File | Change |
|---|---|
| `packages/domain/src/entities/audit-export.ts` | Export the escaping (`escapeCsvField` / `cell` are module-private today) or extract a shared helper. No CSV library. |
| `packages/domain/` (new) | Pure `toExtractionCsv(fields, records)`, unit-tested independently of HTTP and storage, following `toAuditCsv`'s quoting rules. |
| `packages/application/src/use-cases/extraction/export-run-results.ts` | Write `results.csv` alongside the XLSX and JSON; add `csvKey` to `ExportRunResultsOutput`; add `"csv"` to the `formats` array on the `extraction_run.exported` audit event. **This is the data-egress event — it fires here, not in the route.** |
| `apps/web/src/app/api/synthesise/runs/[runId]/artifacts/[artifact]/route.ts` | Add `csv: "text/csv"` to the `MIME` map and an `export-csv` branch to `resolveArtifact`. |
| `apps/web/src/components/extraction/run-results.tsx` | Widen `ExportFormat` to `"xlsx" \| "json" \| "csv"` and replace the two-way ternary at line 109 — it cannot express a third format. |

**Permissions need no work.** `authoriseRunAccess` runs once in the route before
artifact resolution, so a new artifact key inherits the check automatically. The
v1.59.0 IDOR precedent is already satisfied structurally.

### Placement

"Beside Download Excel" is wrong — JSON is not beside it. "Download Excel" is the
primary `<Button>`; JSON sits behind a secondary dropdown (`menuOpen`) with the
document and summary-doc links. **CSV goes in that menu, next to Download JSON.**

### Provenance columns (D3)

The source note recommends including source document / element references. Worth
naming what that overrides: the XLSX data sheet is deliberately values-only, so
the sheet can be pasted into a report without deleting interleaved metadata
columns — confidence and rationale live on a second tab. A CSV is single-sheet,
so it cannot make that split.

Two coherent options:

- **(a) Mirror tab 1** — values only, the paste-ready artifact. Provenance stays
  in the JSON export.
- **(b) Provenance-carrying** — a distinct artifact, and say so in the UI label,
  because it is not the same thing as the Excel download.

Do not ship (b) labelled as if it were (a).

### Acceptance criteria

- Exporting a run writes `results.csv` next to `results.xlsx` and `results.json`.
- `GET …/artifacts/export-csv` returns `text/csv` with a
  `run-<shortId>-results.csv` filename and the same 410-on-missing behaviour.
- The audit event records `formats` including `"csv"`.
- A value containing a comma, a double quote and a newline round-trips through a
  spreadsheet unchanged (unit test, no HTTP).
- A user without access to the run gets the existing 403/404, not a file.

---

## 3. Verbatim-only flag on the MCP server admin form

**What it is.** A per-server flag marking a server's tool results as
verbatim-only, so they can never be routed through the summarising pre-pass by
misconfiguration. Server-enforced; the UI is only how it gets set.

No new admin screen — but it is not zero UI work either. The form at
`apps/web/src/app/(admin)/admin/mcp-servers/_content.tsx` holds `label`, `url`,
`transport`, `communicatesExternally` and `credentialRef` as local state; this
adds a fifth control in the same family as the existing `communicatesExternally`
checkbox, plus a column on `admin_mcp_servers`
(`packages/adapters/src/db/schema/admin.ts:169`) and a field through
`mcp-server.ts` (router) → `mcp.ts` (use-case) →
`drizzle-mcp-server-repository.ts`.

The migration is additive with a default, so it is a `preserved` data-impact
declaration per `docs/guides/database-conventions.md`. It is also what makes this
release MINOR rather than PATCH.

### Related: Redline's classification

Registering Redline itself needs no new UI. But the classification decision is
load-bearing, and the source note undercounts where it bites.
`communicatesExternally: true` blocks a server in **four** places:

- `packages/application/src/use-cases/session/run-mcp-node.ts:85` — refuses to run it
- `packages/adapters/src/mcp/mcp-server-directory.ts:26` — filters it out of the flow editor
- `packages/application/src/use-cases/mcp/mcp.ts:179` — skips it
- `packages/domain/src/entities/flow-import-resolve.ts:79` — rejects it on flow import

That last one matters because the worked flows in §7 of the source note are
meant to be shareable. Classified `true`, Redline flows cannot be authored,
run, *or* imported.

### Acceptance criteria

- The flag is settable on create and edit, defaults to off, and survives a round
  trip through the repository.
- A server marked verbatim-only cannot have its results reach the summarising
  pre-pass — enforced in the adapter, with a test that proves the refusal.
- Existing servers are unaffected by the migration.

---

## 4. Confidence relabel and derived-field marker

**What it is.** Under reference-then-resolve (§7.0), the model returns a locator,
not a value, and Wayfinder writes Redline's bytes into the cell. The stored
per-field `confidence` therefore means confidence in the **selection** — "this
element is the one that answers this field" — never in the accuracy of the text,
which is exact by construction. The current UI copy says the opposite.

The source note flags this in passing ("label it that way in the UI or reviewers
will misread it") but never lists it as a workstream. It is a real change across
at least five sites:

| Site | Current |
|---|---|
| `apps/web/src/components/chat/confidence-bar.tsx:23` | "High / Medium / Low confidence" |
| `apps/web/src/components/extraction/result-grid.tsx:61-64` | `BAND_LABEL` — same three strings |
| `apps/web/src/components/extraction/result-grid.tsx:284` | "Confidence is a self-assessed triage signal, not a guarantee — always verify amber and …" |
| `packages/domain` — `confidenceBand` | The band vocabulary itself |
| `export-run-results.ts` — confidence sheet | "Confidence %" and "Band" columns |

**Do not blanket-rename.** A record produced by the existing extraction path
(model reads the document) still has accuracy-confidence; only a
Redline-sourced record has selection-confidence. The label has to vary by
provenance, which means the record needs to carry which path produced it.

The derived-field marker is the same shape of problem: an arithmetic result over
verbatim inputs is allowed, but must be visibly marked and must retain the
locators it was computed from. `result-grid.tsx` already renders
`record.sourceDocumentIds` as "Source files" (lines 450, 489) — that is the
document-level hook; the element-level reference arrives with the verbatim
channel.

### Acceptance criteria

- A Redline-sourced field's confidence reads as selection confidence in the grid,
  the rationale dialog, the chat bar, and the exported workbook.
- A field from the existing extraction path is labelled unchanged.
- A derived field is visually distinct from a verbatim one and exposes the
  locators behind it.

---

## 5. Sequencing

1. **Item 3** — no dependencies, unblocks safe Redline registration, carries the migration.
2. **Item 2** — fully independent; ships value with or without Redline.
3. Verbatim channel (§5.1 of the source note) — separate ADR, not this plan.
4. **Item 4** — needs a record to know its provenance, so it follows the channel.
5. **Item 1** — needs the channel and both open decisions resolved; largest by far.

---

## 6. Open decisions

| # | Decision | Blocks | Owner |
|---|---|---|---|
| D1 | Is the schema form a new node type, or a tool-triggered card on an existing conversational node? | 1 | Architecture |
| D2 | How does a turn suspend and resume — and where does the pending form state live? | 1 | Architecture |
| D3 | Does the CSV carry provenance columns, and is it therefore a separate artifact from the paste-ready sheet? | 2 | Product |
| D4 | Does a record carry which path produced it, so labels can vary by provenance? | 4 | Architecture |

D2 and D4 are additions to the source note's §10 — neither was listed there.

---

## 7. Risks

- **Turn suspension is the schedule risk.** It has no precedent in the stream
  code, and the two components the source note offered as models do not apply.
  Estimate item 1 from D2's answer, not from the card.
- **A half-relabelled confidence display is worse than none.** If item 4 ships
  partially, a reviewer sees "High confidence" on a verbatim cell and reads it as
  a claim about text accuracy — the exact misreading §7.0 exists to prevent.
- **CSV without provenance quietly becomes the export everyone uses**, because
  it is the easiest to open. That is the outcome this architecture exists to
  prevent, which is why D3 is a product decision and not a default.
- **Misclassifying Redline as externally-communicating blocks the whole plan** at
  four separate layers, including flow import.

---

## 8. How this becomes work

This file is planning input at the repo root, deliberately outside the normal
docs lifecycle. Nothing here is a plan of record until it goes through the
skills:

1. `/new-feature` against `main`, producing a PRD and the ADRs the source note
   names (the verbatim channel ADR is mandatory).
2. Phase docs in `docs/development/to-be-implemented/`, split so the verbatim
   channel lands before items 1 and 4 depend on it.
3. `/doc-review` before any build.
4. `/build`, then `./validate.sh`, then the phase doc moves to
   `docs/development/implemented/alpha-3/v<version>/`.

Version bump is planned here and applied by `/build`, never by this file.
