# Implementation Summary — The chained gate offered to choose an approver already chosen (v0.26.1)

- **Version**: 0.26.0 → **0.26.1** (PATCH — no schema change)
- **Base branch**: `release/alpha-2`
- **Bug-fix doc**: `fix-chained-gate-shows-unsent.md` (this folder)

## Symptom

On `conversational → approval A → approval B`, the first approver approves and
nominates the second from her decision modal. The originator, chat open, sees
**"Choose the approver"** — search box and Confirm button — for a request already
sent. Reported with a screenshot showing that card directly under
"Ada Lovelace granted approval."

## Root cause

Two independent faults, either sufficient alone.

**1. The gate read the row with a mutation.** `approver-picker.tsx` called the
`approval.suggest` *mutation* in a `useEffect` and latched the result into
component state. `suggest` must be a mutation — it raises the row when none
exists — but React Query never refetches a mutation, and none of the effect's
dependencies change when the row does. The card rendered whatever was true at
mount, forever. The originator mounts it in exactly the window between the
session advancing to B and the previous approver confirming, because the advance
is what put the gate on screen.

**2. No approval mutation published `session.updated`.** The chat holds one
EventSource keyed on that event, and every mutation in the session router
publishes it. Not one in the approval router did — so even with fault 1 fixed,
an open chat was never *told*. This is also why withdrawal and reassignment,
both shipped on this branch, were invisible to a second viewer.

## The hazard, not just the display

The stale card's **Confirm** button was wired to `confirmAndSend`, which writes
`approverUserId` unconditionally on a `pending` row. An originator using it would
have **silently overwritten the approver the previous approver had already sent
to** — no warning, no reassignment audit, and the original approver still holding
an email for a request no longer theirs.

That is why this shipped as a major fix rather than a re-render.

## Fix

1. **`approval.forNode`** — a read-only query backed by a new
   `LoadPendingApproval` use case, returning the row plus the suggested and
   assigned identities. Reading stops being a write; `suggest` now fires only
   when the query resolves to null.
2. **Identity resolution moved to `approver-identity.ts`**, shared by
   `SuggestApprover` and `LoadPendingApproval` so the two cannot describe the
   same row differently.
3. **`gateMode` / `sentApproverLabel`** in `approval-gate-state.ts` — the card's
   face is now derived from the row on every render instead of latched. When the
   previous approver assigns, the originator's card flips to the sent state and
   **the Confirm button ceases to exist**, closing the overwrite hazard
   structurally rather than by warning.
4. **`publishSessionUpdated`** from `confirmAndSend`, `reassign`, `withdraw` and
   `decide`, and the chat's EventSource handler now invalidates
   `approval.forNode` alongside `session.get`.

## Regression tests

| Guard | Failed before because |
|---|---|
| `approval-gate-state.test.ts` — `gateMode` reports `sent` for a row someone else confirmed, incl. email-only assignment | the derivation did not exist; the component latched it |
| `approvals.test.ts` — `LoadPendingApproval` names an approver a *different* user confirmed, returns null for no row **and creates none**, ignores a decided row | the use case did not exist |
| `approval-router-events.test.ts` — all four row-changing mutations publish `session.updated`, with a **session** id, and the read-only procedures do not | verified against `git show HEAD:` — all four were MISSING |

`gateMode` and `LoadPendingApproval` were both written failing first
(`TypeError: gateMode is not a function`) and then made to pass.

## E2E

`apps/web/e2e/fix-chained-gate-shows-unsent.spec.ts` — for an already-assigned
chained approval: the sent card renders and "Choose the approver" does not; the
approver is named rather than "the approver"; **no search box and no Confirm
button**; and Email / Update approver are offered instead.

Written, not run locally — CI runs the sharded suite.

## Not fixed here

Whoever's gate reaches the node first becomes `requestedByUserId`, which decides
who may withdraw. On a chained approval that races the originator against the
previous approver, so the same request can end up withdrawable by either
depending on timing. Real, but a design question rather than this defect — noted
in the bug-fix doc's out-of-scope section.
