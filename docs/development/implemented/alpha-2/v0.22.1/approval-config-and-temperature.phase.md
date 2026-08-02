# Phase — Approval Configuration and the Temperature Parameter (v0.22.1)

- **Version**: 0.22.1 (bump: **PATCH** — no schema change, no new capability)
- **Base branch**: `release/alpha-2`
- **Type**: `/bugfix` + `/enhance` batch

## Why

Three items from operator feedback on the current release line.

1. Configuring an approval step asks two questions to settle one thing: "What is
   being approved?" and then "Which step?". The first is only ever there to
   reveal the second.
2. Document generation fails outright on the configured default model with
   ``AI_APICallError: `temperature` is deprecated for this model``, and fails
   again on every retry.
3. The approver picker makes the operator click "Someone else" after it has
   already told them it has no one to suggest, and states that email or HR data
   is unconfigured in the same weight as the task itself.

## 1. One dropdown for the approval subject

### What is wrong

`node-config-modal-approval.tsx` renders a `What is being approved?` select with
two values (`step` / `custom`), and then — only when `step` is chosen — a second
`Which step?` select. The first select carries no information the second cannot:
"the output of an earlier step" *is* the list of earlier steps.

### The change

One `What is being approved?` select whose options are the union:

| Option | Stored as |
|---|---|
| The last completed step (default) | no `approvalSubject` |
| *each earlier step, by label* | `{ kind: "step", nodeId }` |
| Something I'll describe… | `{ kind: "custom", instruction }` |

Choosing the last option reveals the existing "Describe the subject" textarea.
The persisted `ApprovalSubject` shape is unchanged, so no migration and no
change to how a node authored before this reads back.

The encode/decode helpers stay in `approval-node-config.ts` and gain a pair that
maps the single select's string value to and from the modal's
`approvalSubjectKind` / `approvalSubjectNodeId` values, so the mapping remains
unit-testable without rendering the modal.

## 2. Temperature: removed, and stripped below the SDK's default

### Root cause (verified in `node_modules`)

The existing defence in `sampling-params.ts` already withholds `temperature`
from the Claude 5 family, so Wayfinder was **not** sending one — and the call
failed anyway. The reason is a layer lower:

`ai@4.3.19`, `dist/index.mjs` line 1618 (`prepareCallSettings`):

```js
// TODO v5 remove default 0 for temperature
temperature: temperature != null ? temperature : 0,
```

The SDK substitutes `temperature: 0` for an omitted temperature before the
request reaches the provider. `@ai-sdk/anthropic` puts that straight into the
request body, and the Claude 5 family rejects the parameter — so the call fails
whether or not Wayfinder passes one. It fails identically on every retry,
because the retry omits the parameter too and the SDK fills it in again.

This is why the family list and the runtime "replay without it" fallback added
in v0.21.0 never took effect: both operate above the layer that reintroduces the
parameter.

### The change

Two parts, matching the request to stop passing temperature at all:

1. **Remove it from the port and every call site.** `temperature` leaves
   `GenerateObjectInput`, `GenerateTextInput`, `StreamTextInput` and
   `StreamObjectInput`, and the ten call sites that set it — chat, branching,
   document generation and grading, structured-field capture, extraction,
   approval subject resolution and approver suggestion, HR column mapping, the
   mock node executor.
2. **Strip it in `resolveModel`.** A `transformParams` middleware applied via
   `wrapLanguageModel` sets `temperature` back to `undefined` on the way to the
   provider. `resolveModel` is the single place every model instance is built —
   including the scheduler's direct `generateObject` call — so this covers every
   path, and it is the only layer below the SDK's default.

`sampling-params.ts` and the replay/discovery machinery in
`language-model-adapter.ts` are deleted: with the parameter gone from the
request there is nothing to detect, remember or replay.

### Behaviour this changes

Calls that asked for a low temperature (0 – 0.4) now run at each provider's
default. Every one of them is a schema-constrained `generateObject`, so the
shape of the output is still enforced; what is lost is a mild determinism
preference, which is the trade the request makes deliberately.

## 3. Approver picker: no dead end, quieter notices

### What is wrong

`approval-gate.tsx` shows "No suggestion — choose someone." and then requires a
click on **Someone else** to reveal the search box — an extra step whose only
possible answer is yes. Separately, "Email isn't configured. Confirm the
approver, then send them the request manually." sits in the body of the panel at
the same weight as the request itself, on every render.

### The change

- When the request resolves with no suggested approver — which is what "the HR
  data is not configured" looks like from the operator's seat — the search panel
  opens by itself, focused, and the "Someone else" button is not rendered.
  When there *is* a suggestion the panel behaves exactly as it does now.
- The unconfigured-element notices move to a small info affordance on the right
  of the panel header: an icon button labelled "Why is there no suggestion?" /
  "About sending this request", which toggles a short explanation. Nothing is
  hidden — it stops competing with the operator's actual task.
- The "Awaiting approval" state keeps its manual-send buttons (mailto / copy
  link); only the sentence explaining *why* they are there moves into the same
  info affordance.

## Testing

| Change | Unit | E2E |
|---|---|---|
| 1 | `approval-node-config.test.ts` — the single-select value maps to and from the stored subject in every case | `enhance-approval-subject-single-select.spec.ts` |
| 2 | `providers.test.ts` — the wrapped model strips a temperature the SDK injected; `language-model-adapter.test.ts` — no call site can pass one | `fix-temperature-removed.spec.ts` — a document generates and re-generates |
| 3 | `approval-gate-state.test.ts` — picker opens when there is no suggestion, stays closed when there is | `enhance-approval-picker-flow.spec.ts` |

## Out of scope

- Upgrading to `ai@5`, which removes the `temperature: 0` default upstream. That
  is a major dependency change and does not belong on a release branch.
- Making temperature configurable per step (ADR-015 territory), which is the
  opposite of what was asked for.
