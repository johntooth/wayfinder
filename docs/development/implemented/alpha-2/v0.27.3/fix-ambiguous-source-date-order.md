# Bug fix — Extraction guesses at ambiguous source date order

**Severity:** Minor
**Base branch:** `release/alpha-2`
**Version bump:** PATCH — `0.27.2` → `0.27.3`

Follow-up to v0.27.2 (`fix-day-first-date-interpretation`), which fixed the
conversational and finalisation prompts. This fixes the third prompt, whose
failure has a different shape.

## Symptom

A batch extraction run reads a `(date)` field from a source document containing
a bare numeric date — `08/10/2026` — and emits a confidently-wrong value. The
day and month may be transposed relative to what the document meant, and the
field carries a high confidence, so nothing routes it to a human for review.

## Reproduction

1. Author an extraction flow with a `(date)` field.
2. Stage a source document whose dates are bare numerals and whose convention is
   not day-first — e.g. a US-origin invoice dated `08/10/2026` (8 October).
3. Run the extraction.
4. The extracted value may read `10-08-2026` (10 August) — the model applied a
   day-first reading to a month-first source — and the field's confidence gives
   no indication the order was uncertain.

## Root cause

`buildExtractionSystemPrompt` (`packages/application/src/use-cases/extraction/build-extraction-prompt.ts:47`)
tells the model to reformat values into `DD-MM-YYYY` but says nothing about how
to **interpret** a numeric date in the source.

This is *not* the v0.27.2 bug. That one was a two-pass problem: the
conversational turn wrote `10-08-2026` from the user's words, and the
finalisation pass re-read those digits without an anchor. Extraction is
single-pass for field values — `extractDocumentFields` writes the value once, and
`generate-run-documents.ts` substitutes it into the deliverable
deterministically, with no model in between. The only other model call,
`composeNarrative` (`generate-run-documents.ts:201`), writes prose commentary and
never rewrites field values.

The extraction failure is instead a **source-interpretation** problem, and it is
harder because the input convention is genuinely unknown:

| Source says | Actually means | Failure |
|---|---|---|
| `10/08/2026` (day-first origin) | 10 August | May be emitted as `08-10-2026` |
| `08/10/2026` (month-first origin) | 8 October | Correct output *is* `08-10-2026`, but a model told "day-first" may swap it to `10-08-2026` |

These pull in opposite directions, so the v0.27.2 remedy — asserting day-first —
must **not** simply be copied here. Asserting it would fix row 1 and actively
worsen row 2, because extraction reads third-party documents whose origin the
installation does not control.

Nothing downstream catches the error: `validateTemplateFieldValue`
(`packages/domain/src/entities/template-field.ts:566`) has no `date` case and
falls through to `default: return ok(value)`.

## Fix plan

Separate **reading** (source, unknown convention) from **writing** (output,
always Wayfinder's day-first `DD-MM-YYYY`), and use the confidence mechanism
rather than forcing a convention:

1. Anchor the **output** format as day-first — that part is unambiguous, because
   it is Wayfinder's own format.
2. Give an explicit **reading** ladder for the source: a month named in words or
   an ISO date is unambiguous; a component above 12 fixes the order on its own;
   otherwise look for corroboration elsewhere in the same document.
3. When the order remains genuinely undetermined, **do not guess silently** —
   return the best reading with a confidence in the **30–45** band and say in the
   rationale that the order could not be determined.

### Why 30–45 specifically

Tied to the constants in `packages/domain/src/entities/extraction-record.ts`:

- `EXTRACTION_CONFIDENCE_FLOOR = 0.25` — `applyConfidenceFloor` **blanks** any
  value below 25, so the guidance must stay clear of it. An ambiguous date should
  be surfaced for a human to correct, not discarded.
- `AMBER_THRESHOLD = 0.5` — anything below 50 bands **red**, the loudest triage
  signal in the viewer.

30–45 therefore survives the floor with margin and lands firmly in red. The
operator sees the value, sees it flagged, and can correct it via
`edit-record-field`.

## Out of scope

An installation-level country setting (proposed, and agreed as a separate MINOR)
would supply a *default* assumption for step 3 rather than leaving it purely
undetermined. It is deliberately not part of this patch:

- It is a new feature, which `CLAUDE.md` puts under MINOR.
- It does not remove the need for this guidance — country tells you the
  *reader's* convention, not the *writer's*, and an Australian installation still
  receives US-origin documents.
- Shipping a month-first-selectable country requires `parseFlexibleDate`
  (`packages/domain/src/entities/parse-flexible-date.ts`) to become locale-aware
  in the same change, or scheduling (`schedule-node-event.ts:63`,
  `compute-next-fire.ts:155`) would parse stored dates day-first and fire steps on
  the wrong date.

## Regression guard

`packages/application/src/use-cases/extraction/build-extraction-prompt.test.ts` —
the prompt anchors day-first **output**, gives the source-reading ladder, and
directs an undetermined order to the low-confidence band. `buildExtractionSystemPrompt`
is a pure function returning the prompt string, so the guard runs on every
`./validate.sh`.

No e2e spec: prompt text only, no UI surface, and the observable difference is
live model output.
