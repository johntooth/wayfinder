# Phase — Chat & Sidebar Refinements

- **Status**: To be implemented
- **Version**: 0.23.4 (**PATCH** — presentation only; no schema change, no
  migration, no port signature change, no `packages/*` change)
- **Base branch**: `release/alpha-2`, delivered on
  `claude/ui-design-refresh-mockup-hfl9zt` (PR #227) because every item builds on
  the design refresh that branch carries and that has not yet merged
- **Release line**: `alpha-2`

Six reported items following review of the v0.23.3 design refresh.

After investigation the phase is **entirely presentation**. Two items originally
suspected of being correctness bugs (§4, §5) turned out not to be: the approver
edit path works, and the approval-modal report is not reproducible on the
surface it named. A real latent defect found while investigating §5 is recorded
there and deliberately **not** fixed here — ADR-040 §3 constrains the fix, and
there is no reproduction to test against.

---

## 1 — Only one nav item may be active

**Reported:** both "My Chats" and the open recent chat highlight at once.

**Cause.** `sidebar.tsx`:

```ts
const isActive = (href: string) =>
  pathname === href || pathname.startsWith(href + "/");
```

On `/chats/abc` this is true for `/chats` (prefix) *and* for `/chats/abc`
(exact). Every ancestor of the current path highlights, so the rail claims the
user is in two places.

**Fix.** Replace the per-href predicate with a single resolution over the whole
candidate set: the longest matching prefix wins, and only that href is active.
Extracted to `sidebar-model.ts` as a pure function so it can be tested without a
router.

```ts
resolveActiveHref(pathname: string, candidates: readonly string[]): string | null
```

Ancestors stop highlighting everywhere this is used, including the admin rail.

---

## 2 — New chat joins the nav list

**Reported:** New chat should sit at the top of the same list as My Chats,
Flows and Approvals, distinguished by a plus rather than a dot. The `⌘K` hint
stays (product owner's choice).

**Fix.** Two small widenings of the existing nav model:

- `NavMark` gains `"plus"` alongside `"dot"` and `"icon"`.
- A nav item may carry `onSelect` instead of `href`, so `NavGroups` renders a
  `<button>` in place of a `<Link>` for that row. Nothing else changes shape —
  the mark, label, badge and active styling are shared.

The standalone bordered New chat button is removed; its `⌘K` `<kbd>` moves onto
the row. The `⌘K` binding itself is untouched.

`docs/development/storybook/index.html` is updated to match. That file is the
"storybook" in this repo — a static HTML reference, not a Storybook install.

---

## 3 — Other people's messages read as theirs, not yours

**Reported:** approval messages from other users render right-aligned like the
viewer's own, with no distinguishing mark. They should sit on the left with a
distinct initial, and show relative time only.

**Scope (product owner's choice):** *any* message not authored by the current
viewer, not only approval decisions.

**Fix.** `MessageFeed` gains `currentUserId`. `_content.tsx` already computes
`myUserId` and simply does not pass it. A message is the viewer's own when
`senderUserId === currentUserId`; a `user`-role message with no `senderUserId`
is treated as the viewer's, preserving today's single-participant rendering.

**Three renderings are wrong today**, all visible in the supplied screenshot of
a live double-approval session:

| What renders | Today | Required |
|---|---|---|
| Ada's and Grace's "Approval granted." | right-aligned beige bubble, indistinguishable from the viewer's own | left, with their own tint |
| Their meta line | `Ada Lovelace · ada@example.com · 05/08/2026, 20:50:45` **and** `7m ago` | name and relative time only |
| "Grace Hopper edited this step…" | blue **square agent mark** with the expert role's initials | Grace Hopper's circular tint |

The third is the sharpest: a person's edit is currently attributed to the AI.

Someone else's message renders as, per the supplied design:

- a **circular** avatar carrying their initials, filled with a per-person tint
- their **name in bold**, followed by the action in regular weight on the same
  line
- the comment quoted beneath
- a mono meta line showing **relative time only** — the absolute
  `04/08/2026, 15:56 ·` prefix is dropped

The tint is chosen by a deterministic hash of the user id, so a person keeps
one colour across every session and no server round-trip is needed. New module
`participant-identity.ts`:

```ts
participantTint(userId: string): { fill: string; ink: string }
```

**Accessibility.** Initials are text, so each `ink` on its `fill` must clear
WCAG 1.4.3 AA at 4.5:1, and each `fill` must be distinguishable from the feed
background. Asserted numerically in `participant-identity.test.ts`, the same
guard pattern `design-tokens.test.ts` established — colour identity is never the
*only* signal, since the name is always written out.

---

## 4 — The approver's edits are reachable from the thread

**Reported:** the chat author cannot open what an approver changed.

**Investigation.** The v0.23.2 wiring is intact and was not regressed by the
refresh: `approver-edit-subject-fields.ts` persists the announcement with
`stepNodeId` set to the subject step, `parseApproverEditMessage` matches it, and
`message-feed.tsx` renders the step's newest document beneath it via
`resolveApproverEditDocument`.

**Confirmed working.** The product owner re-tested and supplied a screenshot: the
notice, the document card and its **Download** button all render beneath the
step divider, on the current branch. The originally reported symptom was
intermittent or historical.

**What is actually wrong is the attribution.** The notice — *"Grace Hopper
edited this step before deciding the approval: Department."* — renders through
the assistant branch, so it carries the **blue square agent mark bearing the
expert role's initials**. A person's action is presented as the AI's. It must
carry Grace Hopper's own circular tint from item 3 instead.

No logic change; this folds into item 3's treatment. `parseApproverEditMessage`
already returns `editorName`, so the identity needed is on hand.

---

## 5 — The approval modal loses the document permanently

**Reported:** with the approval open, there is no document to download when the
preceding conversational step generated one.

**Cause — confirmed by reading the code, not inferred.**
`ResolveApprovalSubject` caches its answer on the pending row:

```ts
private async cache(approval, subject) {
  await this.approvals.update(approval.id, {
    recordSnapshot: {
      ...(approval.recordSnapshot ?? {}),
      [SUBJECT_DESCRIPTION_KEY]: subject.description,
      [SUBJECT_NODE_ID_KEY]: subject.subjectNodeId,   // may be null
    },
  });
}
```

and reads it back:

```ts
private cachedSubject(approval) {
  const description = snapshot?.[SUBJECT_DESCRIPTION_KEY];
  if (typeof description !== "string" || description.length === 0) return null;
  const nodeId = snapshot?.[SUBJECT_NODE_ID_KEY];
  return { description, subjectNodeId: typeof nodeId === "string" ? nodeId : null, snapshot: null };
}
```

Three facts compound:

1. When resolution finds no completed step, it returns the **non-empty**
   fallback description `"the work completed in this session so far"` with
   `subjectNodeId: null`.
2. `cache()` writes that null.
3. `cachedSubject()` returns early on any non-empty description — so it reports
   `subjectNodeId: null` and the full resolution never runs again.

The null is therefore **sticky for the life of the approval**. With no subject
node id, `buildContext` skips `resolveSubjectStep` entirely, `previousStep` is
`null`, and `PreviousStep` renders nothing — no document, no fields, no
download. A conversational step reaches this state whenever the approval is
resolved before that step's message is on the row.

**Not reproducible on the reported surface — deferred.** The product owner's
re-test shows the document and its Download button rendering correctly in the
chat thread. The original report named the *approval modal*, a different surface
that the screenshot does not cover, so this is neither confirmed fixed nor
confirmed broken.

**Decision: no application-layer change in this phase.** Two reasons, and the
second is the binding one:

1. There is no reproduction to write a failing test against, and this repo's
   discipline is test-first.
2. **ADR-040 §3 forbids the obvious fix.** The decision-time snapshot is "never
   recomputed afterwards… the audit guarantee the feature exists for", and
   `buildContext` serves decided approvals as well as pending ones (that is how
   the v0.23.2 approver-history page reads). Any re-resolution would have to be
   narrowed to **pending** approvals to stay inside that guarantee — and even
   then, rows already decided while carrying a null node id must keep showing no
   document, because the record stands as written.

The sticky null is nonetheless **real and confirmed by reading the code**, so it
is recorded here rather than lost: it triggers whenever subject resolution first
runs before any step has posted a message. If the modal defect resurfaces, this
is the first place to look, and the fix must be pending-only.

No code change, no migration.

---

## 6 — Nothing may disappear while a reply streams

**Reported:** UI elements vanish from the chat while a message is pending.

**Cause.** `message-feed.tsx`:

```tsx
{!showStreaming && dbMessages.map(...)}
```

While streaming, the **entire persisted transcript is unmounted** and replaced
by a render over the AI SDK's client-side `streamingMessages`. That branch knows
nothing of step dividers, timestamps, milestone pills, document cards, record
cards, approval decision bubbles or the info modal — so all of them disappear
mid-turn and return when the stream settles. The reported missing timestamps are
one symptom of the swap, not the whole of it.

**Fix.** Keep the persisted feed mounted always, and append only the streamed
messages beyond what is persisted:

```ts
streamingTail(streamingMessages, persistedCount): UIMessage[]
```

Pure, and unit-tested against the cases that make a naive slice wrong: the
just-sent user message that is not yet persisted must render exactly once, and a
stream that has not yet outgrown the persisted list must contribute nothing.

---

## Tests

Written before implementation, each failing on the unfixed code.

| Guard | What it holds |
|---|---|
| `sidebar-model.test.ts` | `/chats/abc` activates the chat and **not** `/chats`; exact match wins; no candidate matches an unrelated path; `/` never swallows everything |
| `participant-identity.test.ts` | one id always yields one tint; every ink/fill pair clears 4.5:1; every fill is distinguishable from the feed background |
| `message-feed-stream.test.ts` | `streamingTail` renders the unpersisted user message once; contributes nothing when the stream is behind; never duplicates a persisted message |
| `approval-decision-message.test.ts` | a decision's meta line carries relative time only — no absolute timestamp, no email |

**E2E** — `apps/web/e2e/enhance-chat-sidebar-refinements.spec.ts`, written not
run (CI runs it):

1. On an open chat, exactly one rail item carries the active treatment
2. New chat is the first row of the nav list and opens the modal
3. The step rail, timestamps and dividers survive a streaming turn
4. An approval decision from another person renders left of the viewer's own,
   and the approver-edit notice is attributed to the editor rather than the AI

---

## Out of scope

- No DB migration, no new entity, no port signature change
- Admin dashboards keep the v0.23.3 treatment (palette and type only); moving
  them onto `AppHeader` is a separate piece of work
- The flow canvas is explicitly unchanged beyond v0.23.3, per the product owner
