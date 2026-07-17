# Phase — AI Field-Value Normalisation for Flow Insights

- **Status**: Draft — awaiting `/doc-review`
- **Target version**: **MINOR** — **2.6.0** (new feature + schema change; ships
  after Insights Export & Summarisation at 2.5.0)
- **PRD**: `docs/development/prd/insights-ai-normalisation.prd.md`
- **ADR**: `docs/development/adr/032-normalisation-overlay-and-ai-propose-confirm.adr.md`
- **Base branch**: `main` (new features never target a `release/alpha-N` branch)
- **Depends on**: `ILanguageModel` (ADR-002), the `AiColumnMappingDetector`
  precedent (`packages/adapters/src/ai/`), `GetFlowDeepDive` /
  `computeFieldReport`, `app_session_step_outputs` (source of truth, untouched),
  existing `IAuditLogger` / `LogAuditEvent`

## 1. Goal

Reconcile inconsistent free-text field values ("Microsoft" / "Microsoft
Corporation" / "MS Corp") across a flow's sessions using an **AI-proposed,
human-confirmed** mapping applied as a **read-time overlay** — never mutating the
original — and built so it can be **re-run over time** as new sessions add new
values.

## 2. Approach

Per ADR-032. Captured values in `app_session_step_outputs` stay untouched. A new
`app_field_value_normalisations` table stores `rawValue → canonicalValue` per
field with a `status` (`proposed` | `confirmed` | `rejected`) and `confirmed_by`.
The deep-dive read path applies **confirmed** mappings as an overlay before the
`FieldReport` reaches the client, so the table, the xlsx export, and the pivot
drawer all normalise from one place. A raw ↔ normalised UI toggle keeps the
original one click away.

AI involvement is a single bounded `generateObject` (temp 0, sanitised output)
that only ever **proposes** clusters — mirroring `AiColumnMappingDetector`.
Persisting `confirmed` state is a separate, human-triggered, audited step.

**Re-runnable by construction:** `ProposeColumnNormalisation` proposes only for
distinct raw values that have **no existing mapping**, offers new values against
the existing confirmed canonical set first, and never revisits prior decisions.

## 3. What is built

### Domain (`packages/domain`) — pure, test-first

| File | Change |
|------|--------|
| `src/entities/field-value-normalisation.ts` (new) | `FieldValueNormalisation` + `NewFieldValueNormalisation` + `NormalisationStatus`. |
| `src/entities/field-report-normalisation.ts` (new) | `applyNormalisationOverlay(report, confirmedMappings)` — pure; substitutes confirmed canonical values per `(nodeId, fieldKey, rawValue)`. Also `distinctUnmappedValues(...)` helper for the incremental proposal filter. |
| `src/ports/normalisation-proposer.ts` (new) | `INormalisationProposer.propose({ label, values }) -> Result<{ clusters: { canonical: string; members: string[] }[] }>`. |
| `src/ports/field-value-normalisation-repository.ts` (new) | `IFieldValueNormalisationRepository`: `listByFlow`, `listConfirmedByFlow`, `upsertMany`, `setStatusMany`. |
| `src/ports/index.ts`, `src/entities/index.ts` | Export new symbols. |

Write the overlay and `distinctUnmappedValues` tests **first** (they are the
spec: originals untouched, only confirmed applied, new values fold correctly,
idempotent re-run).

### Application (`packages/application`)

| File | Change |
|------|--------|
| `src/use-cases/analytics/propose-column-normalisation.ts` (new) | Reads distinct raw values for `(flowId, nodeId, fieldKey)`, subtracts existing-mapping values, bounds the set, calls `INormalisationProposer`. Returns proposed clusters (not persisted). |
| `src/use-cases/analytics/confirm-column-normalisation.ts` (new) | Persists chosen mappings as `confirmed` / `rejected` (`upsertMany` + `setStatusMany`) with `confirmedBy`; emits the audit event via `IAuditLogger`. |
| `src/use-cases/analytics/get-flow-deep-dive.ts` | Load `listConfirmedByFlow` and apply `applyNormalisationOverlay` to the `FieldReport` before returning (behind the client's raw/normalised toggle — return both or a flag; simplest: always overlay, let the client toggle by requesting raw). |

### Adapters (`packages/adapters`)

| File | Change |
|------|--------|
| `src/ai/ai-normalisation-proposer.ts` (new) | Implements `INormalisationProposer` via `languageModel.generateObject` (zod schema, temp 0, `purpose: "field-normalisation"`); **sanitises** output so every member is an observed input value and no cluster is invented. |
| `src/db/schema/wayfinder.ts` | Add `app_field_value_normalisations` (see ADR-032): unique `(flow_id, node_id, field_key, raw_value)`, index on `flow_id`. |
| `src/repositories/drizzle-field-value-normalisation-repository.ts` (new) | Implements the repository port. |
| `drizzle/` | New migration for the table (generated via the repo's drizzle-kit flow). |

### Web (`apps/web`)

| File | Change |
|------|--------|
| `src/server/routers/analytics.ts` | `proposeNormalisation` + `confirmNormalisation` (adminProcedure). |
| `src/lib/container.ts` | Wire `AiNormalisationProposer`, the repository, and the two use-cases (inject `auditLogger` into confirm). |
| `src/components/admin/field-report-section.tsx` | Per-text-column **Normalise** action; **raw ↔ normalised** toggle (alongside the existing "Combine forked steps" toggles). |
| `src/components/admin/normalisation-confirm-dialog.tsx` (new) | Cluster review UI: canonical rename, merge/split, accept/reject per cluster; confirm calls `confirmNormalisation`. |

## 4. Preserving the original (non-negotiable)

- `app_session_step_outputs` is **read-only** to this feature — no update path.
- `raw_value` in the mapping table is a copy for keying/display; the overlay
  substitutes only in the derived `FieldReport`.
- A test asserts step-output rows are byte-for-byte unchanged after confirm.
- The UI toggle renders raw values on demand.

## 5. Re-runnable / incremental (explicit requirement)

- `ProposeColumnNormalisation` = `distinctRawValues − alreadyMappedValues`, then
  bound (top-N by frequency / chunk), then propose.
- New values are offered against the **existing confirmed canonical set** first,
  so "Microsoft Inc." folds into a confirmed "Microsoft" rather than a new
  cluster.
- `confirmed` / `rejected` rows are never re-proposed or overwritten.
- Empty remainder ⇒ empty proposal ⇒ cheap no-op (safe on a schedule or on
  demand).

## 6. Audit event

Reuses `core_audit_log` via `IAuditLogger` — **no new audit table**:

```
action:        "insights.normalisation_confirmed"
resourceType:  "flow"
resourceId:    <flowId>
actorId:       <confirming user id>
metadata:      { nodeId, fieldKey, confirmed: <count>, rejected: <count> }
```

## 7. Database changes

New table `app_field_value_normalisations` (prefix `app_`, valid) — schema in
ADR-032 Decision 2. `id` / `created_at` / `updated_at` present per the table
rules. No change to any existing table.

## 8. Implementation order (tests first)

1. `field-value-normalisation.ts` entity.
2. `field-report-normalisation.ts` overlay + `distinctUnmappedValues` + tests.
3. Ports (`INormalisationProposer`, repository) + schema/migration.
4. `AiNormalisationProposer` + sanitisation test (drops hallucinated members).
5. Drizzle repository + test.
6. `ProposeColumnNormalisation` / `ConfirmColumnNormalisation` + tests
   (incremental filter; audit emit).
7. Overlay wired into `GetFlowDeepDive`; step-output-immutability test.
8. tRPC procedures + container wiring.
9. Web: Normalise action, confirm dialog, raw/normalised toggle.
10. `./validate.sh`; bump `VERSION` + `package.json#version` to 2.6.0.

## 9. Risks / open questions

Carried from PRD §12: wrong merges (mitigated by human confirm + sanitisation +
non-destructive overlay + raw toggle); scale of distinct values (bound input +
incremental filter); model cost/determinism (temp 0, Langfuse purpose, optional
per-column caching); new-value folding remains a human-confirmed proposal — the
overlay only reflects confirmed state.

## 10. Acceptance criteria

Mirror PRD §10:

- [ ] `Normalise` on a text column returns AI-proposed clusters; every member is
      an actually-observed value (sanitised).
- [ ] Operator can rename canonical, merge, split, accept/reject per cluster.
- [ ] Confirmed mappings normalise the table, export, and pivot via one overlay;
      raw ↔ normalised toggle works.
- [ ] `app_session_step_outputs` is provably unmodified (test).
- [ ] Re-run proposes only unmapped values, folds new values into confirmed
      clusters where matched, never changes prior decisions; empty remainder is a
      no-op.
- [ ] Each confirmation emits `insights.normalisation_confirmed` with the
      metadata above.
- [ ] Only `text` columns are offered normalisation; tests precede
      implementation; `./validate.sh` passes with `VERSION` /
      `package.json#version` matched at 2.6.0.
