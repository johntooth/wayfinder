# Phase — Step Approvals

- **Status**: Sketched (awaiting `/doc-review`)
- **Target version**: 1.24.0 (bump: **MINOR** — new node type, new table, new
  domain ports)
- **PRD**: `docs/development/prd/step-approvals.prd.md`
- **ADR**: `docs/development/adr/018-approval-step-and-approver-resolution.adr.md`
- **Depends on**: ADR-010 (`pending_approval`), Email Notifications
  (`INotificationSender`)

## 1. Goal

A dedicated `approval` node that pauses a flow until a resolved approver decides.
Approver = required position resolved from the requester's reporting line, with a
manual-pick fallback. Decisions are recorded, audited, and notified by email.

## 2. Approach

Hexagonal, gate-on-pending:

1. `approval` joins the `FlowNode` type union with an `ApprovalNodeConfig`.
2. Reaching the node yields `status: 'pending_approval'`, writes a `pending`
   `app_session_approvals` row, and holds the session at `current_node_id`.
3. `IReportingLineResolver` maps `(position, requester)` → approver via
   `core_users.supervisor_user_id`; unresolved + `allowManualFallback` prompts
   the operator to pick.
4. A decision use-case advances or routes back, records the snapshot on approve,
   writes audit, and enqueues notifications.

See ADR-018.

## 3. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/approval.ts` | New `Approval` entity. |
| domain | `packages/domain/src/entities/flow-node.ts` | Add `approval` to union + `ApprovalNodeConfig`. |
| domain | `packages/domain/src/entities/user.ts` | Add `supervisorUserId`. |
| domain | `packages/domain/src/ports/approval-repository.ts` | New `IApprovalRepository` (`create`, `findById`, `listPendingForApprover`, `decide`). |
| domain | `packages/domain/src/ports/reporting-line-resolver.ts` | New `IReportingLineResolver`. |
| application | `packages/application/src/use-cases/approvals/request-approval.ts` | Create row + resolve approver + notify. |
| application | `packages/application/src/use-cases/approvals/pick-approver.ts` | Manual fallback selection. |
| application | `packages/application/src/use-cases/approvals/decide-approval.ts` | approve/reject/changes; advance or route back; audit + notify. |
| application | `packages/application/src/use-cases/approvals/list-pending-approvals.ts` | Approver inbox query. |
| adapters | `packages/adapters/src/repositories/drizzle-approval-repository.ts` | Persistence. |
| adapters | `packages/adapters/src/reporting/db-reporting-line-resolver.ts` | Reads `supervisor_user_id`. |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | New `app_session_approvals`. |
| adapters | `packages/adapters/src/db/schema/core.ts` | `core_users.supervisor_user_id`. |
| adapters | `packages/adapters/drizzle/<next>.sql` | Migration. |
| apps/web | `apps/web/lib/container.ts` | Wire repo, resolver, use-cases. |
| apps/web | `apps/web/.../trpc/routers/approval.ts` | `listPending`, `decide`, `pickApprover`. |
| apps/web | `apps/web/app/(user)/approvals/page.tsx` | Approver inbox. |
| apps/web | session chat components | Awaiting-approval / picker / decision card. |
| apps/web | canvas node config | `approval` node palette + config panel. |
| apps/web | session-advance path | Halt on `pending_approval`; resume on approve. |

## 4. Database changes

### New table: `app_session_approvals`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `session_id` | uuid FK → `app_sessions` | |
| `flow_id` | uuid FK → `app_flows` | |
| `node_id` | uuid FK → `app_flow_nodes` | the approval node |
| `message_id` | uuid | nullable |
| `requested_by_user_id` | uuid FK → `core_users` | |
| `position` | text | e.g. `first_line_supervisor` |
| `resolved_approver_user_id` | uuid FK → `core_users` | nullable |
| `is_manual_fallback` | boolean | default false |
| `status` | text | `pending`\|`approved`\|`rejected`\|`changes_requested` |
| `decided_by_user_id` | uuid FK → `core_users` | nullable |
| `decided_at` | timestamptz | nullable |
| `comment` | text | nullable |
| `record_snapshot` | jsonb | step outputs under review |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Index on `(resolved_approver_user_id, status)` for the inbox.

### Altered table: `core_users`

Add `supervisor_user_id uuid` nullable, self-FK.

## 5. Notifications

New triggers on the existing `INotificationSender`: `approval_requested`
(→ approver) and `approval_decided` (→ requester). Outbox + non-blocking, per the
Email Notifications ADR.

## 6. Implementation order (tests first)

1. `app_session_approvals` schema + `core_users` column + migration; repository
   test → repository.
2. `IReportingLineResolver` test → `DbReportingLineResolver`.
3. `request-approval` / `pick-approver` / `decide-approval` use-case tests
   (resolution, fallback flag, no double-decision, advance vs route-back) →
   use-cases.
4. Halt-on-`pending_approval` in the advance path; resume on approve.
5. tRPC router + inbox page + chat cards + canvas node config.

Write the test file before each implementation file (CLAUDE.md rule).

## 7. ADR required

ADR-018 (written) — approval as a node type, `pending_approval` reuse, reporting
line as a `core_users` column, position-with-manual-fallback.

## 8. Risks / open questions

Carried from PRD §12: reporting-line data availability, position vocabulary, and
flow-edit-under-an-open-approval (mitigated by `record_snapshot`).

## 9. Acceptance criteria

Mirror PRD §10. At minimum:

- [ ] Approval node configurable and saveable; reaching it halts the session and
      writes a `pending` row.
- [ ] Approver resolved from `supervisor_user_id`; null → manual pick with
      `is_manual_fallback` set.
- [ ] Approve advances + snapshots; reject/changes surface comment and hold.
- [ ] Email on request and on decision; audit rows on both.
- [ ] Deciding an already-decided approval is rejected.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.
