# Implementation summary — Guided annotation upload (v0.21.3)

- **Version**: 0.21.3 (**PATCH** — no schema change; all new state rides the
  existing `app_flow_nodes.config` jsonb)
- **Base branch**: `release/alpha-2`
- **Type**: `/enhance`
- **E2E coverage**: `apps/web/e2e/enhance-template-annotation.spec.ts`

Template field authoring moves out of Word and into the app. Uploading a
document into a "Generate document" step now opens a guided modal that detects
what the document is, offers an AI pass, lets the author review and edit fields
through structured controls, and only then writes an annotated template.

The change is contained in the modal. Node config gains three things and is
otherwise untouched: an explainer sentence above the upload control, an "Edit
fields" affordance, and a download invitation.

---

## 1. What the upload used to do

`POST /api/flows/[id]/nodes/[nodeId]/template` parsed the file and **rejected** a
`.docx` with no `{{ tag }}` placeholders (`NO_TEMPLATE_TAGS`), telling the author
to go back to Word and try again. A malformed annotation failed with a message
the author had to map onto a document they could not see.

Both failure modes are now handled inside the app.

## 2. Detection and branching

`classifyTemplateSource(text, tagCount)` (`packages/domain/src/entities/template-classification.ts`)
is pure and deterministic:

| Outcome | Condition | The modal offers |
|---|---|---|
| A `annotated` | any tag present | Continue with these, or let AI find missed fields |
| B `empty` | no tags, prose-poor | Add fields with AI, or a syntax cheat-sheet |
| C `filled` | no tags, prose-rich | Confirmation, then AI infers variables and strips values |
| D | AI returns nothing | Stated plainly, falls back to the manual path |

The heuristic scores each non-blank line as prose (≥ 8 words, or ≥ 5 with
figures and sentence-final punctuation) against structure (ends in a colon, is a
fill-in rule of dots/underscores, or is a short heading). **Ties resolve to
`filled`** — that path asks the author to confirm, so a wrong guess is caught by
a human, whereas a filled document mistaken for an empty one would have
placeholders inserted around live content.

## 3. The uploaded file is never staged server-side

The spec requires a filled example's source not to sit in the flow. The strongest
way to honour that is never to store it: the browser holds the `File` across the
modal's steps and re-sends it per request, and only the **annotated** result
reaches object storage. This removes the staging lifecycle, the quarantine
decision and the orphan-cleanup path entirely. Cost is up to three transfers of a
≤ 10 MB file on an authoring action.

## 4. The AI pass

`SuggestTemplateFields` (`packages/application/src/use-cases/document/suggest-template-fields.ts`)
returns `label` / `type` / `optional` / `options` / `sourceText` / `occurrence` /
`context` / `confidence`. Two properties make its output safe to write into a
document:

- **The annotation line is serialised server-side** by `templateFieldToLine` from
  the parsed structure. The model never writes the grammar, so it cannot emit a
  line that fails `parseTemplateField`.
- **Anchoring is verified.** A suggestion whose `sourceText` does not occur at
  its stated `occurrence` is dropped. This is what stops a hallucinated span from
  corrupting the document at annotate time.

A model failure returns zero suggestions rather than an error — the manual path
always works. Suggestions are ordered by position in the document.

## 5. Writing annotations into the document

New `annotate()` on `IDocumentGenerator`, taking occurrence-addressed
substitutions. One primitive covers all three cases:

| Case | `find` | `replacement` |
|---|---|---|
| Re-annotate a detected field | `{{ Supplier Name }}` | `{{ Supplier Name (text) (maxlen: 80) }}` |
| Strip a filled example's value | `Acme Pty Ltd` | `{{ Supplier Name (text) }}` |
| Remove a field | `{{ Supplier Name }}` | `` (empty) |

`DocxGenerator.annotate` works on reconstructed paragraph text via the existing
`extractRuns` / `buildRun` machinery, so a span Word split across runs is still
matched and the replacement inherits the `rPr` of the run it starts in.
`XlsxGenerator.annotate` operates on cell values, converting only touched cells to
inline strings. Both apply non-overlapping spans and report unmatched edits
rather than silently dropping them — a template that quietly missed half its
placeholders is worse than being told which ones did not land.

## 6. Annotation syntax — correction to the source spec

