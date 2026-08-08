# Implementation Summary — False unsigned-signature warning (v0.27.1)

- **Version**: 0.27.0 → **0.27.1** (PATCH — advisory accuracy, no behaviour change)
- **Base branch**: `release/alpha-2`
- **Bug-fix doc**: `fix-false-unsigned-signature-warning.md` (this folder)

## Root cause

`findUnclaimedSignatureSlots` scoped every claim to a subject step, but an
approval left on the "last completed step" default stores no `approvalSubject` —
`decodeApprovalSubject` returns `undefined` for the empty choice. With no scope,
the claim was dropped and a bound slot was reported unsigned. The lone-slot
fallback failed the same way, keying off a `subjectNodeIds` set the approval
never joined.

A regression from v0.27.0: that version made the default subject able to target a
signature without teaching the advisory how the default resolves.

The stored configuration was correct throughout — `DecideApproval` reads
`config.signatureFieldKey` directly and resolves the subject from the session at
run time, so these flows sign. Only the warning was wrong.

## Fix

`subjectStepOf` resolves an unnamed subject by walking predecessor edges
breadth-first from the approval node to the nearest step declaring signatures —
the same step the runtime will have just completed in a linear flow. Predecessors
only: a step downstream has not run when the approval decides. A described
(`custom`) subject resolves through the same walk, since an explicit key still
signs at decision time.

`findUnclaimedSignatureSlots(nodes, edges)` now takes the graph it needs; the
canvas viewport already held both.

## Regression tests

| Guard | Failed before because |
|---|---|
| `canvas-guidance.test.ts` — a default-subject approval naming the slot claims it | the claim was scoped to `undefined` and dropped |
| `canvas-guidance.test.ts` — a lone slot is claimed by a default-subject approval downstream of it | the approval never joined `subjectNodeIds` |
| `canvas-guidance.test.ts` — the default resolves to the *nearest* upstream signature step, so an earlier step's slot is still reported | no resolution existed |
| `canvas-guidance.test.ts` — the default never resolves forwards to a later step | passed already; pins the walk direction |

Three of the four failed before the fix. `./validate.sh` — 21 of 21, 0 failures.

## E2E

`apps/web/e2e/fix-signatures-asked-for-in-chat.spec.ts` gains two tests, on a new
`signatureWarningFlowId` fixture: a flow with one signature bound by a
default-subject approval and one nothing signs. It asserts the count is exactly
1, that the bound slot is not named, and that the advisory names the unsigned
slot, its step, and the binding steps.

The existing seeded approval flow could not express this — every approval in it
names its subject explicitly — and mutating it from a test would have raced the
other specs sharing it. The new fixture also closes the copy gap left in v0.27.0,
where nothing exercised the populated advisory end to end.

Written, not run locally — CI runs the sharded suite.
