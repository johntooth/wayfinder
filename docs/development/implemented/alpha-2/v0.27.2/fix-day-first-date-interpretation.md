# Bug fix — AI misreads day-first dates as month-first

**Severity:** Minor
**Base branch:** `release/alpha-2`
**Version bump:** PATCH — `0.27.1` → `0.27.2`

## Symptom

A user answering a conversational step gives a date in short form — "10 Aug" —
and the step captures it correctly as `10-08-2026`. Later, when the session is
finalised into a document or structured output, the AI treats that same value as
**8 October** rather than **10 August**. The day and month silently swap between
the conversation and the finished output.

## Reproduction

1. Open a flow with a conversational step whose output type is **Generate
   document** or **Structured**, containing a `(date)` field.
2. In chat, answer the date question with a short day-first form: `10 Aug`.
3. The step captures `10-08-2026` — correct.
4. Complete the step so the session finalises.
5. Intermittently, the finalised field reads `08-10-2026` / "8 October" — the
   model has re-read the captured value month-first.

## Root cause

Both prompts that handle date fields name the target format but never anchor its
component order.

**Conversational node** — `packages/adapters/src/agents/flow-session-graph.ts:151`,
`buildFieldFormatsBlock`:

```ts
// … for example, turn "next Tuesday" or "3rd of June" into DD-MM-YYYY, or
// "twelve hundred dollars" into $1,200.00.
```

**Finalisation** — `packages/application/src/use-cases/document/structured-fields.ts:152`,
inside `extractStructuredFields`:

```ts
`\nEach field has a required format. Reformat the information the user provided
 into the required format whenever you reasonably can — for example, parse a
 written date into DD-MM-YYYY, or format an amount as currency. …`
```

`DD-MM-YYYY` is stated as a literal token, with nothing telling the model that
the first component is the day. A model that has seen far more `MM-DD-YYYY`
training data than `DD-MM-YYYY` can satisfy the instruction's letter while
reading `10-08-2026` as 8 October. The failure surfaces at finalisation because
that is the second pass — the conversational turn writes the value from the
user's words ("10 Aug", unambiguous), and the finalisation pass re-reads it from
the transcript as bare digits (`10-08-2026`, ambiguous without an anchor).

This is a **prompt defect only**. The domain layer is already unconditionally
day-first and needs no change: `parseFlexibleDate`
(`packages/domain/src/entities/parse-flexible-date.ts:24`) matches
`^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$` and assigns group 1 to the day, and
`describeTemplateFieldFormat` (`packages/domain/src/entities/template-field.ts:407`)
already describes the field as "a date formatted as DD-MM-YYYY".

## Fix plan

Anchor the ordering explicitly in both prompts, covering **both directions** —
writing a date out, and reading one already written:

1. **Conversational node** (`flow-session-graph.ts`, `buildFieldFormatsBlock`) —
   add a date-ordering sentence to the `<field_formats>` block stating that the
   first number is the day and the second the month, with a worked example in
   each direction, and an instruction never to swap them to reach a more
   plausible-looking date.

2. **Finalisation** (`structured-fields.ts`, `extractStructuredFields`) — add the
   same anchoring to the field-format sentence, plus an explicit instruction not
   to reorder a date carried through from the session context. This prompt is
   where the reported symptom actually manifests.

`build-extraction-prompt.ts` shares the same wording but is out of scope: batch
document extraction is not implicated in this report, and widening the change
would put unrelated prompts through a re-validation cycle.

## Regression guards

Unit tests asserting the generated prompt strings — both builders are pure with
respect to the prompt text, so the guard runs on every `./validate.sh`:

- `packages/adapters/src/agents/flow-session-graph.test.ts` — `<field_formats>`
  states day-first ordering with both worked examples.
- `packages/application/src/use-cases/document/structured-fields.test.ts` — the
  extraction prompt carries the same anchoring.

No Playwright e2e spec: the change is prompt text only, with no UI surface and no
deterministic assertion available through the browser — an e2e run would exercise
live model output rather than the fix.
