# Enhancement — Guided annotation upload

- **Version**: 0.21.3 (bump: **PATCH** — no schema change; all new state rides the
  existing `app_flow_nodes.config` jsonb)
- **Base branch**: `release/alpha-2`
- **Type**: `/enhance`
- **Status**: Awaiting review
- **PRD**: none — enhancement scoped by this document, per the convention of
  v0.21.1 / v0.21.2
- **Depends on**: template field grammar (`packages/domain/src/entities/template-field.ts`),
  `IDocumentGenerator` (ADR-039 xlsx parity), structured conversation field editor
  (ADR-038 §5), per-message confidence semantics (`apps/web/src/components/chat/confidence-bar.tsx`)

## 1. Problem

Template field authoring happens in Word today. The author must learn the
`{{ Field Name (annotation) }}` grammar, type it by hand, and only discovers a
mistake when the document fails to render mid-session. Two failure modes follow:

- **Syntax errors surface late.** `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts`
  rejects a tagless `.docx` outright with `NO_TEMPLATE_TAGS` and tells the author
  to go back to Word. A malformed annotation fails `parseTemplateFields` with a
  message the author must map back onto a document they cannot see.
- **Authors never learn the syntax at all.** There is no in-app path from "here
  is my document" to "here are its fields", so the grammar stays a Word-only
  concern that most authors never acquire.

This phase moves field authoring into the app: upload a document, have the
system detect / infer / validate placeholders, edit them through structured
controls, and persist an annotated template.

## 2. Goals

- Accept **either** an empty template (structure, no content) or a filled example
  (a real past document) — the system infers which, with no upfront question.
- A guided modal that opens immediately on upload and shows a loading indicator
  for every processing step.
- An **AI pass** that proposes fields: inserting placeholders into an empty
  template, or inferring variable-vs-boilerplate spans in a filled example and
  stripping the sample values.
- A **review grid** using the *same* row component as the structured conversation
  field editor, with a live-updating raw annotation string per row — the teaching
  surface that makes the Word round-trip viable.
- Persist the **annotated** document as the node's template. A filled example's
  source is never persisted.
- **Re-entry** into the field editor from node config without re-uploading.
- **Retrofit**: accent-coloured config icon when any non-default option is set,
  in both this editor and the structured conversation field editor.

## 3. Non-goals

- Changing how node config renders outside the template block (one explainer
  sentence, an "Edit fields" affordance and a download invitation are the only
  additions).
- A help content registry. The spec calls for one; none exists in the repo and
  building it is out of scope for a patch — the explainer is inlined and the
  registry deferred.
- Comma-separated annotation groups (`(text, maxlen: 80)`). See §4.1.
- Authoring `section` / `group` constructs in-app. They are preserved, not edited.
- Changing the generation-time render path (`DocxGenerator.generate`).

## 4. Approach

Build strictly bottom-up (domain → application → adapters → web), writing the
test file before each implementation file (CLAUDE.md rule). All ports return the
Result pattern; nothing throws across a package boundary.

### 4.1 Annotation syntax — correction to the source spec

The source spec writes `{{ Supplier Name (text, maxlen: 80) }}`. The shipped
grammar in `parseTemplateField` uses **separate parenthesised groups**:

```
{{ Supplier Name (text) (maxlen: 80) }}
```

`extractAnnotationGroups` splits on `\(([^()]*)\)` and each group is matched
whole against the modifier vocabulary, so a comma-separated group would be read
as one unknown annotation. Adopting the comma form would also be ambiguous with
`(options: A, B, C)`, whose values are themselves comma-separated.

The raw annotation line is therefore rendered by the existing
`templateFieldToLine` and wrapped in braces. This is deliberate: the teaching
surface only teaches something useful if it emits exactly what Word must contain.

### 4.2 The uploaded file is never staged server-side

The spec requires that a filled example's source "must not sit in the flow". The
strongest way to honour that is to never store it. The client holds the `File`
in memory across the modal's steps and re-sends it with each request; only the
**annotated** result is written to object storage. This removes the staging
lifecycle, the quarantine decision, and the orphan-cleanup path entirely.

Cost: the file crosses the wire up to three times (≤ 10 MB, existing cap). This
is an authoring-time action, not a hot path.

### 4.3 Detection and branching (Step 0)

`classifyTemplateSource(text, tagCount)` in the domain, pure and deterministic:

| Outcome | Condition | Modal offers |
|---|---|---|
| A `annotated` | `tagCount > 0` | Continue with these → Step 1; or run the AI pass for missed fields, then Step 1 with suggestions visually distinct |
| B `empty` | no tags, low content density | Add fields with AI → Step 1; or show the cheat-sheet + starter template and close |
| C `filled` | no tags, high content density | Explicit confirmation that their values will be replaced with fields, then AI pass → Step 1 |
| D — | AI pass returns nothing | State it plainly, fall back to the manual path. Never render an empty grid |

Density heuristic: over non-blank lines, score the fraction that read as prose
(≥ 8 words, or containing digits alongside words) versus as bare labels (ends
`:`, is a run of underscores/dots, or is a short heading). Below the prose
threshold ⇒ `empty`. **Ambiguous cases resolve to `filled`**, per spec — that
path demands confirmation anyway, so a wrong guess is caught by the user.

