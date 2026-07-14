# ADR-032 — Repeating / Structured Groups in Templates

- **Status**: Proposed (scoped by `narrative-repeating-groups.phase.md`, target v2.5.0)
- **Date**: 2026-07-14
- **Builds on**: ADR-009 (document generation via docx-js / docxtemplater),
  v1.19.0 (narrative fields + optional sections — two new `TemplateFieldType`s
  and the `string | boolean` render widening)
- **Amends**: nothing. This is purely additive over the shipped narrative-field
  model; it does not change any decision in an existing ADR.

## Context

Wayfinder templates can carry typed scalar tags, a `narrative` field (composed
prose), and a `section` boolean gate (v1.19.0). What they cannot express is a
block that **repeats over a list of structured records** — a recommendations
table, an options appraisal, an action list with owners and due dates, or a set
of evaluation findings (supplier × topic × finding).

The blocker is a single primitive. Every boundary a value crosses is scalar- or
boolean-shaped:

- **Extraction** — `extractStructuredFields` (`structured-fields.ts`) calls
  `languageModel.generateObject({ schema: documentDataSchema })` where
  `documentDataSchema = z.record(z.string())` — a flat `Record<string, string>`.
- **Render** — `GenerateDocxInput.data` is `Record<string, string | boolean>`.
- **Persistence** — `StepOutputField.value` is `string`.
- **Reporting** — `computeFieldReport` emits one column per scalar/section field.

A repeating group needs an `Array<Record<string, string>>` to survive all four.
Lifting this one constraint is the whole point of the phase, and it is the same
constraint that later blocks two deferred use cases — external classifier output
landing in session context (n8n auto-node, ADR-013) and an in-app
`structured_extraction` conversational output. Those are **out of scope here**
(see *Deferred*); this ADR settles only the group primitive and the four
decisions the phase doc (`narrative-repeating-groups.phase.md` §3.5, §5) left
open.

The reusable docx primitives (`TemplateField`, `buildFieldConstraintsText` +
`generateObject`, `StepOutputField`, `computeFieldReport`) stay the spine, as
they did for ADR-013 — no parallel system.

## Decision

### 1. `group` is a new `TemplateFieldType` carrying `itemFields`

`TemplateFieldType` gains `"group"`. `TemplateField` gains an optional
`itemFields?: TemplateField[]` — the parsed layout of **one** item — and an
optional `itemCap?: number` (see §5).

```ts
// packages/domain/src/entities/template-field.ts
export type TemplateFieldType =
  | "text" | "date" | "currency" | "number" | "email"
  | "yesno" | "narrative" | "section"
  | "group";                       // NEW

export interface TemplateField {
  // …existing…
  itemFields?: TemplateField[];    // NEW — one item's sub-fields (group only)
  itemCap?: number;                // NEW — hard max items (group only; default 20)
}
```

`itemFields` are ordinary `TemplateField`s (scalars/narrative), parsed by the
**same** `parseTemplateField` path. A group's sub-fields are always relative to
the item, never top-level.

### 2. Tag-classification rule: implicit — inner tags mean group

A `{{#name}} … {{/name}}` block is classified at parse time:

- **body contains inner `{{sub-tag}}`s → `group`**, whose `itemFields` are the
  parsed inner tags.
- **body contains no inner tags → `section`** (the v1.19.0 boolean gate,
  unchanged).

No new sigil, no required annotation — this matches the phase doc and keeps one
tag vocabulary. The known trade-off is recorded as a risk: an author who places
a tag inside a block that was meant as a boolean gate changes its meaning. The
template-upload dry-run (already run on save) surfaces the resulting field shape,
and the help dialog documents the rule, so the reclassification is visible before
a template is used.

> **Nesting is not supported in v1.** A `group` inside a `section` (or a
> `section`/`group` inside a `group`) is a **validation error** with a clear
> message, raised by the same dry-run that validates tags today. Lifting this is
> a later phase, gated on a real template needing it. This bounds the parser and
> the extraction schema to a single level, which is the main reliability lever.

### 3. Extraction: nested schema, best-effort coercion, completeness note

`documentDataSchema` widens from `z.record(z.string())` to admit an array arm:

```ts
// packages/shared/src/schemas/document.ts
export const documentDataSchema = z.record(
  z.union([z.string(), z.array(z.record(z.string()))]),
);
```

`extractStructuredFields` builds the group's item schema from its `itemFields`
and instructs the model to emit an array capped at `itemCap` (§5), with **each
sub-field key required** in the per-item constraints block. Behaviour on a
returned array is **best-effort**, consistent with the existing
`persistStepOutput` path (ADR-013 §5):

- valid items are kept; items over the cap are dropped;
- within a kept item, missing/invalid sub-fields are left blank;
- coercion **never fails the turn**.

