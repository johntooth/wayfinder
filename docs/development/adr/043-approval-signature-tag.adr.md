# ADR-043 — Approval Signature Tag, Slot Selection & the Attestation Block

- **Status**: Proposed (scoped by `approval-subject.prd.md`)
- **Date**: 2026-08-01
- **Builds on**: ADR-040 (approval subject, decision-time snapshot), ADR-018
  (approval step & approver resolution), ADR-024 (manual field editing and the
  document re-render path), ADR-033 (append-only audit log, hash chain),
  ADR-038 (step output types), ADR-039 (xlsx template format)

## Context

ADR-040 makes the approval record state *what* was approved. The approved
**document** still carries no evidence that a decision happened — a generated
purchase order or delegation instrument leaves the flow looking exactly as it
did before anyone signed off. For a product whose value is a governed,
auditable paper trail, that is the visible half of the gap.

Templates already carry the vocabulary to fix this. `parseTemplateFields`
(`packages/domain/src/entities/template-field.ts`) turns `{{ Tag (annotation) }}`
into a `TemplateField`, and that parsed set drives two things: what the
conversational node asks the operator for (`nodeFieldSet` in
`node-output.ts`, feeding `buildFieldConstraintsText` and
`evaluate-step-readiness`), and what is substituted at render time
(`buildRenderData` in `render-data.ts`).

A signature differs from every existing field type in one specific way: **the
operator must never be asked for it.** Its value is authored by a different
person (the approver), at a different node, after the document already exists.
Every current field type is the opposite — something the conversation gathers.

Real approval documents also carry **more than one** signature — delegate,
finance, legal — each owned by a different approval step in the same flow. So a
template has *N* signature slots and a flow has *N* approval nodes, and
something has to say which node fills which slot.

On the cryptography: ADR-042 brings client-certificate PKI under runtime auth
config, but that is **sign-in authentication** — it issues no document-signing
credential and signs no artefacts. Nothing in this codebase signs a document
today. What does exist is ADR-033's append-only `core_audit_log` with a
SHA-256 hash chain (`packages/domain/src/entities/audit-hash.ts`), which already
provides tamper evidence over recorded events.

Constraints carried forward from ADR-040: additive, no migration, and the
record is immutable once decided.

## Decision

### 1. `(approval)` is a new annotation producing a `signature` field type

```
{{ Delegate Signature (approval) }}
```

parses to
`{ key: "delegate_signature", label: "Delegate Signature", type: "signature", optional: true }`.
`signature` joins `TemplateFieldType`.

Validation rules, enforced at template upload where every other annotation error
is caught:

- `(approval)` is **exclusive of every other type keyword** — combining it with
  `(text)`, `(narrative)`, `(options: …)` etc. is a `VALIDATION_FAILED`, the same
  as any other double-type declaration.
- A signature field takes no `(maxlen:)`, `(min:)`, `(max:)`, `(multiple)` —
  there is no value for those to constrain.
- A signature field **may not appear inside a `{{#group (repeat)}}` block.** A
  signature is a single attested act, not a repeating item; allowing it inside a
  group would imply *N* decisions from one approval.
- It is implicitly `optional: true`, because it is filled by the system and must
  never make a step look incomplete.

### 2. A signature field is never gathered conversationally

`nodeFieldSet` filters `type === "signature"` out of the set it returns. That one
filter is load-bearing, and it is placed there deliberately rather than at each
call site, because every consumer must inherit it:

| Consumer | Effect |
| -------- | ------ |
| `buildFieldConstraintsText` → AI prompt | the model is never told the field exists, so it never asks for it |
| `evaluate-step-readiness` | an unsigned slot never blocks step completion |
| manual field editing (ADR-024) | an operator cannot type their own approver's signature |
| `validateStructuredFieldSet` (ADR-038) | `signature` is **rejected** in a structured field set, for the same reason `section` is — no document, no signature |

Filtering at one choke point is the whole safety argument: a signature slot the
conversation can reach is a signature an operator can forge.

### 3. The value is an attestation block — not an image, not a certificate

On decision, the slot renders a fixed block built from the locked approval
record:

```
Approved by:   Jane Doe (jane.doe@example.com)
Role:          Delegate
Decision:      Approved
Date:          01-08-2026 14:32 UTC
Comment:       Within delegated authority.
Verification:  WF-3F9A2C1E7B04
```

`Verification` is the first 12 hex characters of a SHA-256 taken over the
canonical approval record, using the **same canonicalisation as
`AuditHashInput`** (`audit-hash.ts`) so the two never drift. The full 64-character
hash is what is chained into `core_audit_log` (ADR-033) and is the actual
evidence; the short code is a human-quotable handle for looking the record up,
not a security primitive, and nothing may treat it as one.

This is what makes the block a signature rather than decoration: the signer's
identity is bound by authenticated sign-in, and the content is bound by a hash
in an append-only chain. Alter the name, the date, the decision or the comment
and the recomputed hash no longer matches the chained one. That is the
identity-binding-plus-tamper-evidence pair that an *advanced electronic
signature* is defined by, reached with **no new dependency and no migration**.

