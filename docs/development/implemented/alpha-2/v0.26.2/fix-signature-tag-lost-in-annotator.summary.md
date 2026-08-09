# Implementation Summary — The signature tag is lost in the annotation editor, and a lone slot is never signed (v0.26.2)

- **Version**: 0.26.1 → **0.26.2** (PATCH — no schema change)
- **Base branch**: `release/alpha-2`
- **Bug-fix doc**: `fix-signature-tag-lost-in-annotator.md` (this folder)

## Symptom

`(approval)` / signature tags were absent from the annotation modal; an uploaded
template's signature was shown and treated as a text field, and the field editor
offered no signature type. Separately, the approval config offered no way to say
which signature a step signs.

## Root cause

Three independent faults.

**1. The editor could not represent a signature, so it rewrote it.**
`FieldRowType` (`field-row-model.ts`) had no `signature` member, and
`fieldRowTypeOf` narrowed onto it through a `default: return "text"` arm. A
signature therefore loaded as `text` carrying the `optional: true` the parser
sets implicitly, and `modelToLine` re-emitted it as `(optional)`. Confirmed
directly:

```
lineToModel("Delegate Sign Off (approval)")  → { type: "text", optional: true }
modelToLine(that)                            → "Delegate Sign Off (optional)"
```

Not confined to editor state: `TemplateAnnotationModal` recomputes each row's
line from its model, and `buildAnnotationEdits` turns those lines into
find/replace edits applied to the stored document bytes. **The author's `.docx`
was rewritten with the signature slot removed.**

ADR-043 predicted this class of bug and the compiler still could not catch it —
`fieldRowTypeOf` is not exhaustive, and a `default:` arm turns an unhandled case
into plausible wrong behaviour rather than a build failure.

**2. `(approval)` was documented nowhere an author looks.** The parser has
accepted it since ADR-043 (`MODIFIER_VOCABULARY` carries `approval`), but neither
`annotation-reference.tsx` — whose own comment claimed to be "the complete
annotation grammar" — nor `template-tags-help-dialog.tsx` listed it.

**3. "Bound automatically" bound nothing.** `signatureSlotControl` returned
`{ mode: "auto", key }` for exactly one slot and the modal rendered no control
for that mode, only the sentence "On approval, the decision is written into that
step's signature". Nothing read `mode.key`. `signatureFieldKey` stayed `""`, so
`approval-config-mapping.ts` omitted it from the saved config;
`DecideApproval.resolveSubject` read `config.signatureFieldKey ?? null` with no
fallback; `ApplyApprovalSignature` bailed at its first guard with
`no_signature_slot`.

**Every single-signature template went unsigned** — the common case. Only a 2+
slot template ever reached the dropdown and therefore ever got signed.

## Fix

1. **`signature` is a first-class editor type.** Added to `FieldRowType` and to
   `TEMPLATE_TYPE_OPTIONS` (not `STRUCTURED_TYPE_OPTIONS` — ADR-043 §2 rejects a
   signature in a structured field set). `fieldRowTypeOf` is now exhaustive with
   no `default:` arm, so the next added `TemplateFieldType` is a build failure.
   `withType` forces `optional: true` and clears every constraint, matching what
   `parseTemplateField` will accept; `hasNonDefaultConfig` ignores a signature's
   implicit optionality so the cog is not accented on every signature row.
2. **`FieldConfigModal`** shows an explanation and no controls for a signature.
3. **Both reference surfaces** document `(approval)`, including that the operator
   is never asked for it and that it cannot sit inside a `(repeat)` block.
4. **`signatureSlotControl` drops `auto`** — `none` at zero slots, `choose` at one
   or more. The modal pre-selects a lone slot by **writing** it to
   `signatureFieldKey`, not by displaying a default, since a display-only default
   reproduces the original bug. On the default subject, where no template is
   knowable, an explanatory hint appears — gated on
   `anyPriorStepHasSignature` so it never fires on flows with no signature.
5. **`loneSignatureSlot`** (new, `signature-slot.ts`) gives `DecideApproval` a
   fallback: an empty config key against a subject step declaring exactly one
   signature binds that slot. This retro-fixes flows already saved under the old
   auto mode without an author reopening every approval step. Deliberately narrow
   — with two or more slots the key stays unset, because writing a named person's
   attestation into the wrong signature line is worse than not signing.

## Regression tests

| Guard | Failed before because |
|---|---|
| `field-row-model.test.ts` — `lineToModel` reads `(approval)` as a signature; `modelToLine` round-trips it unchanged | the type did not exist, so the model read `text` and re-emitted `(optional)` |
| `field-row-model.test.ts` — `withType(…, "signature")` forces optional and clears constraints; `hasNonDefaultConfig` ignores the implicit optionality | neither case was handled |
| `approval-node-config.test.ts` — one slot yields `choose`, replacing the `auto` assertion | the mode existed and rendered no control |
| `approval-node-config.test.ts` — `anyPriorStepHasSignature` | the helper did not exist |
| `approvals.test.ts` — `DecideApproval` binds the lone slot when config is empty, keeps an explicit key, and binds nothing at 0 or 2+ slots | there was no fallback; the lone-slot case wrote no `signatureFieldKey` |

`./validate.sh` — 21 of 21, 0 failures.

## E2E

`apps/web/e2e/fix-signature-tag-lost-in-annotator.spec.ts` — the found-fields
list names it `(Signature)` and never `(Text)`; the type dropdown offers
Signature with the row already on it; editing the row re-emits
`{{ … (approval) }}` and never `(optional)`; the cog offers no constraints;
`(approval)` appears in the annotation reference; and a subject step with a
single signature shows a pre-selected slot dropdown.

Written, not run locally — CI runs the sharded suite.

## Known limitation, called out rather than left silent

**Templates already rewritten by fault 1 are not repaired.** The `(approval)` tag
was overwritten in the stored `.docx` and the original upload is not retained —
the annotate path stores only the derived document. Any author who edited a
signature row between ADR-043 shipping and this fix must re-add the tag, either
in Word or with the now-available Signature type in the editor.

Approval steps configured against such a template will also have lost their slot,
and should be reopened once the template is repaired.
