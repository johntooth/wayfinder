# ADR-045 — Approver Field Editing & Document Authorisation

- **Status**: Proposed (scoped by `approval-subject.prd.md`)
- **Date**: 2026-08-01
- **Builds on**: ADR-024 (manual document field editing, revision retention,
  `editHistory`), ADR-018 (approval step), ADR-040 (approval subject, immutable
  record), ADR-043 (signature slots, attestation block), ADR-021 (RBAC)

## Context

An approver today has two outcomes for a document that is nearly right: approve
it as-is, or send it back and wait for a round trip over a typo. The obvious
third — fix the field and approve — is not available. The machinery for it
already exists: ADR-024 gives manual field editing with re-render, revision
retention and an append-only `editHistory` carrying `editedAt` and
`editedByUserId`.

**What blocks it is not capability but authorisation — and the authorisation is
missing in the wrong direction.** `document.getFields` and
`document.updateFields` (`apps/web/src/server/routers/document.ts:64,130`) are
`authenticatedProcedure` with **no session-ownership or participant check**.
Compare `flow.ts:293`, which resolves the flow and tests ownership before acting.
Any authenticated user holding a message UUID can read and edit another user's
document fields today. The identifier is a UUID, so this is obscurity, not
access control.

So the feature and the defect are the same surface: the reason an approver cannot
edit is not that the system denies them, but that it never asks who anyone is.
Adding an approver capability on top of an unguarded procedure would harden
nothing.

## Decision

### 1. Close the authorisation gap first

Step one of the phase, before any approver capability exists: `getFields` and
`updateFields` resolve the message's session and authorise the caller against it,
using the same pattern as the flow router. This ships as a self-contained change
that is correct on its own and does not depend on the rest of this ADR.

The gap is named here rather than filed silently because it changes the order of
the work: nothing else in this ADR may land before it.

### 2. Authorisation is a capability check, not a role check

Editing a step's fields is permitted for:

| Caller | Scope |
| --- | --- |
| Session owner / participant | as today (ADR-024) |
| Approver of a **pending** approval on that session | the fields of **their own approval's subject step** only |
| Admin | as elsewhere, via the existing RBAC path (ADR-021) |

Scoping the approver to their subject step is the load-bearing constraint. An
approver signing off step 3 has no business rewriting step 5, and "is an
approver on this session" is not a licence to edit the whole session. The subject
they were asked to approve (ADR-040) is exactly the extent of their remit, so it
is exactly the extent of their edit rights.

The right ends when the approval does. Once decided, the approver is an ordinary
user with respect to that session.

### 3. An approver edit is attributed and announced

The edit records `editedByUserId` in the existing `editHistory`, and posts a
system message to the session thread naming the approver and the fields changed —
the same surface that already carries decisions (`recordDecisionMessage`).

Silent third-party mutation of someone's document is the failure mode. The
originator must not discover a changed value by reading the final artefact.

### 4. An approval carrying edits is recorded as `approved_with_edits`

**Separate the decision from the outcome.** They have been the same value until
now because nothing could make them differ:

| Concept | Values | Who sets it |
| --- | --- | --- |
| `ApprovalDecision` — what the approver **chooses** | `approved`, `rejected`, `changes_requested` | the approver, in the UI |
| `ApprovalStatus` — what is **recorded** | the above, plus **`approved_with_edits`** | the system, at decision time |

`approved_with_edits` is derived, never selected. An approval earns it when **that
approver** made at least one edit to **their own subject step** during **their
pending window**. Edits by the originator before the request, or by a different
approver, do not qualify — the status answers "did the person who signed this
also change it", and nothing else.

Deriving it rather than offering it as a fourth button is the load-bearing part.
A self-declared "I approved with edits" can be claimed without editing or
withheld after editing, which makes it worthless as a control precisely where it
matters. The system knows the answer; it should not ask.

The decision input enum is therefore unchanged, and so is the approver's UI: the
`approval.decide` router still accepts three values, and the buttons still read
Approve / Request changes. Only the recorded status gains a value.

**No migration.** `app_session_approvals.status` is a plain `text` column; the
Drizzle `enum` on it is a TypeScript-level refinement, and there is no CHECK
constraint in `drizzle/`. Adding the value is additive at the database.

**Existing control flow is unaffected, because it reads the decision, not the
status.** This is the reason the widening is cheap, and it is worth stating
explicitly so nobody "fixes" what is already correct:

| Site | Reads | Affected |
| ---- | ----- | -------- |
| `decide-approval.ts:143` — **advancement** | `input.decision` | no |
| `decide-approval.ts:89` — snapshot | `input.decision` | no |
| `decide-approval.ts:200` — decision summary | `decision` param | no |
| `approval-templates.ts:47` — notification copy | `decision` param | no |
| `decide-approval.ts:81` — decided guard | `status !== "pending"` | no — correct with a fourth decided value |
| repository queries | `status = 'pending'` | no |

Nothing in the codebase compares `approval.status` to `"approved"`. Since
`ApprovalDecision` keeps its three values, an approval carrying edits advances
exactly as it does today. The only change is that `updateIfPending({ status:
input.decision })` stops being a direct assignment and becomes a derivation.

