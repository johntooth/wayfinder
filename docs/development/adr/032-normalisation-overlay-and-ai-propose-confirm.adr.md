# ADR-032 — Field-Value Normalisation as a Read-Time Overlay with AI-Propose / Human-Confirm

- **Status**: Proposed
- **Date**: 2026-07-17
- **Relates to**: ADR-001 (hexagonal architecture / Result pattern), ADR-002
  (multi-provider AI / `ILanguageModel`), ADR-013 (auto-node structured data —
  `session_step_outputs` as the field store), the existing
  `IColumnMappingDetector` / `AiColumnMappingDetector` precedent

## Context

Free-text field values captured across many sessions drift in spelling and form:
"Microsoft", "Microsoft Corporation", and "MS Corp" are one entity to a human but
three distinct values in the field report. This makes the insights table noisy
and — once the summarisation feature lands — splits one logical group into
several pivot rows.

We want to canonicalise these values with AI assistance, but under three hard
constraints:

1. **The original is sacred.** The captured value in `app_session_step_outputs`
   is the system of record and must never be mutated by normalisation.
2. **Humans confirm.** The AI proposes clusters; a person accepts, edits, splits,
   merges, or rejects. Nothing is auto-applied. This matches Wayfinder's
   governance positioning and is the same shape as the existing HR
   column-mapping "arrives pre-filled for confirmation" flow.
3. **It runs repeatedly over time.** Sessions keep arriving, so normalisation is
   not a one-shot migration — it must be re-runnable, proposing only for
   newly-seen raw values and preserving every prior human decision.

## Decision 1 — Normalisation is a read-time overlay, never a write-back

Captured values in `app_session_step_outputs.fields[].value` are never rewritten.
Instead a **mapping table** records `rawValue → canonicalValue` per field, and the
deep-dive read path applies it as an overlay when building the `FieldReport`.
The overlay:

- is applied in the read path (in / alongside `GetFlowDeepDive`) **before** the
  report reaches the client, so the table, the xlsx export, and the pivot drawer
  all inherit normalised values from one place;
- is toggleable **raw ↔ normalised** in the UI (mirroring the existing "Combine
  forked steps" toggles), so the original is always one click away;
- only substitutes a value when a **confirmed** mapping exists — proposed and
  rejected mappings never affect what is displayed.

This mirrors ADR-028's non-destructive stance (archive/version, never destroy)
and keeps a single source of truth.

## Decision 2 — `app_field_value_normalisations` mapping table

```
app_field_value_normalisations
  id                uuid pk
  flow_id           uuid -> app_flows(id) on delete cascade
  node_id           uuid -> app_flow_nodes(id) on delete cascade
  field_key         text not null           -- the template field key
  raw_value         text not null           -- exact observed value (the original, copied not moved)
  canonical_value   text not null           -- what it normalises to
  status            text not null default 'proposed'  -- proposed | confirmed | rejected
  confirmed_by      uuid -> core_users(id)  -- who confirmed/rejected (audit)
  created_at        timestamptz not null default now()
  updated_at        timestamptz not null default now()

  unique (flow_id, node_id, field_key, raw_value)   -- one mapping per observed value
  index on (flow_id)                                -- overlay lookup per flow
```

- Prefix `app_` (Wayfinder application data) — valid per the schema rules.
- The `unique` on `(flow_id, node_id, field_key, raw_value)` is what makes
  re-runs safe: a raw value can hold at most one mapping, so proposing again for
  an already-mapped value is a no-op / upsert, never a duplicate.
- `raw_value` is a **copy** of the observed original for keying and display; the
  authoritative original still lives untouched in `app_session_step_outputs`.

## Decision 3 — AI proposes clusters via a bounded `generateObject`, output sanitised

A new port `INormalisationProposer` (domain) with adapter `AiNormalisationProposer`
(adapters/ai), built the same way as `AiColumnMappingDetector`:

- Input: the field label (for context) and the list of **distinct unmapped raw
  values** (bounded — e.g. top-N by frequency, chunked if large).
- Call: `languageModel.generateObject` at `temperature: 0` with a zod schema like
  `{ clusters: { canonical: string, members: string[] }[] }` and
  `purpose: "field-normalisation"` (so usage/cost is tracked in Langfuse).
- **Sanitise the output**: drop any `member` that is not an actually-observed
  input value and any cluster the model invents — the same defensive discipline
  `AiColumnMappingDetector.sanitise` uses. A hallucinated merge must be
  impossible to persist.

The proposer only ever *proposes*. Persisting a `confirmed` mapping is a separate,
human-triggered step.

## Decision 4 — Incremental, re-runnable by construction

Normalisation is designed to be run many times as data grows:

- `ProposeColumnNormalisation` reads the column's distinct raw values, subtracts
  those already present in `app_field_value_normalisations` (any status), and
  proposes **only for the remainder**. Existing `confirmed` and `rejected`
  decisions are never revisited or overwritten.
- New raw values are offered against the **existing canonical set** first (so a
  new "Microsoft Inc." folds into the already-confirmed "Microsoft" cluster
  rather than starting a fresh one), then as new clusters only if they match
  nothing.
- Re-running with no new values yields an empty proposal — a cheap no-op — so it
  is safe to invoke on a schedule or on demand without side effects.

## Decision 5 — Confirmation is audited

`ConfirmColumnNormalisation` writes the chosen mappings as `confirmed` (or
`rejected`) with `confirmed_by`, and emits an audit event through the existing
`IAuditLogger` (`core_audit_log`) — **no new audit table**:

```
action:        "insights.normalisation_confirmed"
resourceType:  "flow"
resourceId:    <flowId>
actorId:       <confirming user id>
metadata:      { nodeId, fieldKey, confirmed: <count>, rejected: <count> }
```

A human altering how recorded data is presented is exactly the kind of event the
governance model expects to capture.

## Consequences

**Positive**
- Originals are provably untouched; raw ↔ normalised is a display toggle, fully
  reversible.
- One overlay point means table, export, and pivot all normalise consistently.
- Re-runnable and incremental: correct as sessions accumulate, cheap when idle.
- Reuses `ILanguageModel`, the `AiColumnMappingDetector` pattern, and the audit
  logger — little genuinely new machinery.

**Negative**
- A read-time overlay adds a mapping lookup + substitution to the deep-dive read
  path (bounded per flow; indexed on `flow_id`).
- Normalisation is **per column** in this phase — a shared cross-column /
  cross-flow entity dictionary ("Microsoft" reconciled everywhere at once) is
  deferred.
- Proposal quality depends on the model; the human-confirm gate and output
  sanitisation are the guardrails, at the cost of a required review step.