Decisions are recorded verbatim: a `rejected` or `changes_requested` outcome
renders the same block with that decision named. An undecided slot renders as an
empty string — a document must never imply an approval that has not happened.

### 4. Plain runs, so the block renders everywhere

The block is ordinary text substituted by docxtemplater into normal runs. It
uses **no Word feature at all**, so it displays identically in Word 2007 and
every later desktop version, Word for Mac, Word Online, Google Docs, LibreOffice
and Pages — anything that opens a `.docx`.

This is the practical reason Word's own signature machinery is not used. A Word
**Signature Line** (`w:signatureLine`) and an OPC package **digital signature**
(XML-DSig) both need desktop Word to render and validate; in Word Online or
Google Docs a signature line degrades to an empty box and a package signature is
invisible or is stripped on the next save. A signature that disappears depending
on how the recipient opened the file is worse than no signature.

### 5. One approval node fills one slot; the node config picks which

`ApprovalNodeConfig` gains `signatureFieldKey?: string`. The config editor
behaves by count:

| Signature fields in the subject step's template | Control |
| --- | --- |
| 0 | no control shown; the approval simply records no signature |
| 1 | bound automatically, dropdown hidden — there is no choice to make |
| 2+ | a dropdown listing each slot by its `label`, required before save |

Two approval nodes in the same flow must not target the same
`signatureFieldKey` on the same document; that is a config-time validation
error, not a runtime surprise.

Note the scope this settles: ADR-040 keeps **one subject per approval node**.
Multiple signatures do not change that. A document with three signature slots is
three approval nodes, each with its own subject and its own record — not one
node approving three things.

### 6. Decision re-renders the document as a new revision

Filling a slot means re-rendering a document that already exists. No new
mechanism is needed: ADR-024's `update-document-fields` already re-renders from
template plus stored values and writes a new object at
`generated/{sessionId}/{basename}-r{n}.{ext}`, retaining the previous revision.
The decision path writes the attestation value into the stored document data and
goes through that same path.

Retaining the prior revision is the point, not a side effect — the unsigned draft
and the signed instrument both survive, so an auditor can see the document as it
stood when it was sent for approval.

### 7. docx only for v1

An xlsx template (ADR-039) in `tags` mode **rejects** `(approval)` at upload with
a message naming the limitation. Signature semantics in a spreadsheet cell are
unclear — cell geometry, header-mode templates with no tags at all — and
guessing would produce a signature nobody can rely on.

## Alternatives considered

- **A user-uploaded handwritten signature image**, inserted with a docxtemplater
  image module. Rejected as the primary: an image is copyable from any previously
  signed document and proves nothing, while adding a dependency and a
  `core_user_signatures` table — a migration for negative security value. It can
  be layered on later *beside* the attestation block, never instead of it.
- **X.509 / PKI document sealing (AdES-grade).** The strongest legal standing,
  and the right answer if a regulated customer requires qualified signatures. It
  needs certificate issuance, key custody (HSM or KMS), rotation and revocation
  handling, plus a signing service — disproportionate at alpha, and ADR-042's
  PKI work provides none of it (that is sign-in, not signing). Deferred, not
  ruled out: the attestation block is a strict subset of what a sealed document
  would carry, so adding a seal later does not invalidate records made now.
- **Word Signature Lines / OPC XML-DSig.** Rejected on rendering (§4): breaks in
  Word Online and Google Docs, and is stripped by ordinary re-saves.
- **Reuse `(text)` with a naming convention** (e.g. any field called
  "signature"). Rejected: convention is not enforcement — a field the parser
  believes is `text` is a field the conversation will ask an operator to type,
  which is the one outcome this ADR exists to prevent.
- **Put the signature slot on the document/conversational node instead of the
  approval node.** Rejected: it inverts ownership. The approval node knows who
  decided and when; the document node does not, and would need to reach forward
  into a step that has not run.

## Consequences

**Positive**

- The approved document carries the decision, tamper-evident against the
  ADR-033 chain, with no new dependency and no schema change.
- One filter in `nodeFieldSet` makes operator-forged signatures structurally
  impossible rather than merely discouraged.
- Multi-signature documents work through ordinary composition — *N* approval
  nodes, *N* slots — with no multi-subject concept to build.
- Renders identically in every `.docx` reader, including web and mobile ones.
- Signed and unsigned revisions both persist, so the pre-approval state is
  auditable.

**Negative**

- A new `TemplateFieldType` touches every exhaustive `switch` over field types
  (`describeType`, `templateFieldToLine`, `validateTemplateFieldValue`,
  `buildRenderData`, the structured-field editor). Missing one is a silent
  wrong-behaviour bug, so the type must be added to the domain first and the
  compiler used to find the rest.
- The attestation block is **not** a qualified electronic signature. Anywhere it
  is described to users it must be called what it is; overclaiming legal
  standing is the failure mode to avoid.
- Approval now writes a document revision, so a decision can fail for storage
  reasons. The decision itself must still be recorded — the record is the source
  of truth, and a failed re-render is a retryable follow-up, never a lost
  approval.
- The 12-character verification code is a lookup handle with real collision
  probability at volume; any verification surface must resolve on the full hash.
- Templates authored before this ADR contain no signature tags and are entirely
  unaffected.
