# PRD — Step Approvals

- **Status**: Draft
- **Date**: 2026-06-03
- **Author**: Richy Brasier
- **Target version**: 1.24.0  (bump: **MINOR** — new node type, new table, new
  domain ports; additive)

## 1. Problem

Document-heavy processes routinely reach a point where work cannot proceed until
a named authority signs off — typically the operator's first-line supervisor.
Today a Wayfinder flow advances through every node automatically; there is no way
to *pause* a flow at a step, route it to the right person, and only continue once
that person has approved. The `pending_approval` status exists in the
`INodeExecutor` contract and the n8n webhook schema but is unused — the gate was
deliberately deferred (ADR-010).

## 2. Users / Personas

- **Operator** — runs a flow to produce a record; needs to submit a step for
  approval and see where it is.
- **Supervisor / Approver** — the person holding the position the step requires;
  needs an inbox of pending requests and a way to approve, reject, or request
  changes with a comment.
- **Flow author** — designs the flow; needs to drop an approval step onto the
  canvas and declare *which position* approves it.

## 3. Goals

- A flow author can place an **`approval` node** on the canvas and configure the
  required position (e.g. `first_line_supervisor`).
- When a session reaches an approval node, it **pauses** in a pending state and
  does not advance until a decision is recorded.
- The approver is **resolved at runtime** from the operator's reporting line;
  when it cannot be resolved, the operator **picks an approver manually**.
- The approver receives an **email notification** (existing mail provider) and
  can approve / reject / request changes with a comment.
- Every request and decision is written to `core_audit_log`.
- On approval, the approved record snapshot is recorded so the
  record-regeneration procedure (see Scheduling PRD) can pick it up.

## 4. Non-goals

- Multi-stage / parallel approval chains (single approver per node this phase).
- Delegation, out-of-office, or vacation routing.
- Approving *outside* Wayfinder (e.g. approve-by-email-reply). Decisions happen
  in-app.
- Defining the org chart UI. We add the minimum reporting-line data needed to
  resolve "first-line supervisor"; bulk org management is future work.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `Approval` | `packages/domain/src/entities/approval.ts` | new | One request + its decision. |
| `FlowNode` (type `approval`) | `packages/domain/src/entities/flow-node.ts` | existing | Add `approval` to the type union + config shape. |
| `IApprovalRepository` | `packages/domain/src/ports/approval-repository.ts` | new | CRUD + `listPendingForApprover`. |
| `IReportingLineResolver` | `packages/domain/src/ports/reporting-line-resolver.ts` | new | position + requester → approver user. |
| `User` | `packages/domain/src/entities/user.ts` | existing | Add `supervisorUserId`. |

## 6. User stories

1. As a flow author, I can add an approval step and set its required position,
   so a flow halts for sign-off at the right point.
2. As an operator, when I complete the step before an approval node, the flow
   tells me it is **awaiting approval** and from whom.
3. As an operator, if no supervisor can be resolved, I can pick my approver,
   so the flow is never stuck without a route.
4. As a supervisor, I see a list of requests awaiting me and can approve,
   reject, or request changes with a comment.
5. As an operator, when my step is approved, the flow continues; when changes
   are requested, I see the feedback and can revise.

## 7. Pages / surfaces affected

- `/approvals` (web) — approver inbox of pending requests.
- Flow canvas — new `approval` node type in the palette + config panel.
- Session chat — an inline "awaiting approval / manual-approver picker / decision
  result" card.
- tRPC: `approval.listPending`, `approval.decide`, `approval.pickApprover` — new.
- `apps/api` — no new external route; approvals are in-app.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_session_approvals` | NEW | yes (app_) |
| `core_users` | add column `supervisor_user_id uuid` (nullable, self-FK) | n/a |
| `app_flow_nodes` | no schema change; `type` gains `approval`, `config` gains approval shape (JSONB) | n/a |

`app_session_approvals` columns: `id`, `session_id`, `flow_id`, `node_id`,
`message_id` (nullable), `requested_by_user_id`, `position`,
`resolved_approver_user_id` (nullable), `is_manual_fallback` (bool),
`status` (`pending`|`approved`|`rejected`|`changes_requested`),
`decided_by_user_id` (nullable), `decided_at` (nullable), `comment` (nullable),
`record_snapshot` (jsonb — the step outputs under review), `created_at`,
`updated_at`. Index on `(resolved_approver_user_id, status)` for the inbox.

## 9. Architectural decisions

- **ADR-018 — Approval step type & approver resolution** (new): approval as a
  dedicated node type (not step config); reuse of `pending_approval`; the
  reporting-line model and the position-with-manual-fallback rule.
- Assumes ADR-010 (`INodeExecutor` / `pending_approval`) and the
  `INotificationSender` from the Email Notifications feature.
- Hands the approved snapshot to the Scheduling feature's record-regeneration
  procedure — see `record-regeneration` contract in the Scheduling PRD.

## 10. Acceptance criteria

- [ ] An `approval` node can be added, configured with a position, and saved.
- [ ] Reaching an approval node creates a `pending` `app_session_approvals` row
      and the session does not advance.
- [ ] The approver is resolved from `supervisor_user_id`; when null, the operator
      is prompted to pick one and `is_manual_fallback` is set.
- [ ] Approve advances the session and records the approved snapshot; reject /
      request-changes surface the comment and do not advance.
- [ ] Approver gets an email on request; operator gets an email on decision.
- [ ] Request and decision both write `core_audit_log` rows.
- [ ] No double-decision: deciding an already-decided approval is rejected.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.

## 11. Out of scope / future work

- Multi-stage approval chains, quorum, and delegation.
- A full org-chart admin surface (only `supervisor_user_id` ships now).
- Approve-by-email and mobile push.

## 12. Risks / open questions

- **Reporting-line data is the riskiest dependency.** `supervisor_user_id` must
  be populated for resolution to work; until then every approval falls back to
  manual pick. ADR-018 weighs a column vs a `core_reporting_lines` table.
- Position vocabulary: free-text key vs an enum/admin-managed list. Starting with
  a small documented key set (`first_line_supervisor`).
- What happens to an in-flight approval if the flow is versioned/edited
  underneath it — resolved by snapshotting the record under review.
