# Implementation Summary — AI-Triggered Schema-Definition Form (v0.31.0)

- **Version**: 0.31.0 — **MINOR** (adds a column to `app_session_messages`)
- **Release line**: `alpha-3` (base branch `main`)
- **Phase doc**: [`ai-schema-definition-form.phase.md`](./ai-schema-definition-form.phase.md)
- **Source**: [`JOHNS-PLAN.md`](../../../../../JOHNS-PLAN.md) §1

## What was built

When the model calls the tool named by the step's `schemaRequestToolName`, the
turn stops before the structured reply streams. The operator gets an interactive
field editor in the message feed instead of prose. On submit the schema is
validated, persisted against the message, audited, and restated as a system
message so the next turn reads it from the transcript.

Both open decisions from `JOHNS-PLAN.md` §6 are implemented as decided:

- **D1 — tool-triggered card mid-turn.** The suspension point is the MCP tool
  pre-pass (ADR-032), which already runs before `executeTurn` streams. No new
  node type; the auto/scheduled park paths are untouched.
- **D2 — pending form state persisted to the session.** The request lives in a
  new `schema_request` jsonb column on the message row, so a reload restores the
  card rather than losing it.

## Files created

| Layer | File |
|---|---|
| domain | `entities/schema-request.ts` (+ test) |
| application | `use-cases/session/resolve-schema-request.ts` (+ test) |
| adapters | `drizzle/0045_damp_typhoid_mary.sql` |
| apps/web | `stream/schema-request-gate.ts` (+ test) |
| apps/web | `components/chat/schema-request-card.tsx` |
| apps/web | `components/chat/schema-request-card-model.ts` (+ test) |

## Files modified

- `domain/entities/session-message.ts` — `schemaRequest` on `SessionMessage` / `NewSessionMessage`
- `domain/entities/flow-node.ts` — `schemaRequestToolName` on `ConversationalNodeConfig`
- `domain/entities/index.ts`, `domain/ports/session-message-repository.ts` — export + `updateSchemaRequest`
- `adapters/db/schema/wayfinder.ts`, `adapters/repositories/drizzle-session-message-repository.ts`
- `apps/web` — `stream/mcp-turn-helpers.ts`, `stream/route.ts`, `server/routers/session.ts`,
  `lib/container.ts`, `components/chat/message-feed.tsx`, `chats/[sessionId]/_content.tsx`

## Migration

`0045_damp_typhoid_mary.sql` — `ALTER TABLE "app_session_messages" ADD COLUMN "schema_request" jsonb;`

Additive and nullable with no default, so existing rows are valid unchanged.
Declares `-- data-impact: preserved`. Generated with `pnpm db:generate`, never pushed.

## Design notes

- **The tool's result is discarded.** The operator's submission is the answer; the
  tool's return value would only paraphrase what the form collects properly.
- **Detection runs against this turn's calls only.** Matching `priorToolCalls` too
  would re-suspend the step on every subsequent turn.
- **The card replaces the message bubble** rather than rendering beneath it — the
  card already shows the model's prompt.
- **Template-only field types are refused by name.** `section`, `group` and
  `signature` are absent from the vocabulary and produce a specific error, not a
  generic unknown-type message.
- **Dismissal writes a system message** saying the step is still open, so the
  operator is never left with a dead thread.
- **Authorisation uses the send grant** (`resolveSessionAccess.canSend`), not
  `confirmStep`'s owner-only check — a collaborator driving the session must be
  able to answer. The session is resolved *from the message*, so a caller cannot
  pair a message id with a session they happen to have access to.

## Tests

906 web tests, all 6 packages green. No Playwright spec: per
`docs/guides/e2e-test-policy.md` the behaviour is covered at the domain,
application and web-module layers and falls into none of the six groups.

The repo has no jsdom/component-testing stack, so the card's editor state lives
in `schema-request-card-model.ts` and is tested there — the same split as the
existing `extraction-editor-model.ts`.

## Known limitations

- **The verbatim tool-result channel does not exist yet** (§5.1 of the source
  note; its own ADR). Until it lands the submitted schema feeds the existing
  pipeline. This is the caveat `JOHNS-PLAN.md` §0 raises about item 1, and it is
  unchanged by this phase.
- **`schemaRequestToolName` is not yet settable from the flow editor.** It is read
  from node config; a canvas control for it is a follow-up.
- The submitted schema is persisted on the message and restated in the
  transcript, but is not yet written into the flow version snapshot (D2's
  alternative location, noted in `JOHNS-PLAN.md` §1).
