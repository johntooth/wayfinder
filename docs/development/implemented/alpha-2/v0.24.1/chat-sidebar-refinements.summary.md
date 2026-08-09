# Implementation Summary — Chat & Sidebar Refinements

- **Version**: 0.24.1 (PATCH — presentation only; no schema change, no
  migration, no port signature change, no `packages/*` change)
- **Base branch**: `release/alpha-2`, delivered on
  `claude/ui-design-refresh-mockup-hfl9zt` (PR #227)
- **Phase doc**: [`chat-sidebar-refinements.phase.md`](./chat-sidebar-refinements.phase.md)
- **E2E**: `apps/web/e2e/enhance-chat-sidebar-refinements.spec.ts`

## What shipped

### One active rail item

`isActive` tested each href independently, so on `/chats/abc` both `/chats`
(prefix) and `/chats/abc` (exact) reported true — every ancestor highlighted at
once. Replaced with `resolveActiveHref(pathname, candidates)` in
`sidebar-model.ts`: one resolution across nav hrefs and recent-chat hrefs
together, longest match wins, and `NavGroups` receives the resolved href rather
than a predicate. Matching is segment-boundary aware, so `/chat` never claims
`/chats`.

### New chat joins the nav list

`NavMark` gained `"plus"`, and a `NavItem` may now carry `onSelect` instead of
`href` — that one addition lets an action row render as a `<button>` inside the
same list, sharing the mark, label, badge and active styling. New chat leads the
user nav with its `⌘K` hint on the row; the standalone bordered button is gone,
along with its now-dead CSS in the storybook.

`docs/development/storybook/index.html` updated across all three rail variants.

### Other people's messages read as theirs

`MessageFeed` gained `currentUserId`; `_content.tsx` already computed `myUserId`
and simply never passed it. Three renderings changed, all reported from one
screenshot of a live double-approval session:

| | Before | After |
|---|---|---|
| An approver's decision | right-aligned beige bubble, identical to the viewer's own | left, circular tinted mark |
| Its meta line | `Ada Lovelace · ada@example.com · 05/08/2026, 20:50:45` **and** `7m ago` | name and relative time only |
| "Grace Hopper edited this step…" | blue **square agent mark**, expert-role initials | Grace Hopper's own mark |

The third was the sharpest: the notice is persisted as a `system` message, so it
fell through to the assistant branch and wore the AI's mark — a person's edit
presented as the model's work.

`OtherPersonMessage` renders name-in-bold plus the outcome as a verb phrase
(`decisionVerbPhrase` maps the domain's standalone sentences —
"Approval granted." → "granted approval."), the comment quoted beneath, and one
mono relative timestamp. An unrecognised sentence passes through unchanged, so a
future domain wording degrades to a stilted line rather than a blank.

A `user`-role message with no `senderUserId` is treated as the viewer's own, so
single-participant chats render exactly as before.

### Participant tints

`participant-identity.ts` — six paper-weight tints, chosen by FNV-1a **with a
murmur3 finalizer**. The finalizer is load-bearing: the palette index is
`hash % 6`, which reads the low bits, and raw FNV-1a avalanches those poorly
enough that `user-12` and `user-21` collided. Seeded from the user id, so a
rename keeps a person's colour.

### Nothing disappears mid-turn

`message-feed.tsx` rendered `{!showStreaming && dbMessages.map(...)}` — the
**entire persisted transcript was unmounted** while a reply streamed and
re-rendered from the AI SDK's client-side list, which knows nothing of step
dividers, timestamps, milestone pills, document cards, record cards, approval
bubbles or the info modal. The reported missing timestamps were one symptom of
the swap, not its extent.

The persisted feed now always renders, and `streamingTail` appends only what the
server has not persisted yet. The typing indicator moved **outside** that block:
at the instant a turn starts the client list has not grown, and an indicator
that blinks out on the first frame reads as a dropped message.

## Two items that were not what they were reported as

**The approver's edits in the thread** were never broken. The v0.23.2 wiring is
intact — the announcement is persisted with the subject step's `stepNodeId`, and
`resolveApproverEditDocument` looks up by exactly that. The product owner's
re-test confirmed the notice, the document card and its Download button all
render. What was wrong was the attribution, fixed above.

**The approval modal's missing document** is not reproducible on the surface it
named, so **no application-layer change was made**. A real defect found while
investigating it is recorded in the phase doc rather than fixed:
`ResolveApprovalSubject.cache()` writes `subjectNodeId: null` when resolution
finds no completed step, and `cachedSubject()` returns early on any non-empty
description — so the null is sticky for the life of the approval. Any fix must
be scoped to **pending** approvals, because ADR-040 §3 forbids recomputing a
decided approval's snapshot ("the audit guarantee the feature exists for"), and
`buildContext` serves decided rows too.

## Tests

**Unit** — 720 passing across 80 files (from 685/78), including:

- `sidebar-model.test.ts` (+7) — the chat activates, not its parent; exact beats
  prefix; `/chat` does not claim `/chats`; a bare `/` never swallows everything
- `participant-identity.test.ts` (16) — stable per id, even distribution across
  600 seeds, every ink/fill pair ≥ 4.5:1
- `streaming-tail.test.ts` (6) — the unpersisted user message renders once; a
  stream behind the transcript contributes nothing; a negative count does not
  slice from the end
- `approval-decision-message.test.ts` (+6) — each domain sentence maps to its
  verb phrase; an unknown sentence passes through

Two assertions were **removed as unsound** during the work: a test asserting two
arbitrary participants always get different tints (with six tints that is a
1-in-6 collision and an accepted one — the name is always written beside the
circle), and a proposed 3:1 fill-versus-page contrast floor. The fills are ~1.2:1
by design; a 3:1 avatar on warm paper is a garish dot, and it is acceptable here
only because colour is never the sole signal. Both facts are recorded in the
test file rather than asserted falsely.

**E2E** — `enhance-chat-sidebar-refinements.spec.ts`, written not run (CI runs
it): exactly one active rail row on an open chat; New chat first in the list and
opening the modal; the transcript's timestamps surviving a streaming turn,
counted against the pre-turn total rather than a fixed number; another person's
decision rendering as theirs.

## Validation

`./validate.sh` — 21 passed, 0 failed. Typecheck clean for both `apps/web` and
the e2e package. One pre-existing e2e typecheck error in
`enhance-pki-admin-config.spec.ts` (`Page` not exported from `helpers/base`) is
untouched by this branch.
