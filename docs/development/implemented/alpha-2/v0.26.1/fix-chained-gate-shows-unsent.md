# Bug Fix — The chained approval gate offers to choose an approver already chosen (v0.26.1)

- **Version**: 0.26.1 (bump: **PATCH** — no schema change)
- **Base branch**: `release/alpha-2` (via `claude/chat-approval-workflow-aluuh6`)
- **Severity**: major — a display fault with a silent-overwrite hazard behind it
- **Type**: `/bugfix`

## Symptom

On a flow with two approval steps, the first approver (Ada) approves and
nominates the second approver (Grace) from her decision modal. The originator,
with the chat open, sees the gate render **"Choose the approver"** — an empty
search box and a Confirm button — for a request that has already been sent to
Grace.

Reported with a screenshot showing the unsent card directly beneath
"Ada Lovelace granted approval."

## Reproduction

1. A flow of `conversational → approval A → approval B`.
2. The originator sends A, and **leaves the chat open**.
3. Ada approves A. `DecideApproval` advances the session to B, and her decision
   modal offers her the next approver; she picks Grace and confirms.
4. The originator's chat still shows "Choose the approver" for B, indefinitely.

A page reload clears it, which is why this survived earlier testing — a fresh
mount re-reads the row. The fault only shows for a viewer who was already
watching, which is the normal case for a chained approval.

## Root cause

Two independent faults, either of which alone produces the symptom.

### 1. The gate reads the approval row with a *mutation*

`approver-picker.tsx:129`:

```ts
const suggestMutate = suggest.mutate;
useEffect(() => {
  suggestMutate({ sessionId, flowId, nodeId });
}, [sessionId, flowId, nodeId, suggestMutate]);
```

`approval.suggest` is a tRPC **mutation** — it has to be, because it creates the
pending row when none exists. Its result is latched into component state
(`setSent`, `setSentTo`, …) exactly once per mount, and React Query never
refetches a mutation. None of the effect's dependencies change when the row
does, so **nothing re-reads it for the life of the mount**.

The originator's gate therefore renders whatever was true at the instant it
mounted. Mounting between the session advancing to B and Ada confirming Grace —
a window the originator is very likely to be inside, because the advance is what
put the gate on their screen — latches "unassigned" permanently.

### 2. No approval mutation publishes `session.updated`

The chat holds one EventSource and invalidates `session.get` on `session.updated`
(`_content.tsx:289–296`). Every session mutation publishes that event
(`session.ts:282, 320, 386, 401, 419, 448`).

**No mutation in `approval.ts` publishes anything.** Not `confirmAndSend`, not
`decide`, not `withdraw`, not `reassign`. So even once fault 1 is fixed, an open
chat is never *told* that the approval row changed — it would correct only on the
next unrelated refresh.

This is why withdrawal and reassignment, both shipped on this branch, are also
invisible to a second viewer watching the same chat.

## The hazard behind the display fault

The stale card is not inert. It carries a **Confirm** button wired to
`confirmAndSend`, which writes `approverUserId` unconditionally on a `pending`
row. An originator who uses that stale card picks someone, presses Confirm, and
**silently overwrites the approver Ada already sent to** — with no warning, no
audit of a reassignment, and Grace still holding an email pointing at a request
that is no longer hers.

That is the reason this is a major fix rather than a cosmetic one, and the reason
the fix has to make the card reflect server state rather than merely re-render it
prettily.

## Fix

### 1. Read the row with a query

New read-only `approval.forNode({ sessionId, nodeId })` returning
`{ approval, suggestedApprover, assignedApprover } | null` — the same shape
`suggest` returns, minus the ability to create anything. Backed by a new
`LoadPendingApproval` use case.

The identity resolution moves to a shared `approver-identity.ts` so
`SuggestApprover` and `LoadPendingApproval` cannot come to describe the same row
differently — the reason `ResolveApprovalSubject` is shared for the same job
(ADR-040 §2).

The picker uses the query as its source of truth and fires the `suggest`
**mutation only when the query resolves to null** — i.e. nobody has raised the
row yet. Creating stays a write; reading stops being one.

### 2. Derive the sent state instead of latching it

`sent`, `sentTo` and `sentToEmail` stop being latched local state and become
derivations of the query data. When Ada assigns Grace, the originator's next
refetch flips the card to "Awaiting approval — sent to Grace" with the Email /
Update approver / Withdraw actions, and **the Confirm button ceases to exist**.

That closes the overwrite hazard structurally: there is no stale-confirm path to
press, because the confirm form is not rendered for an assigned row.

### 3. Publish `session.updated` from the approval mutations

`confirmAndSend`, `decide`, `withdraw` and `reassign` each publish the event the
chat already listens for, matching every mutation in `session.ts`. An open chat
learns immediately rather than on the next unrelated refresh.

## Regression tests

| Guard | Fails before the fix because |
|---|---|
| `approvals.test.ts` — `LoadPendingApproval` returns the assigned approver for a row a *different* user confirmed | the use case does not exist |
| `approvals.test.ts` — it returns null for a node with no pending row, and never creates one | as above |
| `approval-gate-state.test.ts` — `gateMode` reports `sent` for an assigned row and `choose` for an unassigned one | the derivation does not exist; the component latched it |
| `approval-router-events.test.ts` — every approval mutation that changes a row publishes `session.updated` | none of them publish |

The component's latching itself is not unit-testable without a DOM; the pure
`gateMode` derivation is what replaces it, and the e2e covers the live flip.

## E2E

`apps/web/e2e/fix-chained-gate-shows-unsent.spec.ts` — with the chat open,
assert the gate for an already-assigned second approval renders the sent state
(named approver, Email/Withdraw actions) and offers **no** approver search or
Confirm button.

## Out of scope

- Preventing the originator's gate from *creating* the row for a chained
  approval before the previous approver gets to it. Whoever arrives first becomes
  `requestedByUserId`, which decides who may withdraw — non-deterministic, and
  worth settling, but it is a design question rather than this defect.
- Any change to `SuggestApprover`'s creation semantics.