The spec as written used `{{ Supplier Name (text, maxlen: 80) }}`. The shipped
grammar uses **separate parenthesised groups**:

```
{{ Supplier Name (text) (maxlen: 80) }}
```

`extractAnnotationGroups` splits on `\(([^()]*)\)` and matches each group whole,
so a comma-separated group reads as one unknown annotation — and would be
ambiguous with `(options: A, B, C)`, whose values are themselves
comma-separated. The raw line is rendered by the existing `templateFieldToLine`,
because a teaching surface only teaches if it emits exactly what Word must hold.

## 7. Review grid

Per row: the shared field controls, the live raw annotation string, the
surrounding document line, and — on the filled path — the original value being
replaced. AI rows carry a `ConfidenceBar` reusing the platform's existing bands.

- **Blocking** (save disabled): unknown type, malformed braces or brackets, empty
  enum, missing field name. All delegated to `parseTemplateField` so the modal
  and the server reject exactly the same strings.
- **Warning** (dismissible, one-click fix): unrecognised modifier with a
  did-you-mean correction (`optoins:` → `options:`, edit distance ≤ 2 over the
  modifier vocabulary), and suspicious naming (stray spacing or trailing
  punctuation).
- **Informational**: duplicate names, shown as "asked once, fills 3 places".
- **Low-confidence rows** (< 50, matching the confidence bar's low band) are a
  separate gate: they need explicit per-row confirmation, not correction.

A line the author pasted back from Word still wrapped in `{{ }}` is accepted —
the raw string is the teaching surface, so round-tripping it is required.

### Section and group rows are preserved, not edited

`section` and `group` are multi-line Word constructs (`{{#name}} … {{/name}}`)
whose `templateFieldToLine` returns the stored raw open tag untouched. They
cannot be meaningfully edited in a flat grid, so they render as **locked rows**
and pass through `annotate()` unmodified. Dropping them would silently destroy
working templates.

## 8. ADR-039 interaction

ADR-039 fixes the precedence: any tag ⇒ tag mode. Annotating an `.xlsx` therefore
always converts it to tag mode, so `spreadsheetTemplateMode` is recomputed from
the **annotated** bytes rather than carried over.

A tagless workbook whose first row is a usable header already works today.
Running it through the guided flow would change its fill semantics from "one data
row beneath the header" to "fill each tagged cell in place", so the detection
step reports it as `header` and it is stored exactly as uploaded — every workbook
that works today keeps working.

## 9. The retrofit

The row controls — label input, type select, config cog, remove — moved out of
`structured-field-editor.tsx` into a shared `field-row.tsx` / `field-row-model.ts`
pair. Both the structured conversation editor and the new annotation editor
render it, so the accent-coloured cog (`data-configured`, driven by
`hasNonDefaultConfig`) applies in both places **by construction** rather than
being implemented twice. The structured editor is otherwise unchanged.

## 10. Re-entry

`PATCH` on the template route re-annotates the template already attached to the
node, with no re-upload — field configuration changes far more often than
templates are replaced. `GET` streams the annotated template back for the "keep
your master copy in sync" invitation. Both share the same `canEdit` authorisation
as `POST` and `DELETE`.

---

## Files

**New**

| Layer | File |
|---|---|
| domain | `entities/template-classification.ts` (+ test) |
| domain | `entities/template-annotation-validation.ts` (+ test) |
| application | `use-cases/document/suggest-template-fields.ts` (+ test) |
| web | `lib/template-annotation.ts` (+ test) |
| web | `lib/template-route-helpers.ts` |
| web | `components/canvas/field-row.tsx`, `field-row-model.ts` (+ test) |
| web | `components/canvas/template-annotation-modal.tsx`, `template-annotation-model.ts` (+ test) |
| web | `api/flows/[id]/nodes/[nodeId]/template/analyse/route.ts` |
| web | `api/flows/[id]/nodes/[nodeId]/template/suggest/route.ts` |
| e2e | `enhance-template-annotation.spec.ts` |

**Changed**

- `packages/domain/src/ports/document-generator.ts` — `annotate()` and its edit types
- `packages/adapters/src/documents/{docx,xlsx}-generator.ts` — `annotate()`
- `packages/adapters/src/documents/document-generator-router.ts` — dispatch `annotate`
- `packages/shared/src/schemas/document.ts` — `suggestedTemplateFieldsSchema`
- `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts` — annotations on `POST`, new `PATCH` and `GET`, shared auth/persist helpers
- `apps/web/src/components/canvas/structured-field-editor.tsx` — refactored onto the shared row
- `apps/web/src/components/canvas/node-config-modal{,-conversational}.tsx` — modal wiring, explainer, Edit fields, download
- `apps/web/src/app/(user)/flows/[id]/config/_content.tsx` — `applyTemplateResult` shared by both save paths

**E2E updated for the new flow** — `fix-template-upload-resets-output-type`,
`fix-prior-step-fields-stripped`, `phase-narrative-repeating-groups`,
`phase-spreadsheet-templates`. Each now mocks the detection step and, where
relevant, walks the guided modal; the behaviours they guard are unchanged.

## Deliberately not done

- **A help content registry.** The spec sources the explainer from one; none
  exists in the repo, and building it is not a patch-sized change. The sentence
  is inlined and the registry deferred.
- **Comma-separated annotation groups** — §6.
- **In-app authoring of `section` / `group`** — preserved, not editable.
- **Deleting the previous template file on re-upload.** Published flow versions
  snapshot the node config, so an older version still points at that storage key
  and must stay restorable. Only its retrieval chunks are dropped.

---

## Review revisions (same PR, pre-merge)

Follow-up changes after the first round of review, all inside the modal:

1. **Found fields are shown, not asked about blind.** The branch step now lists
   the detected data fields in two columns of bullets with the type in brackets
   (`rowTypeLabel`), so the author sees what was found before choosing. Wording
   changed throughout from "placeholders" to "data fields".
2. **Branch actions moved to the modal footer** — Cancel bottom-left, the branch
   actions (and the filled-example confirm/back) bottom-right, matching the rest
   of the dialog.
3. **Doubled annotation display fixed.** A `tag` row's surrounding-context line
   already contains the same `{{ tag }}`, so it was repeating the raw annotation
   line above it. Context is now shown only for AI `span` rows, whose context is
   real prose.
4. **"Add a field" removed.** A flat grid can't say where in the document a new
   field goes, so the button was replaced with a "Need to add more fields?
   Download…" block. Download hands the current document back (the uploaded file,
   or the stored template via GET on re-entry) and switches the modal to a
   re-upload panel; re-uploading restarts the flow from detection.
