# Bug fix — the signature tag is lost in the annotation editor, and a lone slot is never signed

- **Reported**: 2026-08-08
- **Severity**: Major — silent data loss in the author's own template, plus
  approvals that report success while signing nothing
- **Base branch**: `release/alpha-2`
- **Version**: 0.26.1 → **0.26.2** (PATCH — no schema change)
- **Relates to**: ADR-043 (signature slots), `approval-subject.prd.md`

## Symptom, as reported

> I can't see the (approval) / (signature) tags in the modal for the tags to
> ingest in the document. When I uploaded the document it seems to try to convert
> this to a text field (it should be a signature), including in the edit fields
> part of the modal which didn't have approval or signature as an option.
>
> On the approval configuration, if a signature exists on the "what is being
> approved" step, it should then open a second drop-down which shows (to select)
> the signature fields that applies (so it knows what to sign in the document).

## Reproduction

1. Author a `.docx` containing `{{ Delegate Sign Off (approval) }}`.
2. Attach it to a conversational step that generates a document. The guided
   annotation modal opens.
3. **Fault 1** — the found-fields list names the row `(Text)`. Choose
   *Edit fields*: the type dropdown offers Text, Number, Currency, Date, Email,
   Yes / No, Single-select, Multi-select, Narrative — and no signature. The row
   sits on Text.
4. Touch that row at all (change its name, its type, open the cog). The line
   under it now reads `{{ Delegate Sign Off (optional) }}`. Save. The stored
   `.docx` is rewritten with that line and the signature slot is gone.
5. **Fault 2** — open the annotation reference from the modal. `(approval)` is
   not listed anywhere, so there was no way to learn the tag existed.
6. **Fault 3** — with the template's signature intact (accept the fields without
   editing them), add an approval step, set *What is being approved?* to that
   step. No signature dropdown appears; the modal states "On approval, the
   decision is written into that step's signature". Run the flow and approve.
   The document is never signed and no revision is written.

## Root cause

Three independent faults. Fault 3 is the one that produces a wrong document;
fault 1 is the one that destroys the author's file.

### Fault 1 — the editor cannot represent a signature, so it rewrites it

`apps/web/src/components/canvas/field-row-model.ts` declares `FieldRowType`, the
editor's own narrower vocabulary, with no `signature` member. `fieldRowTypeOf`
narrows a parsed `TemplateField` onto it and ends in:

```ts
default:
  return "text";
```

So a `signature` field loads as `text` carrying `optional: true` (which the
parser sets implicitly on every signature). `modelToLine` then serialises the
model back through `templateFieldToLine`, which — correctly, for a `text` field
— emits `(optional)`.

Verified by running the two functions directly:

```
lineToModel("Delegate Sign Off (approval)")
  → { label: "Delegate Sign Off", type: "text", optional: true, options: [] }
modelToLine(that)
  → "Delegate Sign Off (optional)"
```

This is not confined to the editor's state. `TemplateAnnotationModal` recomputes
`row.line` from the model on every edit, `toPayloadRows` sends those lines to the
template route, and `buildAnnotationEdits` turns each one into a find/replace
applied to the stored document bytes. **The author's `.docx` is rewritten with
the signature removed.**

The compiler could not catch this. ADR-043's own consequences section warned that
a new `TemplateFieldType` "touches every exhaustive `switch` over field types…
Missing one is a silent wrong-behaviour bug" — but `fieldRowTypeOf` is not
exhaustive. Its `default:` arm turns the unhandled case into plausible wrong
behaviour instead of a type error.

Two related gaps follow from the same missing member: `TEMPLATE_TYPE_OPTIONS`
cannot offer a signature, and `FieldConfigModal` would offer a Required toggle
and a max-length box for a field that `parseTemplateField` rejects with either.

### Fault 2 — `(approval)` is documented nowhere the author looks

`MODIFIER_VOCABULARY` in `template-annotation-validation.ts` has carried
`approval` since ADR-043, so the parser accepts it and did-you-mean corrections
target it. But neither author-facing surface lists it:

- `annotation-reference.tsx` — the "complete list of annotations", reachable from
  the modal, whose comment claims "The complete annotation grammar, as the author
  types it into Word."
- `template-tags-help-dialog.tsx` — `TYPE_ROWS` and `COMBINED_EXAMPLES`.

