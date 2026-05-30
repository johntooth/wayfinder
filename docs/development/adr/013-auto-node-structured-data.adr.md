# ADR-013 — Auto Node Structured Data & n8n Execution

- **Status**: Proposed (Phase 5)
- **Date**: 2026-05-30
- **Amends**: ADR-010 (External Workflow Integration via `INodeExecutor`)
- **Builds on**: ADR-006 (jsonb over join tables), ADR-007 (session-scoped
  LangGraph + checkpoint), ADR-009 (docx structured-data primitives)

## Context

Phase 5 turns the dormant `auto` node type into a working autonomous step that
hands off to an n8n sub-workflow. Two requirements drive the design:

1. A flow owner must be able to pass **free-text instructions** to n8n **and**
   request **specific named fields** back as structured JSON.
2. This must not introduce a second way of describing structured data.
   Wayfinder already has a mature pattern for "declare fields, gather them from
   the conversation as JSON, persist them" — built for `.docx` generation
   (ADR-009). Auto nodes should reuse it wholesale.

ADR-010 locked the `INodeExecutor` port and the inbound webhook location at
Phase 0, and left one open question: *should `NodeExecutionInput.fields` carry
its own schema?* This ADR answers it.

The existing docx pattern has three reusable primitives:

- **`TemplateField`** (`packages/domain/src/entities/template-field.ts`) — a
  field descriptor (`key`, `label`, `type`, `options`, `optional`, constraints),
  authored via a `Label (annotations)` mini-language parsed by
  `parseTemplateField`.
- **Gather-into-JSON** — `buildFieldConstraintsText(fields)` injects a
  `<field_constraints>` block and `languageModel.generateObject({ schema:
  documentDataSchema })` (where `documentDataSchema = z.record(z.string())`)
  returns a flat `Record<string, string>` keyed by `field.key`.
- **`StepOutputField[]`** persisted via `ISessionStepOutputRepository` — the
  canonical structured-output record (also feeds analytics).

The only docx-specific parts are the *source* of the fields (`{{tags}}` parsed
from an uploaded `.docx`) and the *sink* (`documentGenerator.generate`).
Everything between is generic.

## Decision

### 1. `TemplateField` is the lingua franca for auto-node structured data

Auto nodes declare both the fields they **send** to n8n and the fields they
**expect back** as `TemplateField[]`, authored on the canvas with the **same**
`Label (annotations)` syntax via the **same** `parseTemplateField`. No new field
type, no new annotation language.

```ts
// packages/domain/src/entities/flow-node.ts
export interface AutoNodeConfig {
  instruction: string;                 // free-text instructions for n8n
  executor: "n8n" | "mock";
  webhookUrl: string;                  // per-node n8n target (see §4)
  requestFields?: TemplateField[];     // gathered from the session, sent to n8n
  responseFields?: TemplateField[];    // expected structured JSON returned
}
```

### 2. Shared `extractStructuredFields` helper

The structured-extraction logic currently inlined in `GenerateDocument`
(`packages/application/src/use-cases/document/generate-document.ts`) is factored
into a reusable helper:

```ts
extractStructuredFields(
  fields: TemplateField[],
  transcript: string,
  contextDocs: FlowContextDoc[],
): Promise<Result<Record<string, string>>>
```

It builds the `<field_constraints>` block, calls
`languageModel.generateObject({ schema: documentDataSchema })`, and returns the
keyed JSON. `GenerateDocument` is refactored to call it (behaviour-preserving);
the auto-node outbound path calls the same helper to build `fields` for n8n.

### 3. `INodeExecutor` port update (amends ADR-010)

```ts
export interface NodeExecutionInput {
  nodeId: string;
  sessionId: string;
  userId: string;
  userRole: "admin" | "user";
  flowId: string;
  flowSlug: string;        // ADR-010 promised it; was missing in code
  sessionTitle: string;    // ADR-010 promised it; was missing in code
  instruction: string;     // NEW — free-text instructions to n8n
  fields: Record<string, string>;  // tightened from Record<string, unknown>;
                                    // keyed by TemplateField.key
}

export interface NodeExecutionOutput {
  status: "completed" | "pending_approval" | "failed";
  data: Record<string, unknown>;   // unchanged at the port boundary
  message?: string;
}
```

