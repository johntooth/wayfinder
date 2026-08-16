# Enhancement — Drop "Applies to" from the Insights approval columns, and pin the sidebar's brand and account rows

**Status:** Implemented
**Base branch:** `release/alpha-2`
**Version bump:** PATCH — `0.27.5` → `0.27.6`
**ADRs touched:** none new. Relates to ADR-040 §5 (the frozen approval record and
its step-namespaced keys).

Two independent, small changes ship together because both are cosmetic
corrections to surfaces released in the alpha-2 line and neither carries schema
impact.

## 1. Problem

**A — "Applies to" is noise in the Flow Insights field report.** Every decided
approval projects seven columns onto its step. One of them, `Applies to`, repeats
what the column group already says: the columns are grouped under the approval
step's own name, and the subject of an approval is nearly always the step
immediately before it, so the cell restates the report's own structure in prose
(`the output of the step "Prepare instrument"`). It costs a column's width on
every approval step in a flow and tells a reader nothing the surrounding columns
do not.

**B — the sidebar scrolls as one piece.** `AppSidebar` puts `overflow-y-auto` on
the whole rail, so the brand row, the nav groups, Recent chats and the footer all
scroll together. The admin rail carries around twenty items across four groups;
expand two collapsible groups on a short viewport and the footer — "Exit admin
mode" and the account button that holds Settings, usage and Sign out — scrolls
off the bottom. The controls a user reaches for most often are the ones that
disappear first, and nothing on screen suggests they are still there.

## 2. Goals

- No `Applies to` column in the Flow Insights field report, for approvals decided
  before this change as well as after.
- The signed record is untouched: `subject_description` and `subject_node_id`
  stay in `record_snapshot` exactly as frozen at decision time.
- Brand row pinned to the top of the rail, footer pinned to the bottom, only the
  nav groups and Recent chats scrolling between them — on the desktop rail and
  the mobile drawer alike.
- The Recent chats cap stays where it is (8) and gains a tested home.

## 3. Non-goals

- No migration and no rewrite of stored `app_session_step_outputs` rows. The
  `applies_to` values already written stay on disk; the report stops rendering
  them. Nothing else reads them, so leaving them costs nothing and keeps the
  change reversible.
- No change to the approval subject itself — how it is resolved, what it is
  frozen as, or how `ApproverEditSubjectFields` and `signature-values.ts` read
  `SUBJECT_NODE_ID_KEY` back out.
- No change to which items the sidebar shows, their order, grouping, collapse
  behaviour or active-row resolution. This is a scroll-container change only.
- Recent chats is **not** raised to 20. The cap already exists at 8; raising it
  would work against the change that pins the footer.

## 4. Approach — A, "Applies to"

Three edits, in dependency order:

**The definition.** `APPROVAL_PROJECTION_FIELDS` drops its `applies_to` entry.
The list is the single source for both the keys a decision writes and the labels
they carry, so removing it there stops the write and the heading together.

**The write.** `DecideApproval.projectDecision` drops its `field("applies_to", …)`
line, and the private `appliesTo()` helper it called goes with it — nothing else
calls it, and CLAUDE.md admits no dead code. `SUBJECT_NODE_ID_KEY`,
`readRecordString` and `flowNodesOfFlow` all have other callers in the same file
and stay.

**The read.** Stopping the write leaves every approval decided before this change
still carrying the key, and the field report builds its columns from whatever the
stored rows contain — so the column would linger for months on exactly the flows
that have the most approval history. `computeFieldReport` therefore skips a
column whose `fieldKey` is `applies_to` on a node of type `approval`.

Scoping the skip to `nodeType === "approval"` is what makes it safe: approval
steps have no author-defined template fields at all, only projected ones, so the
rule cannot swallow a field somebody authored. A conversational step with a field
labelled "Applies to" derives the same key and keeps its column.

## 5. Approach — B, the pinned rail

`AppSidebar` already composes the rail from three pieces (`brand()`, `railBody`,
`footer`) rendered twice, once into the desktop `<aside>` and once into the
mobile drawer. Both containers get the same treatment, so the two stay in step:

| | Before | After |
|---|---|---|
| container | `flex flex-col gap-[18px] overflow-y-auto` | `flex flex-col overflow-hidden` |
| brand | scrolls | pinned, `shrink-0` |
| nav + Recent | scrolls with everything else | `flex-1 min-h-0 overflow-y-auto` |
| footer | `mt-auto`, scrolls off | pinned, `shrink-0` |

`min-h-0` on the scroll region is load-bearing: a flex child's default
`min-height: auto` refuses to shrink below its content, so without it the region
grows to fit all twenty nav items and pushes the footer out of the container —
the current bug, reproduced with extra steps.

The rail's `gap-[18px]` moves off the container and onto the scroll region and
the brand/footer spacing, so the three regions sit where they do today. `mt-auto`
comes off the footer: it exists to push the footer down when content is short,
which is what `flex-1` on the middle region now does unconditionally.

Both layouts already sit inside `flex min-h-0 flex-1 overflow-hidden` in
`(user)/layout.tsx` and `(admin)/admin/layout.tsx`, so the rail has a bounded
height to scroll within. The mobile drawer is `fixed bottom-0 … top-0`, which
bounds it the same way.

**Recent chats.** The `.slice(0, 8)` inline in the component becomes
`RECENT_CHATS_LIMIT` plus a `recentChatSessions` helper in `sidebar-model.ts`,
which is where the rail's other pure logic already lives. Same filter, same cap,
same order — the change is that the cap is now stated once and tested, rather
than being a literal buried in a JSX-adjacent chain.