### 4.4 The AI pass

`SuggestTemplateFields` returns, per suggestion: `label`, `type`, `optional`,
`options`, `maxLength`, `sourceText`, `occurrence`, `context`, `confidence`.

Two safeguards make the model's output trustworthy:

1. **The annotation line is serialised server-side** by `templateFieldToLine`
   from the parsed structure. The model never emits raw grammar, so it cannot
   produce a line that fails `parseTemplateField`.
2. **Anchoring is verified.** A suggestion whose `sourceText` does not occur in
   the extracted document text at `occurrence` is dropped. This is what stops a
   hallucinated span from silently corrupting the document at annotate time.

If every suggestion is dropped, the route reports zero suggestions and the modal
takes outcome D.

### 4.5 Writing annotations back into the document

New `annotate()` method on `IDocumentGenerator`, taking occurrence-addressed
span replacements. One primitive covers all three cases:

| Case | `find` | `replacement` |
|---|---|---|
| Re-annotate a detected field | `{{ Supplier Name }}` | `{{ Supplier Name (text) (maxlen: 80) }}` |
| Strip a filled example's value | `Acme Pty Ltd` | `{{ Supplier Name (text) }}` |
| Insert into an empty template | the label/anchor text | anchor + `{{ Supplier Name (text) }}` |

`occurrence` disambiguates repeated identical text, so "Acme Pty Ltd" appearing
three times is addressed as three separate edits.

`DocxGenerator.annotate` works on the reconstructed paragraph text (the same
`extractRuns` / `buildRun` machinery `fixParagraphTags` already uses), so a span
split across runs by Word's spell-check boundaries is still matched, and the
replacement inherits the `rPr` of the run it starts in. `XlsxGenerator.annotate`
operates on cell values.

Edits are applied **right-to-left within each paragraph** so earlier offsets stay
valid.

### 4.6 Section and group fields are preserved, not edited

`section` and `group` are multi-line Word constructs — `{{#name}} … {{/name}}` —
whose `templateFieldToLine` returns the stored `raw` open tag untouched. They
cannot be meaningfully edited in a flat grid. They render as **locked rows**
showing the raw tag, and pass through `annotate()` unmodified. Dropping them
would silently destroy working templates.

### 4.7 Interaction with ADR-039 xlsx mode precedence

ADR-039 fixes the precedence: any `{{ tag }}` in a workbook ⇒ tag mode, otherwise
header-row mode. Annotating an `.xlsx` writes tags into it, so an annotated
workbook is **always** tag mode. Two consequences the implementation must honour:

- `spreadsheetTemplateMode` is recomputed from the *annotated* bytes, never
  carried over from the pre-annotation scan.
- A header-row workbook the author chooses to annotate converts to tag mode, and
  its header cells stop being field sources. The modal must therefore not offer
  the AI pass for a workbook already classified `header` unless the author
  explicitly opts in, since accepting it silently changes the fill semantics from
  "one data row beneath the header" to "fill each tagged cell in place".

