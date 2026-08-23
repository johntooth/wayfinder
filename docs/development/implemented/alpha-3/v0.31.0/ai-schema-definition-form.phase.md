# Phase — AI-Triggered Schema-Definition Form in Chat

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: 0.31.0 — **MINOR** (adds a column to `app_session_messages`)
- **Source**: [`JOHNS-PLAN.md`](../../../JOHNS-PLAN.md) §1, with D1 and D2 decided
- **Base branch**: `main` (new feature surface)
- **Depends on**: ADR-032 (conversational tool-loop pre-pass), ADR-038 (step output types)

## 1. Goal

When the model needs the operator to define part of a report schema, it calls a
tool instead of asking in prose. Wayfinder intercepts the call, suspends the
turn, and renders an interactive field editor in the message feed. The submitted
schema is persisted, audited, and readable by the next turn.

## 2. Decisions carried in

| # | Decision | Consequence for this phase |
|---|---|---|
| D1 | **Tool-triggered card mid-turn**, not a new node type | The suspension point is the MCP tool pre-pass (ADR-032), which runs *before* the structured reply streams. No new node type; no change to the auto/scheduled park paths. |
| D2 | **Pending form state persisted to the session** | The pending request lives on the message row, not in browser memory. Reload restores the card. |

## 3. Where the turn suspends

`runMcpToolPrepass` (`mcp-turn-helpers.ts:107`) already runs the tool loop and
returns its calls before `executeTurn` streams the structured reply. When a
returned call's `toolName` matches the node's configured schema-request tool,
the pre-pass persists a system message carrying the pending request and signals
the caller to stop. `streamTurn` never runs, so no prose is generated for that
turn — which is exactly the first acceptance criterion.

The tool's own result is discarded: the operator's submission supersedes it. The
call's `arguments` (a JSON string on `McpToolCallRecord`) seed the form's
starting rows, so the model can propose fields the operator then corrects.

## 4. What is built

| Layer | File(s) | Change |
| ----- | ------- | ------ |
| domain | `entities/schema-request.ts` (new) | `SchemaRequestField`, `PendingSchemaRequest`, `parseSchemaRequestSubmission`. Pure, Result pattern. Tests first. |
| domain | `entities/session-message.ts` | `schemaRequest: PendingSchemaRequest \| null` on `SessionMessage` / `NewSessionMessage`. |
| domain | `ports/session-message-repository.ts` | `setSchemaRequest(messageId, request)`. |
| adapters | `db/schema/wayfinder.ts` | `schema_request` jsonb on `app_session_messages`. |
| adapters | `db/migrations/` (generated) | Additive, nullable, no default — `-- data-impact: preserved`. |
| adapters | `db/repositories/drizzle-session-message-repository.ts` | Map the new column both ways; implement `setSchemaRequest`. |
| application | `use-cases/session/submit-schema-definition.ts` (new) | Validate through the domain, persist, emit `session.schema_defined` audit. Tests first. |
| apps/web | `stream/mcp-turn-helpers.ts` | Detect the configured tool, persist the pending request, signal suspension. |
| apps/web | `stream/route.ts` | Honour the suspension signal — skip `executeTurn`. |
| apps/web | `server/routers/session.ts` | `submitSchemaDefinition` / `dismissSchemaRequest` mutations. |
| apps/web | `components/chat/schema-request-card.tsx` (new) | The in-feed card and field editor. |
| apps/web | `components/chat/message-feed.tsx` | Dispatch the card off `msg.schemaRequest`. |
| domain | `entities/flow-node.ts` | `schemaRequestToolName?: string` on `ConversationalNodeConfig`. |

## 5. Field vocabulary

Reuses the **extraction authoring vocabulary**, not `TemplateField`: the eight
types in `ExtractionFieldType` (text, number, currency, date, email, yesno,
select, multiselect). `section`, `group` and `signature` are not in that union,
so they are rejected by construction — and rejected explicitly, with a named
error, when they arrive from the model's tool arguments.

The card lifts the field-row pattern from `extraction-field-editor.tsx` rather
than mounting that component: it is an admin surface with a dialog-based
per-field config and a template-locked `derived` mode, neither of which belongs
in a chat card. The house `<select>` pattern (`extraction-field-editor.tsx:92`)
is copied as-is — there is no select primitive in `components/ui/`.

## 6. Database changes

One additive column:

```sql
ALTER TABLE "app_session_messages" ADD COLUMN "schema_request" jsonb;
```

Nullable with no default, so every existing row is valid unchanged.
Declares `-- data-impact: preserved`.

## 7. Implementation order (tests first)

1. Domain: `schema-request.ts` — validation, type rejection, duplicate keys, options/min-max rules.
2. Domain: `SessionMessage.schemaRequest` + repository port method.
3. Adapters: column, generated migration, repository mapping.
4. Application: `SubmitSchemaDefinition` — persist + audit.
5. Web: pre-pass detection and turn suspension.
6. Web: tRPC mutations.
7. Web: the card, and its dispatch in the feed.

## 8. Tests

- `schema-request.test.ts` (domain) — happy path, each rejection rule, duplicate keys.
- `resolve-schema-request.test.ts` (application) — persists, audits, restates the
  schema for the next turn, refuses an already-answered request.
- `schema-request-gate.test.ts` (web) — tool detection and pending-request construction.
- `schema-request-card-model.test.ts` (web) — the editor's row logic. The repo has
  no jsdom/component-testing stack, so the card's state lives in a `*-model.ts` and
  is tested there — the same split as `extraction-editor-model.ts`.
- **No e2e.** Per [`e2e-test-policy.md`](../../guides/e2e-test-policy.md) the behaviour
  is covered at the domain, application and web-module layers. It does not fall into
  any of the six groups.

## 9. Out of scope

- The verbatim tool-result channel (§5.1 of the source note) — its own ADR.
  Until it lands the submitted schema feeds the existing pipeline.
- Items 2, 3 and 4 of `JOHNS-PLAN.md`.
- Authoring UI for `schemaRequestToolName` in the flow editor — the field is
  read from node config; setting it from the canvas is a follow-up.

## 10. Risks

- Turn suspension has no precedent — this is the plan's named schedule risk (§7).
- A dismissed request must leave the session actionable, not a dead thread: the
  dismissal persists a system message telling the operator the step is still open.
