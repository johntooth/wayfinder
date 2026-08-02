# ADR-044 — Change-Request Routing Target & Back-Pointer Repair

- **Status**: Proposed (scoped by `approval-subject.prd.md`)
- **Date**: 2026-08-01
- **Builds on**: ADR-018 (approval step, route-back / cancel outcomes), ADR-040
  (approval subject; §2 removes the other `advancedFrom` read), ADR-043
  (signature slots, which make consecutive approvals ordinary)

## Context

`DecideApproval` returns a session to its originator on `changes_requested`, and
optionally on `rejected`. The target it returns to is
`session.graphCheckpoint.advancedFrom` — a **single-slot back-pointer**
overwritten on every advance (`decide-approval.ts:247`).

That is adequate for one approval at the end of a flow and wrong for anything
else. In `conversational → approval A → approval B`:

- A approves and advances, writing `advancedFrom: approvalA.nodeId` (`:309`).
- B requests changes, so the session is parked on **approval A** — a node with
  nothing to edit and no conversation to reopen. The operator is asked to fix a
  document at a step that cannot touch it.

There is a second, sharper failure in the same method. Route-back writes
`advancedFrom: null` (`:229`). `routeBackOrCancel` cancels the session when it
finds no previous node (`:238`), and `changes_requested` always routes back —
so **the next change request on that session cancels it outright**, losing the
run. No new feature is needed to reach this: two approvals in sequence is enough,
and ADR-043's multi-signature documents make that arrangement the norm rather
than an edge case.

Distinguish the two things `advancedFrom` is being asked to be: a *record of the
last advance* (which it is, correctly) and a *routing decision about where work
should resume* (which it is not, and cannot be — the two coincide only in the
single-approval case).

## Decision

### 1. The return target is configured, not inferred

`ApprovalNodeConfig` gains:

```
changesRequestedTarget?:
  | { kind: "step"; nodeId: string }
  | { kind: "nearest_editable" }   // default
```

The editor renders **"On changes requested, return to:"** as a dropdown over
prior steps, populated from the same `PriorStepField` list that feeds the subject
selector (ADR-040 §1), plus the default entry.

**Named, not counted.** "Go back two steps" was considered and rejected: a hop
count silently retargets itself the moment anyone inserts a node between the
approval and its intended target, and it cannot be validated at config time. A
node reference breaks loudly instead — flow-graph validation already knows when a
referenced node has gone.

### 2. The default is the nearest prior *editable* step

`nearest_editable` walks back along the taken path and returns the first
conversational node — the nearest step where an operator can actually change
something. Approval, auto, scheduled and MCP nodes are skipped.

Returning to an approval node is never a useful outcome; that is the current
behaviour and it is the bug. Making the default skip them means an unconfigured
approval node does the sensible thing, which matters because every existing
approval node is unconfigured.

### 3. A missing target holds the session; it never cancels it

`routeBackOrCancel` is split, because it currently conflates two unrelated
outcomes:

| Decision | Outcome |
| --- | --- |
| `changes_requested` | route to the resolved target. If none can be resolved, **park the session at the approval node** with an error surfaced to the operator |
| `rejected` + `routeBack: true` | as above |
| `rejected` + `routeBack: false` | cancel — the only path that may cancel |

Cancelling a session is destructive and must only ever be the result of someone
choosing to reject and close. Reaching it by failing to resolve a back-pointer
turns a routing gap into data loss.

### 4. Route-back preserves the trail

Route-back stops writing `advancedFrom: null`. It records the approval node that
sent the work back, so the checkpoint keeps describing the last real transition
and a subsequent change request has a coherent graph to reason about.

With §1–§3 in place nothing routes off `advancedFrom` any more — ADR-040 §2
removed the context read, and this ADR removes the routing read. It reverts to
being what its name says: a record of the last advance.

### 5. Re-approval after changes

When the operator has made the requested changes and advances again, a **new**
approval row is raised at the approval node; the decided row is never reopened.
That is already how the code behaves and it stays that way — an immutable
decision record (ADR-040 §3) cannot have its outcome edited after the fact.

A consequence worth stating: a document that had been signed by approval A and is
then returned by approval B for changes carries A's attestation into the edit.
Whether A's signature survives an edit to the underlying fields is **ADR-045's
call**, not this one — routing decides where work resumes, not what remains valid
when it does.

## Alternatives considered

- **Keep `advancedFrom` and make it a stack of visited nodes.** A full history
  is genuinely useful, but "where should a change request resume" is an authoring
  decision, not a traversal fact — two flows with identical histories can want
  different targets. Rejected as a substitute for config; a visit history remains
  reasonable future work for other reasons.
- **"Go back N steps" as a number.** Rejected: silently wrong after any graph
  edit, and unvalidatable (§1).
- **Always return to the flow's first conversational step.** Predictable, but
  discards correct work in a long flow — a finance query at step 6 should not
  reopen step 1.
- **Let the approver choose the target when requesting changes.** Puts an
  authoring decision on the approver mid-decision and yields inconsistent routing
  across runs of the same flow — the same reasoning that keeps the *subject* at
  config time (ADR-040). Rejected, though a comment naming the problem is already
  carried and shown.
- **Leave the cancel-on-missing-target behaviour and document it.** Rejected: it
  is reachable today with two sequential approvals and it destroys a session.

## Consequences

**Positive**

- A change request returns to a step that can act on it, which is the whole point
  of the outcome.
- A session can no longer be cancelled by a routing gap; only an explicit reject
  closes one.
- Consecutive approvals — the shape ADR-043 makes normal — work correctly.
- Unconfigured approval nodes improve without being edited, because the default
  changed.

**Negative**

- Existing approvals gain a config field. The default must be right, since no
  existing node sets it.
- `nearest_editable` needs the taken path on a branching flow, the same
  definition ADR-040 needs for "last completed step". One resolver, used by both
  — two would drift.
- A flow whose approval precedes any conversational step has no editable target;
  the config dropdown should warn at authoring time rather than leaving it to be
  discovered at decision time.
- Behaviour change for anyone relying on the current cancel-on-second-change-
  request — unlikely to be deliberate, but it is a change and belongs in the
  release notes.
