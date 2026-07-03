# Implementation Summary — Admin Gate Override + Streamable-HTTP MCP + n8n under Flow Settings (v1.60.0)

**Version bump**: MINOR 1.59.0 → 1.60.0. No DB migration (reuses
`app_sessions.awaiting_confirmation_node_id`; `admin_mcp_servers.transport` is a
Drizzle text enum; the `audit_logs` table already exists).

Three changes, consolidated.

## 1. Admin override for the document-generation gate (audited)

A `generate_document` step whose pre-generation evaluation fails was a dead-end
(`advanceThreshold = Infinity`, no recourse). The block is code-enforced but its
pass/fail is LLM-determined, so a human could be stuck. Admins now get an explicit,
**audited** "Generate anyway" override; non-admins stay blocked (no new end-user
UI), matching the "power-user/admin via permissions" direction.

- `route.ts` (eval-fail): set `awaitingConfirmationNodeId` + persist the grade; a
  later passing turn clears the flag.
- `turn-helpers.ts`: `isGenerationGateOverride` predicate; `logGateOverride` writes
  a `document.generation_gate_override` **audit** entry (nodeId, guidance/criteria
  confidences, missingInformation) **and** a `warn` operational **event-log** entry.
  `confirmStep` gates the override to admins (non-admin Proceed is a no-op).
- UI: `confirm-step-card.tsx` override variant; `chats/[sessionId]/_content.tsx`
  shows the override card only when `isAdmin`.
- **No per-node authoring toggle** — the node-config UI is unchanged (per review
  feedback to keep it clean).

## 2. Native streamable-HTTP MCP transport (ADR-032 §1: remote HTTP/SSE)

`McpTransport` widened to `sse | streamable-http` (text enum, no migration); the
AI-SDK client branches to a `StreamableHTTPClientTransport` (new
`@modelcontextprotocol/sdk` dep); `RegisterMcpServer` accepts an optional transport.

## 3. n8n under 'Flow Settings'

Surfaced n8n integration under the admin 'Flow Settings' sub-menu (sidebar
"Workflows (n8n)" → deep-links to the n8n card via a `#n8n-integration` anchor),
completing Richard's UI-consolidation list. Kept as a deep-link rather than a
dedicated page to avoid extracting the connectivity-coupled card; can be promoted
to its own page later.

## Tests

- Unit: `turn-helpers.test.ts` — `isGenerationGateOverride` predicate + `logGateOverride`
  audit/event logging; transport selection + `RegisterMcpServer` default.
- **E2E**: `apps/web/e2e/enhance-generation-gate-override.spec.ts` — an admin gets the
  audited "Generate anyway" override on a gate-blocked document step.

`./validate.sh` — all checks passing.
