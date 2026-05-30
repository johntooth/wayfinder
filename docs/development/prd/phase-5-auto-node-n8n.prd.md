# PRD — Phase 5: Auto Node Type + n8n Sub-Workflow Integration

- **Status**: Draft
- **Date**: 2026-05-30
- **Author**: richy.brasier@gmail.com
- **Target version**: TBD (bump: MINOR — new jsonb column + new behaviour, no
  breaking domain change. Exact version set at build time.)

> Realises PRD §11 future work items "Auto Node type (autonomous, no human
> input)" and "n8n sub-workflow integration (`N8nNodeExecutor`)". The third
> Phase 5 item — "Approval gate UI for auto nodes with write actions" — is
> **deliberately deferred** (see §4).

## 1. Problem

Today every Wayfinder step is conversational: a human must take a turn for a
node to make progress. Real procurement processes contain steps that are pure
machine work — vendor lookups, SharePoint writes, AusTender publishing,
delegation-register checks. There is no way to express "do this automatically
and carry the result forward" in a flow. The seams to support it
(`INodeExecutor` port, `MockNodeExecutor`, the `auto` node-type enum, the
stubbed n8n webhook) were laid at Phase 0 but never wired together.

## 2. Users / Personas

- **Flow owner** — building a procurement flow on the canvas; wants to drop in
  an autonomous step that hands off to an n8n sub-workflow and continues once
  it returns, without authoring a conversation for it.
- **Procurement officer** — running a session; sees an auto step run and
  complete inline, with its returned data carried into later steps, and never
  has to type anything for that step.
- **n8n workflow author** — building the sub-workflow on the n8n side; needs a
  stable request contract (free-text instruction + named structured fields) and
  a stable callback contract (signed webhook, structured JSON).

## 3. Goals

- A flow owner can set a node's type to `auto` on the canvas and configure: a
  free-text **instruction**, the **request fields** to gather and send, the
  **response fields** expected back, and the **n8n webhook URL**.
- When a session reaches an `auto` node, Wayfinder gathers the request-field
  values from the conversation so far, POSTs `{ instruction, fields, … }` to the
  node's n8n webhook (signed), and **does not prompt the user** for a turn.
- When n8n calls back, Wayfinder coerces the returned JSON against the declared
  response fields (best-effort), persists it as a step output, and advances the
  session to the next node.
- Auto-node structured data is authored, gathered, and persisted using the
  **same primitives** as document generation (`TemplateField`,
  `buildFieldConstraintsText` + `generateObject`, `StepOutputField`) — no
  parallel field system.
- Multiple auto nodes can be in flight across a deployment, and a stale or
  duplicate n8n callback is ignored rather than double-advancing a session.

## 4. Non-goals

- **No approval-gate UI.** The `pending_approval` status stays in the
  `INodeExecutor` output union but no UI or halting behaviour is built for it.
  Auto nodes with write side-effects run without an in-app approval step this
  phase. (Remains PRD §11 future work.)
- **No new node-authoring canvas framework.** Auto-node config reuses the
  existing node-config modal and the `TemplateField` annotation syntax.
- **No SSE redesign.** Auto-node completion surfaces through the existing
  session-message + step-output mechanisms; we do not introduce a new streaming
  channel solely for auto nodes.
- **No n8n instance management / provisioning.** Wayfinder targets a webhook URL
  the flow owner supplies; standing up n8n is out of scope.
- **No ret/ evaluation/ contract `.docx` examples for auto nodes.** Auto nodes
  produce structured data, not documents.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `AutoNodeConfig` | `packages/domain/src/entities/flow-node.ts` | new | `instruction`, `executor` (`n8n`/`mock`), `requestFields?`, `responseFields?`, `webhookUrl` |
| `TemplateField` | `packages/domain/src/entities/template-field.ts` | **reused** | canonical field descriptor for both request and response fields |
| `StepOutputField` / `ISessionStepOutputRepository` | `packages/domain/src/entities/session-step-output.ts` | **reused** | how auto-node output is persisted (same table as docx output) |
| `INodeExecutor` / `NodeExecutionInput` / `NodeExecutionOutput` | `packages/domain/src/ports/node-executor.ts` | amended | add `instruction`, `flowSlug`, `sessionTitle`; tighten `fields` to `Record<string, string>` |
| `N8nNodeExecutor` | `packages/adapters/src/node-executors/n8n-node-executor.ts` | new | signed POST to the node's `webhookUrl` |
| `MockNodeExecutor` | `packages/adapters/src/node-executors/mock-node-executor.ts` | existing | dev/test double; updated to new input shape |
| `extractStructuredFields` | `packages/application/src/use-cases/document/` (factored out) | new (refactor) | shared gather-into-JSON helper used by docx **and** n8n |
| `app_sessions.pending_executions` | `packages/adapters/src/db/schema/wayfinder.ts` | new column (jsonb) | correlation map for in-flight auto-node callbacks |

## 6. User stories

1. As a **flow owner**, I can switch a node to `auto`, write an instruction,
   declare the fields to send and expect back, and set the n8n webhook URL, so
   that the step runs automatically during a session.
2. As a **flow owner**, I declare request/response fields with the same
   `Label (type)` annotation syntax I already use in `.docx` templates, so I
   don't learn a second schema language.
3. As a **procurement officer**, when my session reaches an auto step it runs
   without asking me for input, and the data it returns is available to later
   steps, so the process moves forward on its own.
4. As an **n8n workflow author**, I receive a signed request with a free-text
   instruction and named fields, and I call back a signed structured JSON
   payload, so the contract is stable and verifiable on both legs.

## 7. Pages / surfaces affected