On top of best-effort, the engine surfaces a **soft completeness note** (not a
hard failure) when the array is **empty** or a kept item is **missing a required
sub-field**, so the operator can react ("no suppliers were extracted";
"Supplier B has no Pricing finding"). This is the intake-completeness signal the
procurement review asked for, delivered without introducing a declared
"expected set" concept in v1.

### 4. Persistence + reporting: additive inline, count-only

**Persistence is additive on `StepOutputField`.** A parallel optional field
carries the group's items; `value: string` is untouched, so existing rows and
all existing readers keep working with no migration of data.

```ts
// packages/domain/src/entities/session-step-output.ts
export interface StepOutputField {
  key: string;
  label: string;
  type: TemplateFieldType;
  options?: string[];
  value: string;                          // unchanged (blank for a group)
  items?: Array<Record<string, string>>;  // NEW — present only for type "group"
}
```

Choosing the additive inline shape (over "keep groups out of step outputs
entirely") means group data **lives in session context and can flow to later
steps** — the property the deferred external-classification and
`structured_extraction` paths will need — without a second migration when those
land.

**Reporting is count-only.** `computeFieldReport` emits, for a `group`, at most a
single per-session **count column** (`items.length`) — analogous to how it
already `continue`s past `narrative` and passes `section` through as Yes/No. It
**never** emits per-item columns and **never** emits prose. Per-sub-field
aggregates and side-by-side item comparison are explicitly out of scope for v1;
if reporting later needs them, that is its own phase, not a widening bolted on
here.

Principle carried forward from v1.19.0: **separate reportable signals from
rendered content.** A group renders in full in the document; only its count is
reportable.

### 5. Item cap: default 20, per-group overridable

Every group has a hard item cap — the primary guard against unbounded or
degenerate array extraction. Default **20**. A group may override it on its open
tag:

```
{{#suppliers (max: 50)}} … {{/suppliers}}
```

`(max: N)` on a **group** open tag sets `itemCap` (array length). This reuses the
existing `(max: N)` annotation token but on the group tag, where it means *item
count* — distinct from `(max: N)` on a **numeric scalar**, where it means *value
ceiling*. The two never collide because they annotate different field types;
parsing resolves the meaning from the tag it sits on. `{{#name}}` open-tag
annotations are **new parsing** (section sigils carry no annotations today).

### 6. Render binding

`GenerateDocxInput.data` widens to add the array arm:

```ts
data: Record<string, string | boolean | Array<Record<string, string>>>;
```

docxtemplater's `paragraphLoop` already iterates an array bound to a
`{{#name}} … {{/name}}` block, rendering the inner tags once per item with
**template-controlled** layout. The docx-generator's parsing must scope inner
tags to their enclosing section (associate them with the group) rather than
emitting them as top-level fields — the one substantial new parsing task, since
`collectRawTags` is paragraph-flat today.

## Consequences

**Positive**

- One structured-data system still. Groups reuse `TemplateField`,
  `generateObject`, `StepOutputField`, and `computeFieldReport`; nothing parallel.
- The `Array<Record<string,string>>` primitive is unlocked once, additively, and
  is the exact shape the deferred external-classification (ADR-013) and
  `structured_extraction` paths will consume — no second migration to enable them.
- No data migration: `value: string` is preserved; `items?` and the group
  count-column are additive; existing reports are untouched.
- Single-level-only + hard item cap + required per-item sub-field keys +
  completeness note together give a concrete, testable reliability story for the
  hardest case (nested-array extraction).

**Negative**

- Implicit classification (§2) can silently reclassify a boolean gate as a group
  if an author adds an inner tag. Mitigated by the upload dry-run and the help
  dialog; not eliminated.
- The docx-generator inner-tag scoping is real new parsing over the
  paragraph-flat `collectRawTags`, and must not regress the existing
  section/narrative rendering — covered by the existing docx tests plus new ones.
- Best-effort coercion can still blank a wrong-typed sub-field (accepted, and
  consistent with existing docx/n8n behaviour); the completeness note makes the
  most damaging case — an empty or thin array — visible rather than silent.
- Count-only reporting will **not** satisfy a side-by-side supplier-comparison
  reporting need; that is deliberately deferred and must not be assumed by the
  build.

## Deferred (not this ADR)

- **External heavy classification** (e.g. Womblex) landing a group in session
  context via the shipped n8n auto-node — depends on this primitive; a
  `responseField` being a group and the inbound coercion handling arrays is a
  small additive follow-on once this ships.
- **`structured_extraction` conversational output type** — an in-app step that
  emits a capped array from conversation + uploads. Overlaps this extraction
  path; build only after this proves array extraction reliable end-to-end.
- **Nested groups/sections** (§2).
- **Per-item / per-sub-field reporting and cross-item comparison** (§4).