5. **Type-change regression fixed.** `EditableRow` now holds the `FieldModel` in
   state instead of re-deriving it from `line` each render. A single/multi-select
   with no choices yet serialises to a bare label (the grammar can't express an
   empty options list), so the old code reset the type back to text the instant
   it was chosen. `line` is still kept in sync for validation and serialisation.
   The structured conversation editor already held its models in state, so it was
   not affected the same way; both now behave identically.
6. **AI multi-select inference.** `suggestedTemplateFieldSchema` gained a
   `multiple` flag and the prompt now tells the model that a short comma/slash
   list of candidate values (e.g. "Mobile phone, Laptop") is a fixed set — split
   into options, with `multiple: true` when several can apply — so a filled
   example like that returns a multi-select rather than plain text.

### Second round

7. **Scrollable modal.** The modal now caps at `85vh` with a `flex` column
   layout; the body scrolls (`flex-1 overflow-y-auto`) while the header and
   footer stay fixed, so a long field list no longer runs past the window.
8. **Download moved to the footer.** The "add more fields" download left the
   scrolling body for the footer's bottom-left action area (beside Cancel), so it
   is always reachable regardless of scroll position.
9. **Download returns the annotated document.** A new
   `POST .../template/annotated` route applies the reviewed annotations with
   `IDocumentGenerator.annotate` and streams the bytes back without persisting —
   a fresh upload annotates the file in hand, re-entry annotates the stored
   template with the current edits. The author now downloads the marked-up
   document (a filled example's values already replaced with `{{ fields }}`),
   adds more in Word, and re-uploads.
10. **Two-column review row.** The metadata under each field is now two columns —
    the raw annotation line and "Replaces …" on the left, the confidence bar and
    an italic "In the document: …" context on the right — so a row reads without
    a tall stack.
11. **Single-node canvas zoom.** `fitView` is capped at `maxZoom: 1`
    (`fitViewOptions` on the canvas, and the >3-node refit), so one step is framed
    at the same scale as the empty "add your first step" canvas instead of the
    default max of 2.
