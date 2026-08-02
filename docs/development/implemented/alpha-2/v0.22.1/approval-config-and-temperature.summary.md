# Implementation Summary — Approval Configuration and the Temperature Parameter (v0.22.1)

- **Version**: 0.22.1 (bump: **PATCH** — no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Phase**: `approval-config-and-temperature.phase.md` (this folder)
- **E2E**: `apps/web/e2e/enhance-approval-config-and-picker.spec.ts`,
  `apps/web/e2e/fix-temperature-deprecated-model.spec.ts`

## What was built

| # | Item | Where |
|---|---|---|
| 1 | One dropdown for the approval subject | `canvas/approval-node-config.ts`, `canvas/node-config-modal-approval.tsx` |
| 2 | `temperature` removed from every call and stripped below the SDK | `domain/ports/language-model.ts`, `ai/providers.ts`, `ai/language-model-adapter.ts`, ten call sites |
| 3 | Approver picker opens itself; setup notices demoted | `chat/approval-gate-state.ts`, `chat/approval-gate.tsx` |

## 1. One dropdown for the approval subject

`What is being approved?` and `Which step?` are now a single select whose
options are the default, every earlier step by label, and "Something I'll
describe…". Choosing the last reveals the existing instruction textarea.

`CUSTOM_SUBJECT_CHOICE` (`"__describe__"`) is the sentinel for the described
case — a native `<select>` value is always a string, and it must not be
mistakable for a node id. `approvalSubjectChoice` / `approvalSubjectFromChoice`
map that one string to and from the `kind` / `nodeId` pair the config mapping
already writes, so the persisted `ApprovalSubject` shape and everything reading
it are unchanged.

## 2. Temperature

### Root cause

The v0.21.0 defence (`sampling-params.ts`) was withholding `temperature` from
the Claude 5 family, and the call still failed — because it was not Wayfinder
sending the parameter. `ai@4.3.19`, `prepareCallSettings`:

```js
// TODO v5 remove default 0 for temperature
temperature: temperature != null ? temperature : 0,
```

The SDK substitutes `temperature: 0` for an omitted one before the request
reaches the provider. That is why every retry failed identically: the retry
omitted the parameter too, and the SDK filled it back in.

### Fix

1. `temperature` is gone from `GenerateObjectInput`, `GenerateTextInput`,
   `StreamTextInput` and `StreamObjectInput`, and from all ten call sites —
   chat, branching, document generation and grading, structured fields,
   extraction, approval subject resolution, approver suggestion, HR column
   mapping, the mock node executor.
2. `resolveModel` wraps every model it builds in a `transformParams` middleware
   that sets `temperature` back to `undefined`. It is the single place every
   model instance is constructed — including the scheduler's direct
   `generateObject` call — and the only layer below the SDK's default.

`sampling-params.ts`, `withTemperatureFallback`, `recordTemperatureRefusal` and
`observingTextStream` are deleted. With the parameter absent from the request
there is nothing to detect, remember or replay, and `streamText` / `streamObject`
hand the SDK's own stream and the caller's own `onError` straight through.

### Behaviour this changes

Calls that asked for 0 – 0.4 now run at each provider's default. All of them are
schema-constrained `generateObject` calls, so output shape is still enforced;
what is given up is a mild determinism preference, deliberately.

## 3. Approver picker

- **No dead end.** When `suggest` resolves with no suggested approver — what an
  unconfigured directory looks like from the operator's seat — the people search
  opens on its own, already focused, and the "Someone else" button is not
  rendered (it only ever offered to open what is already open). With a
  suggestion present, the panel behaves exactly as before. The heading reads
  "Choose the approver" rather than "Confirm the approver" in that state.
- **Quieter notices.** "Email isn't configured…" no longer sits in the body of
  the panel. `setupNotice` returns a label and one paragraph per thing that is
  not set up, rendered as a small info button on the right of the panel heading
  that toggles the explanation. It returns `null` when both are configured, so a
  fully configured install carries no notice at all. The same affordance
  replaces the explanatory sentence in the "Awaiting approval" state; the
  mailto / copy-link buttons there are untouched.

## Tests

- `packages/adapters/src/ai/providers.test.ts` — the wrapped model strips an
  injected `temperature` on generate and on stream, for every provider, leaving
  the rest of the call options alone. Fails against the unwrapped model.
- `packages/adapters/src/ai/language-model-adapter.test.ts` — the replay and
  discovery tests are gone with the code; a failed call is now logged once and
  attempted once.
- `apps/web/src/components/canvas/approval-node-config.test.ts` — every value
  the single select can hold round-trips.
- `apps/web/src/components/chat/approval-gate-state.test.ts` — the picker opens
  only when there is nothing to confirm, and the notice says nothing when there
  is nothing to say.