- `/admin/flows/[id]` and `/flows/[id]/config` (canvas) — node-config modal
  gains an `auto`-type variant: instruction textarea, request-fields editor,
  response-fields editor, webhook URL input. Reuses the `TemplateField`
  annotation parser for the field editors.
- `/chats/[sessionId]` — an auto step renders as a non-interactive step in the
  progress rail; on completion its returned data appears via the existing
  step-output / system-message surface. No input box for that step.
- `apps/api` `POST /v1/webhooks/n8n/:sessionId` — **implemented** (replaces the
  501 stub). HMAC verification already exists; body
  `{ nodeId, status, data, message? }` per ADR-010.
- tRPC: `flow.update` accepts the new `auto` config shape; `session.*` resume
  path handles advancing past a completed auto node. No new router.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_sessions` | add column `pending_executions jsonb not null default '{}'` — correlation map keyed by `correlationId` → `{ nodeId, status, sentAt }` for in-flight auto-node callbacks | n/a (existing table) |
| `app_flow_nodes` | no schema change — `type` enum already includes `auto`; auto config stored in existing `config jsonb` | yes (app_) |

No new tables. Embedding the correlation map as `jsonb` on `app_sessions`
follows ADR-006 (jsonb over join tables) and matches how `graph_checkpoint`
already lives on the session.

## 9. Architectural decisions

- **Assumes** ADR-001 (Hexagonal), ADR-004/007 (LangGraph adapter, session-
  scoped graph + checkpoint), ADR-006 (Wayfinder schema, jsonb columns),
  ADR-009 (the docx structured-data primitives this phase reuses).
- **Amends** ADR-010 (External Workflow Integration) — settles its Phase 5 open
  question about input schemas, adds `instruction` to the port, tightens
  `fields` to `Record<string, string>`.
- **Introduces ADR-013 — Auto Node Structured Data & n8n Execution**: reuse
  `TemplateField` as the request/response field descriptor; async correlation
  via the `app_sessions.pending_executions` jsonb map; best-effort coercion of
  n8n responses; per-node webhook URL.

## 10. Acceptance criteria

- [ ] A flow owner sets a node to `auto`, enters an instruction, declares
      request and response fields (using `Label (type)` syntax), sets a webhook
      URL, saves, and the config survives a page refresh.
- [ ] Declaring a malformed field annotation surfaces the same validation error
      as a malformed `.docx` tag (shared `parseTemplateField` path).
- [ ] When a session reaches an `auto` node, no user input box renders for that
      step and an `INodeExecutor.execute()` call is made with `instruction`,
      gathered `fields`, `flowSlug`, and `sessionTitle` populated.
- [ ] With `N8N_WEBHOOK_SECRET` unset, the executor falls back to
      `MockNodeExecutor`; with it set, `N8nNodeExecutor` POSTs a signed request
      to the node's `webhookUrl`.
- [ ] `POST /v1/webhooks/n8n/:sessionId` with a valid signature and a body
      matching the declared response fields persists a `StepOutputField[]`
      record via `ISessionStepOutputRepository` and advances the session.
- [ ] A response with missing/invalid keys is coerced best-effort: matched
      fields are stored, unmatched/invalid fields are left blank, and the node
      still completes (never fails on coercion mismatch).
- [ ] A duplicate or stale callback (correlation id not pending, or already
      completed) is ignored — the session is not advanced twice.
- [ ] Two sessions each with an in-flight auto node receive their own callbacks
      correctly (correlation map is per-session, keyed by correlation id).
- [ ] An auto node's returned data is visible to subsequent nodes via gathered
      context / step outputs.
- [ ] `MockNodeExecutor` and `N8nNodeExecutor` each have a test file written
      before their implementation; the webhook handler has a test covering
      valid, invalid-signature, stale, and best-effort-coercion cases.
- [ ] `./validate.sh` passes. `VERSION` and root `package.json#version` match at
      the phase's target version.

## 11. Out of scope / future work

- **Approval gate UI for auto nodes with write actions** — deferred (remains in
  the root PRD §11 list). `pending_approval` stays in the port union, unused.
- **n8n inbound payload as a typed/Zod contract beyond `TemplateField`
  coercion** — best-effort coercion only this phase.
- **Retry / dead-letter handling for failed auto nodes** — a `failed` status
  surfaces a message; automatic retry policy is a later phase.
- **Per-node secrets / per-workflow auth** — a single shared
  `N8N_WEBHOOK_SECRET` is used; per-node credentials are future work.

## 12. Risks / open questions

- **Async resume vs LangGraph checkpoint** — the callback resumes a
  checkpointed graph (ADR-007). Risk: the session's `current_node_id` moved on
  between send and callback. Mitigation: the `pending_executions` correlation
  map records the `nodeId` that was sent; the handler validates the callback's
  `nodeId` against the pending entry before advancing.
- **Lost callback / n8n never responds** — the session sits at the auto node
  indefinitely. Mitigation (this phase): record `sentAt` in the correlation map
  so a stuck execution is observable; automatic timeout/retry is future work.
- **Field-key collisions between request and response** — both reuse
  `TemplateField.key`. Mitigation: persist response data as its own
  `StepOutputField[]` record keyed by node, exactly as docx output is.
- **Best-effort coercion hides bad data** — a wrong-typed value may be silently
  blanked. Accepted trade-off (confirmed): consistent with how
  `persistStepOutput` is already best-effort and never fails the turn.
- **Webhook URL is flow-owner-authored** — an owner could point at an arbitrary
  host. Mitigation note: the signature only proves the body, not the
  destination; egress restrictions are a deployment concern, flagged for the
  security review at build time.
