# Implementation summary — v0.27.3

**Bug fix:** Extraction guesses at ambiguous source date order
**Base branch:** `release/alpha-2`
**Version bump:** PATCH — `0.27.2` → `0.27.3`
**Severity:** Minor

Follow-up to v0.27.2, which fixed the conversational and finalisation prompts.
This closes the third prompt.

## Root cause

`buildExtractionSystemPrompt` named `DD-MM-YYYY` as the output format but said
nothing about how to **interpret** a numeric date found in a source document.

This is a different defect from v0.27.2, not the same one in another file. That
was a two-pass problem — the conversational turn wrote `10-08-2026` from the
user's words and the finalisation pass re-read those digits without an anchor.
Extraction is single-pass for field values: `extractDocumentFields` writes the
value once, and `generate-run-documents.ts` substitutes it into the deliverable
deterministically. The only other model call, `composeNarrative`, writes prose
and never rewrites field values.

The extraction defect is **source interpretation**, and the input convention is
genuinely unknown — extraction reads third-party documents. Asserting day-first
as v0.27.2 did would fix a UK-origin source and actively corrupt a US-origin one,
so the earlier remedy could not be copied across.

Nothing downstream catches it: `validateTemplateFieldValue` has no `date` case.

## Fix applied

`packages/application/src/use-cases/extraction/build-extraction-prompt.ts` —
separates reading from writing, and leans on the existing confidence mechanism
instead of forcing a convention:

1. **Output** is anchored day-first — unambiguous, because it is Wayfinder's own
   format.
2. **Reading** gets an explicit ladder: words or ISO are unambiguous; a component
   above 12 settles the order; otherwise seek corroboration in the same document.
3. **Undetermined** order returns the best reading at confidence **30–45**, with
   the reason stated in the rationale.

### Why 30–45

Tied to `packages/domain/src/entities/extraction-record.ts`:

- `EXTRACTION_CONFIDENCE_FLOOR = 0.25` — `applyConfidenceFloor` blanks anything
  below 25. An ambiguous date must stay visible for correction, not be discarded.
- `AMBER_THRESHOLD = 0.5` — below 50 bands **red**, the loudest triage signal.

30–45 clears the floor with margin and lands firmly in red, so the operator sees
the value, sees it flagged, and can correct it via `edit-record-field`.

Prompt text only — no behavioural code, no schema change.

## Regression tests added

`packages/application/src/use-cases/extraction/build-extraction-prompt.test.ts`,
both written first and confirmed failing against the unfixed prompt:

- "anchors day-first output while reasoning about the source's own date convention"
- "sends an undetermined date order to the low-confidence band instead of guessing"

## Deliberately not done

An installation-level country setting (discussed and agreed as a separate MINOR,
`0.28.0`). It would supply a default assumption for step 3, but it does not
replace this guidance — country gives the *reader's* convention, not the
*writer's*. When it is built, `parseFlexibleDate` must become locale-aware in the
same change, or scheduling would parse stored dates day-first and fire steps on
the wrong date.

## E2E test

None. Prompt text only, no UI surface, and the observable difference is live
model output.
