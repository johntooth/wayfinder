# Phase — Admin Override for the Document-Generation Gate (audited) + supporting changes

- **Status**: Implemented (v1.60.0)
- **Version**: MINOR 1.59.0 → 1.60.0. No DB migration.
- **Relates to**: ADR-026 (operator confirmation / Proceed), the pre-generation
  evaluation gate (`EvaluateStepReadiness`), ADR-020 (audit reuse), ADR-032 (MCP).

## 1. Goal

A `generate_document` step whose pre-generation evaluation fails was a dead-end:
the step held open with `advanceThreshold = Infinity` and there was no operator
recourse. The block is code-enforced but its pass/fail is LLM-determined. Give
**admins** an explicit, **audited** "Generate anyway" override — admin-gated (not a
per-node authoring toggle) to keep the node-config UI unchanged and to match the
"power-user/admin via permissions" direction.

## 2. What is built

**Admin gate override**
- `route.ts` (eval-fail): persist the grade + set `awaitingConfirmationNodeId`
  (recourse exists); clear on a later passing turn.
- `turn-helpers.ts`: `isGenerationGateOverride(node, session)`; `logGateOverride`
  writes a `document.generation_gate_override` audit entry (nodeId, guidance/criteria
  confidences, missingInformation) **and** a `warn` operational event-log entry;
  `confirmStep` restricts the override to admins.
- UI: `confirm-step-card.tsx` override variant; `chats/[sessionId]/_content.tsx`
  shows the override card only for admins.

**Supporting (consolidated into this release)**
- Native streamable-HTTP MCP transport (`McpTransport` widened; AI-SDK client
  branches to `StreamableHTTPClientTransport`; `@modelcontextprotocol/sdk` dep).
- n8n surfaced under the 'Flow Settings' admin sub-menu (sidebar "Workflows (n8n)"
  → `#n8n-integration` anchor).

## 3. Database changes

**None.**

## 4. Tests

- Unit: `isGenerationGateOverride` predicate; `logGateOverride` audit + event entries;
  transport selection; `RegisterMcpServer` transport default.
- E2E: `apps/web/e2e/enhance-generation-gate-override.spec.ts`.

## 5. Notes

- **Admin-gated by design**; non-admins never see the override (the route sets the
  awaiting flag regardless, but the card and `confirmStep` override both require admin).
- **Recourse by default** — every failed gate is admin-overridable; no dead-ends.
- **Audit completeness** — records who, which step, and the grade overridden.
