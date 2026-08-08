# Bug fix — the canvas warns about signatures that are already bound

- **Reported**: 2026-08-08
- **Severity**: Major — a warning that fires on a correct flow teaches the author
  to ignore the warning
- **Base branch**: `release/alpha-2`
- **Version**: 0.27.0 → **0.27.1** (PATCH — advisory accuracy, no behaviour change)
- **Relates to**: ADR-043 §5 (amended v0.27.1), regression introduced in v0.27.0

## Symptom, as reported

> It seems to show the warning for not connected signatures even if they are
> setup. I just tested it.

## Reproduction

1. A conversational step generating a document from a template declaring
   `{{ Supervisor Signature (approval) }}`.
2. An approval step after it, with **"What is being approved?" left on the
   default** — "The last completed step".
3. Choose the signature under "Which signature does this step sign?" and save.
4. The canvas still warns that the signature has nobody to sign it.

## Root cause

A regression from this version's own work, and one only possible because both
halves shipped together.

`decodeApprovalSubject` stores **nothing** for the default choice:

```ts
return values.nodeId ? { kind: "step", nodeId: values.nodeId } : undefined;
```

So an approval on the default persists `{ signatureFieldKey: "supervisor_signature" }`
with no `approvalSubject` at all. `findUnclaimedSignatureSlots` then read:

```ts
const subjectNodeId = subject?.kind === "step" ? subject.nodeId : undefined;
if (typeof key === "string" && key && subjectNodeId) {
  claimedKeys.add(`${subjectNodeId}:${key}`);   // never reached
}
```

With no subject there is no scope to claim under, so the claim was dropped and
the slot was reported unsigned. The lone-slot fallback failed the same way: it
keys off `subjectNodeIds`, which the approval never joined.

The scoping itself is right — it stops an approval signing `signature` on one
document from claiming a same-named slot on another. What was wrong is the
assumption behind it, that every approval names a subject step. v0.27.0 made the
default subject able to *target* a signature without teaching the advisory how
that default *resolves*, and those two have to agree.

The configuration was never broken: `DecideApproval` reads `config.signatureFieldKey`
directly and resolves the subject at run time from the session, so these flows
sign correctly. The warning was the only thing wrong — which is the worst kind,
because the fix it invites is to unbind a slot that was already bound.

## Fix

Resolve an unnamed subject the way the runtime will: the nearest step **upstream**
of the approval that declares signatures, found by walking predecessor edges
breadth-first from the approval node.

- Walked backwards only. A step downstream has not run when the approval decides,
  so its signature is never the one being signed.
- A described (`custom`) subject names no step either, but an explicit key still
  signs at decision time, so it resolves through the same walk rather than
  claiming nothing.
- `findUnclaimedSignatureSlots` now takes `edges` alongside `nodes`; the canvas
  already had both.

## Out of scope

- The runtime's own resolution is untouched — it was already correct.
- Predicting the default subject on a branching flow is inherently approximate,
  in the advisory exactly as in the config editor. The advisory errs towards
  silence: an approval that resolves to the wrong branch claims a slot that
  another step's approval might have signed, which under-warns rather than
  over-warns. Over-warning is what made this bug worth fixing.
