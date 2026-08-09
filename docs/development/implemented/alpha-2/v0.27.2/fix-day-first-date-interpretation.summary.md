# Implementation summary — v0.27.2

**Bug fix:** AI misreads day-first dates as month-first
**Base branch:** `release/alpha-2`
**Version bump:** PATCH — `0.27.1` → `0.27.2`
**Severity:** Minor

## Root cause

Both prompts that handle `(date)` fields named the target format as the literal
token `DD-MM-YYYY` without ever stating that the first component is the day. A
model can satisfy that instruction's letter while reading `10-08-2026` as
8 October, because month-first ordering dominates its training data.

The symptom surfaced at finalisation because that is the second pass over the
value. The conversational turn writes the date from the user's own words
("10 Aug" — unambiguous, month named). The finalisation pass re-reads it from
the transcript as bare digits (`10-08-2026` — ambiguous with no anchor) and can
flip the day and month.

No code defect: `parseFlexibleDate`
(`packages/domain/src/entities/parse-flexible-date.ts`) already assigns the
first captured group to the day unconditionally, and
`describeTemplateFieldFormat` already emits "a date formatted as DD-MM-YYYY".

## Fix applied

Anchored the component order explicitly in both prompts, in **both directions** —
writing a date out, and reading one already written — since the reported failure
was the read direction.

1. `packages/adapters/src/agents/flow-session-graph.ts` —
   `buildFieldFormatsBlock` gains a date-ordering paragraph in the
   `<field_formats>` block: the first number is the day, `"10 Aug 2026"` becomes
   `10-08-2026` and never `08-10-2026`, `10-08-2026` reads as 10 August 2026 and
   never 8 October 2026, and the day and month are never swapped to reach a more
   plausible-looking date.

2. `packages/application/src/use-cases/document/structured-fields.ts` —
   `extractStructuredFields` gains the same anchoring alongside its existing
   field-format sentence, plus an instruction to carry a captured date through
   exactly as written. This is the prompt where the reported symptom manifested.

Prompt text only — no behavioural code, no schema change, no API surface change.

`packages/application/src/use-cases/extraction/build-extraction-prompt.ts`
shares the original wording and was deliberately left alone: batch document
extraction was not implicated in the report.

## Regression tests added

Both builders are pure with respect to the prompt string, so the guards assert
on the generated text and run on every `./validate.sh`. Both were written first
and confirmed failing against the unfixed prompts.

- `packages/adapters/src/agents/flow-session-graph.test.ts` — "anchors
  DD-MM-YYYY as day-first in both directions so dates are not read month-first"
- `packages/application/src/use-cases/document/structured-fields.test.ts` —
  "anchors DD-MM-YYYY as day-first so a captured date is not re-read month-first"

## E2E test

None added, by agreement with the requester. The change is prompt text with no
UI surface; the only observable difference is live model output, which a
Playwright assertion could not check deterministically. The unit guards above
are the regression protection.
