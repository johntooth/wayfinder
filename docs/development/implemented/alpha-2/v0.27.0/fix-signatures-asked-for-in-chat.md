# Bug fix — the conversation asks for signatures, and unsigned slots are invisible

- **Reported**: 2026-08-08
- **Severity**: Major — the operator is asked to type a value only an approver
  may write, and the step is held open until they answer
- **Base branch**: `release/alpha-2`
- **Version**: 0.26.2 → **0.27.0** (MINOR — two new authoring affordances, no
  schema change)
- **Relates to**: ADR-043 (signature slots §2, §5), `approval-subject.prd.md`

## Symptom, as reported

> In the chat, it should exclude the signatures from being required to be
> filled. These should only be done by approval steps.

With the transcript:

```
Cross-check complete — these still need to be confirmed before this step can be
marked complete:
  * Supervisor signature is blank
  * Second supervisor signature is blank
  * Confirm the start date format (10-08-2026) …

Thanks for confirming! A review of the form has flagged that we're still missing
two important pieces of information:
  1. First Level Supervisor Approval — who is the first supervisor approving this hire?
  2. Second Level Supervisor Approval — who is the second supervisor approving this hire?
```

Plus two authoring requests:

> If there are signature tags that are not attached to an approval step, the user
> should be warned in the warning box (same box as the nodes not connected), with
> an explainer of how to add an approval node and associate it with a signature.
>
> Also defaulting to the last conversational node step should open up any
> signature fields associated (not just selecting a specific step).

## Reproduction

1. A conversational step generating a document from a template that declares
   `{{ Supervisor Signature (approval) }}`.
2. The flow carries guidance documentation, so the pre-generation gate runs
   (`shouldEvaluateStepReadiness` requires `hasContextDocs`).
3. Complete the step's other fields until the cheap model crosses the advance
   threshold, which fires the gate.
4. The gate reports both signatures as missing, the step is held, and the
   follow-up turn asks the operator to name the approving supervisors.

## Root cause

ADR-043 §2 puts the signature exclusion in a **single choke point**,
`nodeFieldSet`, on the explicit argument that "filtering at one choke point is
the whole safety argument: a signature slot the conversation can reach is a
signature an operator can forge."

`EvaluateStepReadiness.resolveFields` walks around it:

```ts
if (normaliseOutputType(config.outputType) === "structured") {
  return ok(nodeFieldSet(config));            // filtered
}
if (config.documentTemplateFields && config.documentTemplateFields.length > 0) {
  return ok(config.documentTemplateFields);   // RAW
}
…
return resolveTemplateFields(this.documentGenerator, config, templateResult.data);
                                              // RAW
```

The structured branch is filtered; the two `generate_document` branches are not.
So a signature reaches `extractStructuredFields` (the model is asked to find a
value for it in the transcript) and then `gradeDocumentFields` (which reports it
as missing information). `missingInformation` is exactly what the fail path
streams into the thread, which is how a template tag became a question put to the
operator.

The chat's own prompt was never affected — `flow-session-graph.ts` reads
`nodeFieldSet`, so the model gathering fields does not know the slot exists. Only
the gate leaked, which is why the demand appears *after* a cross-check rather
than during ordinary conversation.

Worse than the question: the gate **holds the step**. Because a signature is
implicitly `optional: true` it can never be filled, so the operator is asked for
something they cannot supply, the grader keeps reporting it, and the step only
advances when the bounded gate gives up (`priorGateHolds >= maxGateHolds`).

### Why the two authoring requests are the same defect

An unsigned slot is silent at run time: the step completes, the document
generates, and the signature block renders as an empty string (ADR-043 §3 — "an
undecided slot renders as an empty string"). Nothing fails, so nothing is
reported. The gap is only ever visible while the flow is being authored, and
until now the canvas said nothing about it.

The default subject compounded that. `signatureSlotsFor` returned `[]` for an
empty `subjectNodeId`, so a flow whose approval step sat on "The last completed
step" — the default — could not target its own signature at all. The author had
to know to name the step by hand first, and an unnamed slot is never signed.

## Fix plan

### 1. Close the leak at the choke point

Export the exclusion itself from the domain as `gatherableFields`, and apply it
to every branch of `resolveFields`, including the byte-extraction fallback that
has no config to pass to `nodeFieldSet`.

`GenerateDocument` deliberately keeps the raw set — a signature must reach
`buildRenderData` to be written, as the attestation once decided and as an empty
string until then. That asymmetry is the reason the filter cannot simply move
into `resolveTemplateFields`, which both callers share.

### 2. Warn on the canvas about slots nobody signs

`findUnclaimedSignatureSlots` in `canvas-guidance.ts`, surfaced beside the
disconnected-steps advisory. A slot is claimed by an approval step naming it in
`signatureFieldKey`, or — mirroring the v0.26.2 decide-time fallback — by an
approval step subject to a document step that declares exactly one signature.

Claims are scoped by subject step (`${nodeId}:${key}`), so an approval signing
"signature" on one document cannot silently claim a same-named slot on another.

The copy names the slot and the step, and gives the four steps that bind it —
"a signature is unsigned" is not actionable, "Supervisor Signature on Draft the
instrument" is.

Both advisories move into one flex column so a flow with two problems stacks
them rather than overlapping them on the canvas.

### 3. Resolve the default subject to a real step

`defaultSubjectNodeId` returns the nearest earlier step declaring any fields —
in a linear flow, exactly the step the runtime will have just completed.
`signatureSlotsFor` falls back to it when `subjectNodeId` is empty.

This is a **prediction, not a guarantee**: on a branching flow the step that
completes last depends on the path taken, and the hint says so. It is offered
anyway because choosing a slot writes an explicit `signatureFieldKey`, which is
what the runtime reads — so a correct prediction becomes durable configuration
rather than a standing guess.

`takenSignatureFieldKeys` gets the same resolution, or two approval steps both
left on the default would each be offered the whole slot list with no conflict
reported between them.

## Out of scope

- The bounded-gate interaction (`maxGateHolds`) is left alone. With signatures
  filtered there is nothing unanswerable left for the gate to hold on, and
  changing the bound would alter behaviour for every step, not just these.
- Sessions already held open by this defect are not retro-advanced. The gate is
  re-evaluated on the next turn, so an affected session recovers as soon as the
  operator sends anything.