`pending_approval` **remains** in the union but is unused this phase — the
approval gate is deferred (PRD §4). `data` stays `Record<string, unknown>`
because n8n can return anything; coercion to `TemplateField` shape happens in
the inbound handler (§5), not at the port.

This resolves ADR-010's open question: `fields` does **not** carry a Zod schema
reference. The node config's `requestFields` / `responseFields` (`TemplateField[]`)
*are* the schema, reused from the docx pattern.

### 4. Per-node webhook URL

The n8n target lives on the node (`AutoNodeConfig.webhookUrl`), so different
auto nodes can drive different n8n workflows. The shared `N8N_WEBHOOK_SECRET`
(env) signs the outbound request and verifies the inbound callback. ADR-010's
`N8N_BASE_URL` env var is therefore **not required** for routing — kept only as
an optional default/allowlist hint, not the source of truth.

### 5. Inbound: best-effort coercion, persist, resume

`POST /v1/webhooks/n8n/:sessionId` (HMAC verification already implemented;
currently returns 501) is filled in:

1. Verify signature (existing). Body: `{ nodeId, status, data, message? }`.
2. Look up the session's `pending_executions` correlation map (§6). If this
   callback's correlation id / `nodeId` is **not pending** (stale or duplicate),
   **ignore** — do not advance.
3. **Best-effort coerce** `data` against the node's `responseFields` using
   `TemplateField` semantics: matched, valid values are kept; missing or
   invalid values are left blank. Coercion **never fails the node**, mirroring
   the existing best-effort `persistStepOutput` in `GenerateDocument`.
4. Persist the coerced values as a `StepOutputField[]` record via
   `ISessionStepOutputRepository` — the **same** table and shape as docx output,
   so analytics and reporting treat both identically.
5. Clear the pending entry, resume the checkpointed LangGraph (ADR-007), and
   advance to the next node.

### 6. Async correlation via `app_sessions.pending_executions` (jsonb)

No new table (ADR-006). A jsonb column on `app_sessions` holds an in-flight map:

```jsonc
// app_sessions.pending_executions
{
  "<correlationId>": { "nodeId": "...", "status": "pending", "sentAt": "ISO-8601" }
}
```

On send: write a pending entry keyed by a generated `correlationId` (also sent
to n8n and echoed back). On callback: match by `correlationId`, validate
`nodeId`, then remove the entry. This:

- ignores **stale/duplicate** callbacks (id absent or already cleared),
- supports **multiple in-flight** auto nodes (across sessions; and guards a
  single session against a moved `current_node_id`),
- records `sentAt` so a stuck execution is observable.

### 7. Dispatch branch

`run-turn` / the session graph currently dispatches purely on edges +
confidence — there is no `switch (node.type)`. A branch is added: when
`node.type === "auto"`, call `INodeExecutor.execute(...)` instead of the
conversational AI turn. The executor is selected in the container/factory:
`MockNodeExecutor` when `N8N_WEBHOOK_SECRET` is unset (dev/test),
`N8nNodeExecutor` when it is set. `INodeExecutor` is currently wired nowhere;
this phase registers it.

## Consequences

**Positive**

- One structured-data system. `TemplateField`, `generateObject`, and
  `StepOutputField` serve both docx and n8n; n8n output lands in the same
  reporting table.
- Flow owners learn one annotation syntax for fields everywhere.
- ADR-010's port promise (`flowSlug`, `sessionTitle`) is honoured; the open
  question is closed without a separate schema mechanism.
- No new tables; correlation rides on the session as jsonb, consistent with
  `graph_checkpoint`.

**Negative**

- `extractStructuredFields` refactor touches the working docx path — must be
  behaviour-preserving and covered by the existing docx tests.
- Best-effort coercion can silently blank a wrong-typed value (accepted, and
  consistent with current docx behaviour).
- The `pending_executions` map needs cleanup discipline (cleared on completion;
  stale entries only observable, not auto-reaped this phase).
- A flow-owner-authored `webhookUrl` is an egress concern; flagged for the
  build-time security review (signature proves body, not destination).

## Deferred (not this ADR)

- Approval-gate UI for `pending_approval` (PRD §11).
- Timeout / retry / dead-letter handling for auto nodes.
- Per-node n8n credentials beyond the shared secret.
