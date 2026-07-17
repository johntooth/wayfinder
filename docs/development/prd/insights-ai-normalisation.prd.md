# PRD — AI Field-Value Normalisation for Flow Insights

- **Status**: Draft
- **Date**: 2026-07-17
- **Author**: Richy Brasier
- **Target version**: 2.6.0 (bump: **MINOR** — new feature with a schema change;
  ships after Insights Export & Summarisation — see `docs/guides/versioning.md`)

## 1. Problem

Free-text field values captured across many sessions drift in spelling and form.
A "Vendor" field can hold "Microsoft", "Microsoft Corporation", and "MS Corp" —
one entity to a human, three rows to the insights report. This makes the field
report noisy and, once summarisation lands, splits a single logical group into
several pivot rows, undermining totals and counts. Operators need a way to
reconcile these values that is AI-assisted but trustworthy, and that keeps
working as new sessions keep arriving.

## 2. Users / Personas

- **Procurement / HR / ops operator** — wants "Microsoft" et al. counted as one
  vendor in the report, export, and pivot.
- **Team lead / auditor** — needs assurance that reconciliation never rewrites
  the original captured data and that every decision is attributable.

## 3. Goals

- For a free-text column, the operator can request an **AI-proposed set of
  clusters** (canonical value ← observed variants) and **confirm, edit, split,
  merge, or reject** each cluster.
- Confirmed mappings normalise the value **everywhere** — table, xlsx export,
  and pivot drawer — via a single read-time overlay.
- The **original captured value is never mutated**; a raw ↔ normalised toggle
  always exposes it.
- Normalisation is **re-runnable over time**: running it again proposes only
  newly-seen raw values, folds them into existing confirmed clusters where they
  fit, and never revisits prior human decisions.
- Every confirmation is **audited**.

## 4. Non-goals

- Normalising constrained types (options-enum, yes/no, currency, number) — they
  are already canonical; this targets `text` fields only.
- A shared cross-column / cross-flow entity dictionary — normalisation is
  **per column** in this phase.
- Fuzzy numeric parsing (already handled by `parseNumeric`).
- Auto-applying AI output without human confirmation — explicitly forbidden.
- Editing the underlying `app_session_step_outputs` values.

## 5. Key entities

| Entity / port | Lives in | New / existing | Notes |
| ------------- | -------- | -------------- | ----- |
| `FieldValueNormalisation` | `packages/domain/src/entities/field-value-normalisation.ts` | new | `{ id, flowId, nodeId, fieldKey, rawValue, canonicalValue, status, confirmedBy, createdAt, updatedAt }`. |
| `INormalisationProposer` | `packages/domain/src/ports/normalisation-proposer.ts` | new | `propose({ label, values }) -> Result<{ clusters: { canonical, members }[] }>`. |
| `AiNormalisationProposer` | `packages/adapters/src/ai/ai-normalisation-proposer.ts` | new | Bounded `generateObject`, temp 0, output sanitised (drop invented values). Mirrors `AiColumnMappingDetector`. |
| `IFieldValueNormalisationRepository` + Drizzle impl | domain / adapters | new | CRUD + `listConfirmedByFlow`, `listRawValuesByFlow`. |
| `ProposeColumnNormalisation` / `ConfirmColumnNormalisation` | `packages/application` | new | Use-cases; confirm takes `IAuditLogger`. |
| `app_field_value_normalisations` | `packages/adapters/src/db/schema/...` | new table (`app_`) | The mapping store (see ADR-032). |
| `IAuditLogger` / `LogAuditEvent` | domain / application | existing | Emits `insights.normalisation_confirmed`. No new audit table. |

## 6. User stories

1. As an operator, I can click **Normalise** on a text column and see AI-proposed
   clusters (canonical ← variants, with counts) I can adjust and confirm.
2. As an operator, once I confirm, the report, export, and pivot all show the
   canonical value, and I can toggle back to raw at any time.
3. As an auditor, the original captured values are untouched and every
   confirmation is recorded with who did it.
4. As an operator, when I run normalisation again months later, it only asks me
   about values that have appeared since, and remembers everything I already
   decided.

## 7. Pages / surfaces affected

- `/admin/dashboards/insights` — a **Normalise** action per text column; a
  confirmation modal/sheet listing proposed clusters (editable: rename canonical,
  merge, split, accept/reject per cluster); a **raw ↔ normalised** toggle on the
  report.
- tRPC: `analytics.proposeNormalisation` (mutation/query) and
  `analytics.confirmNormalisation` (mutation) — both admin.
- Read path: `GetFlowDeepDive` (or an overlay step it calls) applies confirmed
  mappings before returning the `FieldReport`.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_field_value_normalisations` | **NEW** — raw→canonical mapping with `status` + `confirmed_by`; unique on `(flow_id, node_id, field_key, raw_value)`, index on `flow_id` | yes (`app_`) |

Audit reuses the existing `core_audit_log`. Originals remain in
`app_session_step_outputs` (unchanged).

## 9. Architectural decisions

- **ADR-032 — Field-value normalisation as a read-time overlay with
  AI-propose / human-confirm** (new). Establishes: no write-back, the mapping
  table, the bounded-and-sanitised AI proposer, incremental re-runs, and audited
  confirmation.
- Assumes ADR-002 (`ILanguageModel`) and reuses the `AiColumnMappingDetector`
  precedent; ADR-001 boundaries (Result pattern, ports).

## 10. Acceptance criteria

- [ ] `Normalise` on a text column returns AI-proposed clusters; every proposed
      member is an actually-observed value (sanitised — no hallucinated merges).
- [ ] The operator can rename canonical, merge, split, and accept/reject per
      cluster before confirming.
- [ ] Confirmed mappings normalise values in the table, xlsx export, and pivot
      via one read-time overlay; a raw ↔ normalised toggle switches views.
- [ ] `app_session_step_outputs` values are never modified (verified by test).
- [ ] Re-running proposes only raw values with no existing mapping, folds new
      values into existing confirmed clusters where matched, and never changes a
      prior `confirmed`/`rejected` decision.
- [ ] Re-running with no new values is a cheap no-op (empty proposal).
- [ ] Each confirmation emits `insights.normalisation_confirmed` with `nodeId`,
      `fieldKey`, and confirmed/rejected counts.
- [ ] Tests written before implementation for the proposer sanitisation, the
      overlay, the incremental proposal filter, and the repository; only `text`
      columns are offered normalisation. `./validate.sh` passes with `VERSION` /
      `package.json#version` matched.

## 11. Out of scope / future work

- Cross-column / cross-flow shared entity dictionary.
- Auto-confirm / confidence-thresholded auto-apply.
- Bulk normalisation across many flows at once.
- Normalising non-text types.

## 12. Risks / open questions

- **Wrong merges corrupt reports** — mitigated by human confirmation, output
  sanitisation, non-destructive overlay, and the raw toggle. Never auto-apply.
- **Scale of distinct values** — bound the proposer input (top-N by frequency,
  chunking); the incremental filter keeps repeat runs small.
- **Model cost / determinism** — `temperature: 0`, `purpose: "field-normalisation"`
  for Langfuse tracking; consider caching proposals per (flow, column).
- **New-value folding** — deciding whether a newly-seen value joins an existing
  confirmed cluster vs starts a new one is a proposal the human still confirms;
  the overlay only ever reflects confirmed state.