## 6. Key files

| Layer | File | Change |
|---|---|---|
| domain | `packages/domain/src/entities/approval-record.ts` | drop `applies_to` from `APPROVAL_PROJECTION_FIELDS`; correct the comment above it |
| domain | `packages/domain/src/entities/analytics.ts` | `computeFieldReport` skips `applies_to` columns on `approval` nodes |
| domain | `packages/domain/src/entities/analytics.test.ts` | six-key order; historical `applies_to` excluded; authored `applies_to` on a non-approval step kept |
| application | `packages/application/src/use-cases/approvals/decide-approval.ts` | drop the projected field and the `appliesTo()` helper |
| application | `packages/application/src/use-cases/approvals/approvals.test.ts` | projection writes six fields, none `applies_to` |
| web | `apps/web/src/components/sidebar-model.ts` | **new** `RECENT_CHATS_LIMIT`, `recentChatSessions` |
| web | `apps/web/src/components/sidebar-model.test.ts` | cases for both |
| web | `apps/web/src/components/sidebar.tsx` | three-region layout on rail and drawer; use the new helper |
| e2e | `apps/web/e2e/enhance-flow-insights-menu-ui.spec.ts` | **new** |

`apps/web/src/lib/e2e-fixtures-approval.ts` keeps its three `applies_to` fixture
fields deliberately. They were written to mirror what `projectDecision` produced
at the time, which is now precisely the shape of a decision recorded *before*
this change — the historical row §4 needs in order to prove the read-side skip
works against real seeded data rather than only in a unit test.

No adapter, tRPC, schema or migration change. No API response shape changes: the
field report's column list is computed, and it simply contains one fewer entry.

## 7. Implementation steps (test-first per CLAUDE.md)

1. **Domain tests first.** In `analytics.test.ts`: `APPROVAL_PROJECTION_FIELDS`
   names six keys in report order with `applies_to` absent; `computeFieldReport`
   emits no column for an `applies_to` field on an `approval` node while keeping
   that node's other six; the same key on a `conversational` node still gets a
   column. Then make them pass in `approval-record.ts` and `analytics.ts`.
2. **Application test.** In `approvals.test.ts`, assert the projection created by
   a decision carries the six keys and no `applies_to`. Then cut the field and
   the helper from `decide-approval.ts`.
3. **Sidebar model.** Write the `recentChatSessions` cases first — abandoned
   sessions filtered out, order preserved, a list longer than the cap truncated
   to `RECENT_CHATS_LIMIT`, a shorter one returned whole — then implement and
   call it from `sidebar.tsx`.
4. **Rail layout.** Apply §5 to the `<aside>` and the drawer.
5. **New e2e.** Write `enhance-flow-insights-menu-ui.spec.ts` (§8). Do not run —
   CI runs the suite on the PR.
6. **Release chores.** Bump `VERSION` and `package.json` to `0.27.6`, run
   `./validate.sh`, move this doc to `implemented/alpha-2/v0.27.6/` with a
   summary.

## 8. Test plan

`apps/web`'s vitest config has no DOM environment — component tests there assert
on exports, not rendered output — so the rail's layout is verified end-to-end
rather than in a unit test. The e2e spec covers both halves:

- **Insights.** Open the Flow Insights deep dive for the seeded approval flow and
  assert no `Applies to` column header, while `Outcome` and `Decided by` are
  still present. The seeded row carries a stored `applies_to` value, so this
  exercises the read-side skip, not just the stopped write.
- **Sidebar.** In admin mode on a short viewport, expand the collapsible groups
  until the nav region overflows, then assert the account button and "Exit admin
  mode" are still in the viewport, that the nav region has scrolled while they
  have not, and that the brand row has held its position.

## 9. Acceptance criteria

- [ ] `APPROVAL_PROJECTION_FIELDS` holds six entries; `applies_to` is not one.
- [ ] A decision projects six step-output fields and no `applies_to`.
- [ ] The field report shows no `Applies to` column for an approval step, whether
      the underlying row was written before or after this change.
- [ ] A non-approval step keeps a column for a field it authored as `applies_to`.
- [ ] `record_snapshot` still carries `subject_description` and
      `subject_node_id`; approver-edit and signature-value resolution are
      unaffected.
- [ ] On both the desktop rail and the mobile drawer, brand and footer stay fixed
      while nav groups and Recent chats scroll between them.
- [ ] Recent chats renders at most 8 entries, abandoned sessions excluded.
- [ ] `VERSION` = `package.json#version` = `0.27.6`; `./validate.sh` passes.

## 10. Risks

- **A deleted approval step keeps its historical column.** The skip keys on
  `nodeType`, and a step output whose node is gone from the live flow has no type
  to test — so an approval step deleted from a flow still shows its `Applies to`
  column, headed by a raw node id. This is the pre-existing shape of every
  historical column for a deleted node, not something this change introduces, and
  narrowing the rule to cover it would mean dropping the key on nodes the report
  knows nothing about — which is the one way it could swallow an authored field.
- **The rail is styled by literal Tailwind classes, not tokens.** The three-region
  split moves spacing between elements, so a regression here is visual and only
  the e2e assertions and review catch it.
- **Two unrelated changes in one PR.** Both are small and touch disjoint files
  (`analytics`/`approvals` versus `sidebar`), so a revert of either is clean.