Detection order for `.xlsx` is: tags present ⇒ outcome A; else a usable header row
⇒ treat as already-configured (header mode, no modal, today's behaviour); else
⇒ classify empty/filled and run the guided flow. This keeps every workbook that
works today working unchanged.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/template-classification.ts` (new) | `classifyTemplateSource`, `TemplateSourceKind` |
| domain | `packages/domain/src/entities/template-annotation-validation.ts` (new) | `validateAnnotationLine` → blocking errors + dismissible warnings; `suggestModifierCorrection` (edit distance ≤ 2 over the modifier vocabulary); `findDuplicateLabels` |
| domain | `packages/domain/src/ports/document-generator.ts` | add `AnnotateInput` / `AnnotateOutput` / `TemplateAnnotationEdit`; add `annotate()` to `IDocumentGenerator` |
| domain | `packages/domain/src/index.ts` | export the above |
| shared | `packages/shared/src/schemas/document.ts` | `suggestedTemplateFieldsSchema` for the AI object call |
| application | `packages/application/src/use-cases/document/suggest-template-fields.ts` (new) | the AI pass; server-side line serialisation; anchor verification |
| application | `packages/application/src/use-cases/document/index.ts` | export |
| adapters | `packages/adapters/src/documents/docx-generator.ts` | implement `annotate()` |
| adapters | `packages/adapters/src/documents/xlsx-generator.ts` | implement `annotate()` |
| web | `apps/web/src/lib/container-document-use-cases.ts` | wire `suggestTemplateFields` |
| web | `apps/web/src/components/canvas/field-row.tsx` (new) | shared row: label input, type select, config cog (**accent when non-default**), remove; `FieldModel`, `lineToModel`, `modelToLine`, `hasNonDefaultConfig`, `FieldConfigModal` — all moved out of `structured-field-editor.tsx` |
| web | `apps/web/src/components/canvas/structured-field-editor.tsx` | refactor onto `field-row.tsx`; no behaviour change beyond the cog colour |
| web | `apps/web/src/components/canvas/template-annotation-model.ts` (new) | pure step machine + row derivation + save-gating; unit-tested without React |
| web | `apps/web/src/components/canvas/template-annotation-modal.tsx` (new) | the guided modal |
| web | `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/analyse/route.ts` (new) | parse + classify, no persistence |
| web | `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/suggest/route.ts` (new) | run the AI pass |
| web | `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts` | `POST` accepts `annotations`; drop the `NO_TEMPLATE_TAGS` hard reject when annotations are supplied; `PATCH` re-annotates the stored template (re-entry); `GET` streams it (download invitation) |
| web | `apps/web/src/components/canvas/node-config-modal-conversational.tsx` | explainer sentence, "Edit fields", download invitation |
| web | `apps/web/src/components/canvas/node-config-modal.tsx` | open the modal from `handleFileChange` |
| e2e | `apps/web/e2e/enhance-template-annotation.spec.ts` (new) | upload → detect → review → save |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — classification.** `template-classification.test.ts` first: tagged
   input ⇒ `annotated`; label-only skeleton ⇒ `empty`; prose-heavy document ⇒
   `filled`; ambiguous ⇒ `filled`; empty string ⇒ `empty`. Then implement.

2. **Domain — validation.** `template-annotation-validation.test.ts` first:
   unknown type / unclosed braces / empty enum ⇒ blocking; `optoins:` ⇒ warning
   carrying the corrected line; leading-trailing whitespace and trailing
   punctuation ⇒ dismissible warning; duplicate labels ⇒ informational, never
   blocking. Then implement.

3. **Domain — port.** Add the `annotate()` signature and edit types. Pure type
   additions; the adapters' tests cover behaviour.

4. **Application — AI pass.** `suggest-template-fields.test.ts` first with a stub
   `ILanguageModel`: suggestions round-trip through `templateFieldToLine`; a
   suggestion whose `sourceText` is absent is dropped; a model error returns an
   empty suggestion list rather than failing the upload; `occurrence` beyond the
   actual count is dropped. Then implement.

5. **Adapters — `annotate()`.** `docx-generator.test.ts` additions first: replace
   an existing tag; replace a literal span; a span split across runs; two
   occurrences of identical text addressed separately; formatting (`rPr`)
   preserved; a `{{#section}}` block passed through untouched. Same shape for
   `xlsx-generator.test.ts` over cell values. Then implement. `./validate.sh`.

6. **Web — shared row component.** `field-row.test.tsx` first, covering
   `hasNonDefaultConfig` across every option and the accent class it drives.
   Extract from `structured-field-editor.tsx`, refactor that file onto it, and
   confirm its existing tests still pass unchanged. `./validate.sh`.

7. **Web — modal model.** `template-annotation-model.test.ts` first: step
   transitions for outcomes A–D; save gated while a blocking error stands; save
   gated until every low-confidence row is confirmed; rows ordered by document
   position; filled-path rows carry their original value. Then implement.

8. **Web — routes.** Extend `document.test.ts` coverage for the template route:
   annotations applied on `POST`; a tagless `.docx` accepted when annotations are
   supplied and still rejected when they are not; `PATCH` re-annotates without a
   file; `GET` streams the stored template; authorisation matches the existing
   `canEdit` rule on every verb.

9. **Web — modal and node config.** Build `template-annotation-modal.tsx` and
   wire it. `./validate.sh`.

10. **E2E.** `enhance-template-annotation.spec.ts`.

11. **Ship.** Move this doc to `docs/development/implemented/alpha-2/v0.21.3/`,
    write the summary, bump `VERSION` + root `package.json` to `0.21.3`, run
    `./validate.sh`, push, open the PR against `release/alpha-2`.

## 7. Validation rules

| Severity | Condition | Behaviour |
|---|---|---|
| Blocking | Unknown type | Save disabled until resolved |
| Blocking | Unclosed or malformed braces | Save disabled; line context shown |
| Blocking | Malformed enum (`options:` with no values) | Save disabled |
| Warning | Unrecognised modifier | Did-you-mean (`optoins:` → `options:`), one-click accept |
| Warning | Suspicious naming (leading/trailing whitespace, trailing punctuation) | Inline note, dismissible |
| Info | Duplicate field names | "asked once, fills 3 places" — never blocking |

Blocking rules delegate to `parseTemplateField` so the modal and the server
reject exactly the same strings. Low-confidence AI rows are a separate save gate:
they require explicit per-row confirmation, not correction.

## 8. Risks

- **Span replacement corrupting a document.** Mitigated by anchor verification
  before any write, right-to-left application within a paragraph, and adapter
  tests over run-split spans and preserved `rPr`.
- **AI inference missing or over-reaching on a filled example.** Mitigated by the
  mandatory `original value → field` display per row, which is the primary check
  on that path, and by the low-confidence confirmation gate.
- **Grid overload.** The readability constraint is explicit: if the grid needs a
  legend, something moves to progressive disclosure. Context and validation
  detail live behind per-row disclosure, not in the default scan.
- **Three uploads of a 10 MB file.** Accepted (§4.2); authoring-time only.