**The risk is future code, so it is guarded structurally rather than by
convention.** A `status === "approved"` written later would silently exclude
edited approvals, and no compiler would object. Three defences, in order of how
much work they do:

1. An ESLint `no-restricted-syntax` rule forbidding literal comparison against an
   approval status outside the domain. This is the one that actually holds — it
   turns a future silent bug into a build failure, permanently. The config
   already restricts imports for architectural reasons (`eslint.config.mjs`), so
   the mechanism is established.
2. `isApproved(status)` in the domain beside the type, as the single definition
   of "this approval approved". A helper for future readers — **not** a migration;
   there is nothing to convert today.
3. The status → display/notification mapping is exhaustive, with a `never` check,
   so a fifth value cannot be added without every rendering site failing to
   compile.

### 5. The attestation binds the post-edit state

An approver who edits and then approves signs **what they left behind**, not what
they were sent. Concretely: the edit re-renders and repoints the document
(ADR-043 §6) and updates the step output; the decision then resolves the subject
and computes the verification hash over the record as it stands at decision time.

Ordering is therefore fixed — edit, then decide, never the reverse within one
action. A UI that let an approver approve and edit in a single submit would make
the signed state ambiguous, so the edit must commit first and be visible in the
document the approver is looking at when they decide.

### 6. A decided approval's record is frozen; the document is not

A later edit to the same fields — by the originator after a change request, or by
a second approver — does **not** alter an already-decided approval's
`recordSnapshot`. That record keeps the values, subject and verification hash it
locked at decision time (ADR-040 §3), and the revision that was signed is
retained.

This is the honest reading of what a signature means here: it attests to a state
of the document at a moment, not to the document forever. The signed revision
remains retrievable, so "what did Jane actually approve" is always answerable.

**Open for build:** whether an edit after signing should additionally mark the
rendered attestation block as superseded in the *current* revision. Recomputing
the hash is not an option — that would silently re-sign on someone else's behalf.
The realistic choices are to leave the block as-is (it names the revision it
signed) or to render a "superseded by a later edit" note beside it. Leaning
towards the note, since a reader of the latest revision should not have to check
the history to learn that the signature predates an edit.

## Alternatives considered

- **Give approvers a general session-edit right.** Simpler to implement and
  wrong: it grants edit access to steps the approver was never asked about.
  Rejected on least-privilege.
- **`approved_with_edits` as a fourth thing the approver picks.** Rejected: it can
  be claimed without editing and withheld after editing, so it stops being
  evidence of anything. Derived from the edit record instead (§4).
- **Leave the status as plain `approved` and show "(edited)" from
  `editHistory` in the UI only.** The information survives, but it lives outside
  the approval record — so a report over `recordSnapshot` cannot filter on it, and
  the audit answer to "which approvals were changed by their approver" needs a
  join through document history. Rejected: this is a governance signal and belongs
  in the record.
- **A boolean `editsMade` beside an unchanged status.** Honest, and it splits one
  question across two fields that every consumer must then remember to read
  together. The status is what reporting, notifications and the UI already branch
  on; putting the answer there keeps one thing to check. The boolean survives in
  the record as supporting detail (ADR-040 §5), not as the primary signal.
- **Let the approver propose edits for the originator to accept.** Safer, and it
  reintroduces exactly the round trip this feature exists to remove. Rejected for
  v1; revisit if approver edits prove contentious in practice.
- **Recompute an earlier approval's hash after a later edit** so the block always
  matches the current document. Rejected outright: it forges a signature over
  content the signer never saw.
- **Fix the authorisation gap quietly inside the feature work.** Rejected: it is
  exploitable independently of the feature, so it is sequenced first and named
  (§1) rather than buried in a larger diff.

## Consequences

**Positive**

- The common case — a typo, a wrong date — resolves in one step instead of a
  round trip.
- Document field access becomes authorised at all, closing a gap that predates
  this feature.
- Every approver edit is attributed, announced in the thread, and retained in
  `editHistory`.
- "Was this approved as submitted, or changed by its approver?" is answerable
  from the status alone, and filterable in reporting.
- What was signed stays retrievable, whatever happens to the document afterwards.

**Negative**

- Authorisation now depends on approval state, so the check is dynamic (is there
  a pending approval for this user on this session, and is this its subject
  step?) rather than a static ownership test. More surface to get wrong, and it
  needs direct test coverage.
- A fourth `ApprovalStatus` value is a type the compiler cannot police at
  comparison sites: a future `status === "approved"` would silently exclude
  edited approvals. No existing site has this shape (§4), so the cost is a lint
  rule to keep it that way, not a conversion.
- Anything outside this repo reading `status` — an exported record, an n8n
  record-export payload (ADR-020) — will see a value it has not met before.
- Adding the guard to `getFields` / `updateFields` may break any caller that
  relied on their being open — the E2E fixtures should be checked before
  assuming no legitimate caller does.
- The latest revision can carry an attestation older than the content around it
  (§5), which needs a UI answer, not just a data one.
- An approver editing and approving in one sitting concentrates authorship and
  sign-off in one person. That is the point of the feature, but flows with
  segregation-of-duty requirements will want to disable it — a per-flow toggle is
  likely future work.
