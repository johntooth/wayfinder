# Implementation Summary — Signatures asked for in chat, and unsigned slots made visible (v0.27.0)

- **Version**: 0.26.2 → **0.27.0** (MINOR — two new authoring affordances, no schema change)
- **Base branch**: `release/alpha-2`
- **Bug-fix doc**: `fix-signatures-asked-for-in-chat.md` (this folder)

## Symptom

After a cross-check the chat listed "Supervisor signature is blank" among the
things still needed, then asked the operator to name the approving supervisors —
a value only the approval step that owns the slot may write.

## Root cause

`EvaluateStepReadiness.resolveFields` bypassed `nodeFieldSet`. Its `structured`
branch was filtered; both `generate_document` branches returned the raw field
set. Signatures therefore reached `extractStructuredFields` (asked for) and
`gradeDocumentFields` (reported missing), and `missingInformation` is exactly
what the gate's fail path streams into the thread.

ADR-043 §2 states the argument this walked around: "filtering at one choke point
is the whole safety argument: a signature slot the conversation can reach is a
signature an operator can forge."

The chat's own prompt was never affected — `flow-session-graph.ts` reads
`nodeFieldSet` — which is why the demand appeared only after a cross-check.

It also **held the step**: a signature is implicitly optional and can never be
filled, so the operator was asked for something unsupplyable and the step only
advanced once the bounded gate gave up.

## Fix

1. **`gatherableFields`** exported from the domain — the exclusion itself, for
   the one caller that cannot reach `nodeFieldSet` (the byte-extraction fallback
   has no config). Applied to every branch of `resolveFields`.
   `GenerateDocument` keeps the raw set on purpose: a signature must reach
   `buildRenderData` to render as the attestation, or as empty until decided.
2. **`findUnclaimedSignatureSlots`** — canvas advisory for slots no approval step
   signs, in the same warning band as the disconnected-steps warning. Claims
   mirror what actually signs: a named `signatureFieldKey`, or the v0.26.2
   lone-slot fallback. Scoped by subject step so a same-named slot on another
   document cannot be claimed by accident. The copy names the slot and step and
   gives the steps that bind it. Both advisories now share one flex column so two
   problems stack rather than overlap.
3. **`defaultSubjectNodeId`** — the last-completed-step default resolves to the
   nearest earlier step declaring fields, so its signatures are selectable
   without the author naming the step by hand. A prediction, and the hint says
   so; picking a slot writes an explicit key, which is what the runtime reads.
   `takenSignatureFieldKeys` uses the same resolution, or two approval steps on
   the default would each be offered the whole list with no conflict reported.

## Regression tests

| Guard | Failed before because |
|---|---|
| `evaluate-step-readiness.test.ts` — the extraction model is never sent a signature key or label | the raw field set was batched straight into `extractStructuredFields` |
| `evaluate-step-readiness.test.ts` — the grader never sees one, and `fieldValues` never carries one | same leak, one stage later |
| `evaluate-step-readiness.test.ts` — a template of signatures alone grades as an empty field set and passes | it graded them and held the step |
| `canvas-guidance.test.ts` — unclaimed slots are found; a named key, or a lone slot with any approval subject to that step, claims one; extra slots on a multi-signature step are still reported; another step's approval cannot claim it | the function did not exist |
| `approval-node-config.test.ts` — the default subject resolves to the nearest earlier step and lists its signatures; nothing when no earlier step declares fields or none declares a signature | `signatureSlotsFor` returned `[]` for an empty subject |

Two of the three readiness guards failed before the fix; `./validate.sh` — 21 of
21, 0 failures.

## E2E

`apps/web/e2e/fix-signatures-asked-for-in-chat.spec.ts` — no "signature is blank"
or supervisor question in a seeded approval thread; the warning band stays silent
on a correctly bound flow and renders as a single stacking column; and the
default subject shows a populated slot dropdown with the prediction hint.

Written, not run locally — CI runs the sharded suite.

## Removed

`anyPriorStepHasSignature`, added in v0.26.2 to gate a hint explaining that the
default subject could not target a signature. The default can now target one, so
the hint it guarded no longer exists — deleted rather than left unused.
