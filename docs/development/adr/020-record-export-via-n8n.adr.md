# ADR-020 — Record Export via n8n

- **Status**: Proposed
- **Date**: 2026-06-03
- **Relates to**: ADR-010 (external workflow integration), ADR-013 (auto-node
  structured data), Email Notifications ADR (outbox model), Record-Keeping PRD

## Context

A finished Wayfinder record must be pushed into an agency's external system of
record, which returns a system-assigned record id. We already have a signed,
asynchronous integration with n8n (auto-node → `POST
/v1/webhooks/n8n/:sessionId`). The question is whether record export warrants a
new transport or should reuse that path, and how to capture the returned id
durably without coupling export to the session's progress.

## Decision

### Reuse the n8n transport; do not invent a new one

Record export is an outbound write to an agency system — exactly what the n8n
auto-node pattern exists for (ADR-010 lists "SharePoint write, AusTender
publish" as the motivating cases). We reuse `INodeExecutor` / `N8nNodeExecutor`
(HMAC-signed request, `correlationId`, async result via the existing webhook).

A thin domain port expresses intent at the application layer:

```ts
export interface IRecordExporter {
  export(input: {
    sessionId: string;
    flowId: string;
    correlationId: string;
    payload: Record<string, unknown>;
  }): Promise<Result<{ accepted: true }>>;
}
```

The adapter delegates to the n8n executor. No new secret, route, or signature
scheme — `N8N_WEBHOOK_SECRET` and the existing endpoint are reused.

### Outbox model with callback-supplied record id

Mirroring the Email Notifications outbox: finalizing a record commits a
`pending` `app_session_records` row (idempotent on `(session_id, trigger,
node_id)`), then export runs out of band. The n8n callback is extended to carry
the external record id:

```
POST /v1/webhooks/n8n/:sessionId
Body: { correlationId?, nodeId, status, data, message?, externalRecordId? }
```

On a successful callback the row flips to `exported` and stores
`external_record_id`; failure marks `failed` with the error. Export is
**non-blocking** — failure never breaks the session, matching the rest of the
n8n integration's best-effort posture.

### Triggers

Export is fired on record finalization. The v1 trigger set is
`approval_granted` (from the Approvals feature) and `session_complete`. A
dedicated `record` node is deliberately deferred — finalization signals cover the
need without a new node type.

## Consequences

**Positive**

- Zero new transport surface or secrets; one integration to operate and audit.
- The external record id is captured against the session for traceability.
- Outbox + idempotency key prevent double-export on re-finalization.

**Negative**

- Adds an optional `externalRecordId` to the shared webhook contract (additive,
  backward compatible).
- Couples record-keeping to n8n availability; mitigated by the durable outbox
  and bounded retry.

## Open questions

- Large generated documents: inline (base64) vs a storage link in the payload —
  lean toward link to keep payloads small.
- Idempotency when a record is legitimately re-approved and must re-export —
  whether that is a new row or an update.