A grammar feature that no author-facing surface mentions is a feature nobody can
use, and the one comment asserting completeness was wrong.

### Fault 3 — "bound automatically" binds nothing

`signatureSlotControl` (`approval-node-config.ts`) returns `{ mode: "auto", key }`
for exactly one slot, and `NodeConfigModalApproval` renders no control for that
mode — only the reassuring sentence "On approval, the decision is written into
that step's signature and the document is saved as a new version."

Nothing acts on `mode.key`. It is computed, returned, and never read by anything
that writes config. `values.signatureFieldKey` stays `""`, so
`approval-config-mapping.ts` omits `signatureFieldKey` from the saved node
config entirely.

At decision time `DecideApproval.resolveSubject` reads:

```ts
return { description, nodeId, signatureFieldKey: config.signatureFieldKey ?? null };
```

with no fallback. A null key means `SIGNATURE_FIELD_KEY` is never written into
`recordSnapshot`, so `ApplyApprovalSignature` returns
`{ applied: false, reason: "no_signature_slot" }` at its first guard.

**Every single-signature template goes unsigned**, which is the common case — one
delegate signature on one instrument. Only a 2+ slot template ever reached the
dropdown and therefore ever got signed. The user's request for a dropdown is
correct, and for a stronger reason than the one given: the missing control is not
just invisible, it is the reason nothing signs.

## Fix plan

### 1. Make `signature` a first-class editor type

`field-row-model.ts`:
- Add `signature` to `FieldRowType`.
- Give `fieldRowTypeOf` an explicit `case "signature"` arm, and make the narrowing
  exhaustive so the next added type is a build failure rather than a silent
  `text`.
- `modelToLine` emits the signature line via `templateFieldToLine`, which already
  returns `` `${label} (approval)` `` for the type.
- Add `{ value: "signature", label: "Signature (approval)" }` to
  `TEMPLATE_TYPE_OPTIONS` only. `STRUCTURED_TYPE_OPTIONS` must not gain it —
  ADR-043 §2 rejects `signature` in a structured field set.
- `withType` drops every constraint when switching to signature, since
  `parseTemplateField` rejects `maxlen` / `min` / `max` / `multiple` on one, and
  forces `optional: true` to match what the parser produces.
- `hasNonDefaultConfig` must not treat a signature's implicit `optional: true` as
  author-set configuration, or every signature row shows an accented cog.

`field-row.tsx`: `FieldConfigModal` renders no Required toggle and no constraint
controls for a signature — just a line saying the slot is filled by its approval
step.

### 2. Document `(approval)`

Add the signature entry to `annotation-reference.tsx` ("Kinds of value") and to
`template-tags-help-dialog.tsx` (`TYPE_ROWS` plus a combined example), each
stating that the operator is never asked for it.

### 3. Bind the slot

`approval-node-config.ts`: drop `mode: "auto"`. `signatureSlotControl` returns
`none` for zero slots and `choose` for one or more.

`node-config-modal-approval.tsx`: render the dropdown for `choose`. With exactly
one slot the value is pre-selected and the hint says which signature the step
will sign. When the subject is the default ("the last completed step") the
template is unknowable at config time, so show a hint saying a signature can only
be targeted once a specific step is named.

The pre-selection must be a real write to `values.signatureFieldKey`, not a
display default — a display-only default would leave config empty and reproduce
the original bug.

`decide-approval.ts`: when `config.signatureFieldKey` is empty and the subject
step declares **exactly one** signature, bind that slot. This retro-fixes flows
already saved under the old auto mode without requiring an author to reopen every
approval step.

Deliberately narrow: with two or more slots an empty key stays unbound. Guessing
would write a named person's attestation into the wrong signature line on a
governance document — worse than not signing.

## Out of scope

- `signatureSlotsFor` returns nothing when the subject is the default rather than
  a named step. That is correct — the subject step, and therefore its template,
  is not known until the session runs — so it gets the explanatory hint rather
  than a fix.
- Templates already rewritten by fault 1 are not repaired. The `(approval)` tag
  was overwritten in the stored `.docx` and the original bytes are not retained
  (the annotate path stores only the derived document). Affected authors must
  re-add the tag, in Word or via the now-available Signature type in the editor.
  This is called out in the release summary rather than silently left.
