# Implementation Summary — v0.27.6

**Phase doc:** [`enhance-flow-insights-menu-ui.md`](./enhance-flow-insights-menu-ui.md)
**Base branch:** `release/alpha-2`
**Version bump:** PATCH — `0.27.5` → `0.27.6`
**Migrations run:** none. No schema change.

Two independent corrections to surfaces released in the alpha-2 line.

## 1. "Applies to" retired from the Flow Insights approval columns

Every decided approval projected seven columns onto its step. One of them,
`Applies to`, restated in prose the step name the column group is already headed
by, costing a column's width on every approval step and telling a reader nothing.

Removed in three places, because stopping the write alone would have left the
column alive on exactly the flows with the most approval history:

- **The definition.** `APPROVAL_PROJECTION_FIELDS` drops its `applies_to` entry
  and is now six. The list is the single source for the keys a decision writes
  and the labels they carry, so this stops both together.
- **The write.** `DecideApproval.projectDecision` no longer emits the field, and
  the private `appliesTo()` helper it called is deleted — nothing else called it.
  `SUBJECT_NODE_ID_KEY`, `readRecordString` and `flowNodesOfFlow` all have other
  callers in the same file and stay.
- **The read.** `computeFieldReport` skips a column (and its values) whose
  `fieldKey` is `applies_to` on a node of type `approval`, so approvals decided
  before this change read the same as ones after it. Scoping the skip to approval
  steps is what makes it safe: an approval step has no author-defined fields,
  only projected ones, so the rule cannot swallow a field somebody wrote. A
  conversational step with a field labelled "Applies to" keeps its column, and
  there is a test for it.

**The signed record is untouched.** `subject_description` and `subject_node_id`
stay frozen in `record_snapshot` exactly as ADR-040 §3 requires, no rows were
rewritten or deleted, and the subject still renders on all three approval
surfaces (`decision-modal.tsx`, `approvals/[approvalId]/_content.tsx`,
`approvals/_content.tsx`). Only the report column went.

## 2. Sidebar brand and footer pinned; only the menu scrolls

`AppSidebar` put `overflow-y-auto` on the whole rail, so the brand row, nav
groups, Recent chats and footer scrolled as one piece. Expand two collapsible
groups of the admin rail's ~20 items on a short viewport and "Exit admin mode"
and the account chip — Settings, usage, Sign out — scrolled off the bottom.

The desktop `<aside>` and the mobile drawer are now three regions apiece:

| | Before | After |
|---|---|---|
| container | `flex flex-col gap-[18px] overflow-y-auto` | `flex flex-col gap-[18px] overflow-hidden` |
| brand | scrolled | pinned, `shrink-0` |
| nav + Recent | scrolled with everything else | `flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto`, `data-testid="app-sidebar-scroll"` |
| footer | `mt-auto`, scrolled off | pinned, `shrink-0` |

`min-h-0` on the scroll region is the load-bearing part: a flex child defaults to
`min-height: auto` and refuses to shrink below its content, so without it the
region grows to fit every nav item and pushes the footer out of the container —
the original bug with extra steps. `mt-auto` came off the footer because `flex-1`
on the middle region now does that job unconditionally. The container keeps its
`gap-[18px]`, so the three regions sit exactly where they did.

**Recent chats keeps its cap of 8**, which already existed inline as
`.slice(0, 8)`. It moved to `RECENT_CHATS_LIMIT` and `recentChatSessions` in
`sidebar-model.ts` — same filter, same cap, same order — so the cap is now stated
once and tested rather than being a literal buried in a chain.

## Files changed

| Layer | File | Change |
|---|---|---|
| domain | `packages/domain/src/entities/approval-record.ts` | `applies_to` dropped from `APPROVAL_PROJECTION_FIELDS`; history comment corrected |
| domain | `packages/domain/src/entities/analytics.ts` | new `isRetiredApprovalField`; applied in both the column and the value loop of `computeFieldReport` |
| domain | `packages/domain/src/entities/analytics.test.ts` | six-key order; the key's absence; historical column skipped; a non-approval step keeps its authored `applies_to` |
| application | `packages/application/src/use-cases/approvals/decide-approval.ts` | projected field removed; `appliesTo()` deleted |
| application | `packages/application/src/use-cases/approvals/approvals.test.ts` | projection asserts the exact six-key set; the unwired-path case drops its `applies_to` expectation |
| web | `apps/web/src/components/sidebar-model.ts` | new `RECENT_CHATS_LIMIT`, `recentChatSessions` |
| web | `apps/web/src/components/sidebar-model.test.ts` | six cases, including that the cap is counted after abandoned chats are dropped |
| web | `apps/web/src/components/sidebar.tsx` | three-region layout on rail and drawer; uses the new helper |
| e2e | `apps/web/e2e/enhance-flow-insights-menu-ui.spec.ts` | **new** |
| e2e | `apps/web/e2e/enhance-flow-insights-approval-segmentation.spec.ts` | its "Applies to" assertions removed — that spec asserted the column was present |
| docs | `docs/development/implemented/alpha-2/v0.27.6/` | phase doc + this summary |
| release | `VERSION`, `package.json` | `0.27.6` |

`apps/web/src/lib/e2e-fixtures-approval.ts` was deliberately **not** changed. Its
three `applies_to` fixture fields mirror what `projectDecision` used to write,
which is now exactly the shape of a decision recorded before this change — the
historical row the read-side skip needs in order to be proven against seeded data
rather than only in a unit test.

## E2E coverage

`apps/web/e2e/enhance-flow-insights-menu-ui.spec.ts`, six tests:

| Test | Covers |
|---|---|
| no Applies to column, even for an approval decided before it was retired | the read-side skip, against the seeded row that still stores the value |
| the rest of the approval metadata is untouched | Outcome / Revision / Decided by / Approver email still present — the skip does not over-reach |
| the Columns dialog does not offer it either | the column is gone from the picker, not merely hidden in the table |
| the account chip and admin-mode button remain on screen | the reported defect, on a 420px-tall viewport with every admin group expanded |
| scrolling the nav moves the items and nothing else | brand and footer hold their position; the rail itself is no longer the scroller |
| a user's Recent chats scroll with the nav rather than beside it | Recent sits inside the scroll region; the cap is respected |

Not run locally — CI runs the suite on the pull request, against a full stack.

## Known limitations

- **A deleted approval step keeps its historical `Applies to` column.** The skip
  keys on `nodeType`, and a step output whose node is gone from the live flow has
  no type to test. This is the pre-existing shape of every historical column for
  a deleted node — such columns are already headed by a raw node id — and
  widening the rule to cover it would mean dropping the key on nodes the report
  knows nothing about, which is the one way it could swallow an authored field.
- **Stored `applies_to` values remain on disk.** Deliberate: no migration, no row
  loss, and the change is reversible by deleting six lines.
- **The rail layout has no unit test.** `apps/web`'s vitest config has no DOM
  environment, so component tests there assert on exports rather than rendered
  output. The layout is covered end-to-end instead.

## Validation

`./validate.sh` — 23 checks passed, 0 failed. 2,977 unit tests pass across
`shared`, `domain`, `adapters`, `application`, `web` and `api`.
