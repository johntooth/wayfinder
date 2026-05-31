# ADR-014 — Email Notification Transport (Nodemailer, SMTP + M365 OAuth2)

- **Status**: Proposed (Phase 6+; scoped by `email-notifications.prd.md`)
- **Date**: 2026-05-31

## Context

`email-notifications.prd.md` introduces Wayfinder's first outbound channel:
transactional email for two triggers (session complete, flow shared). The
codebase has **no** mailer, port, or template today, so we choose the transport
and its boundary now.

Constraints:

1. **Hexagonal boundary (ADR-001).** The domain and application layers must not
   import a mail library. A domain port describes "send an email"; only
   `packages/adapters` knows how.
2. **Microsoft 365 / Exchange Online is a target deployment.** Recipients and
   senders in the reference (Australian Government procurement) environment live
   in Exchange Online. Microsoft is **deprecating Basic Auth (SMTP AUTH)** for
   Exchange Online; the durable path is **OAuth2 / XOAUTH2** via an Azure AD app
   registration.
3. **Self-hosted relays and local dev** still need plain SMTP AUTH (and an
   unauthenticated local sink such as Mailpit for tests).
4. **Reliability without blocking.** Completing a session or sharing a flow must
   not fail or stall because an SMTP server is slow or down.

## Decision

### Library and port

Use **Nodemailer** as the transport, wrapped behind a domain port
`INotificationSender` in `packages/domain/src/ports/notification-sender.ts`:

```ts
export interface INotificationSender {
  send(message: EmailMessage): Promise<Result<true>>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}
```

The implementation, `SmtpNotificationSender`, lives in
`packages/adapters/src/notifications/smtp-notification-sender.ts`. Nodemailer is
a dependency of `@rbrasier/adapters` only. The port returns the Result pattern;
it never throws across the boundary.

**Subject and body composition stays in the application layer** as pure string
builders (template literals — no templating framework), so the
"application imports only domain + shared" rule holds. The adapter is a dumb
transport that does not know what a "session" or a "flow" is.

### Transport modes

`SmtpNotificationSender` selects its Nodemailer transport from configuration:

| Mode | Use | Nodemailer auth |
| ---- | --- | --------------- |
| `oauth2` | Microsoft 365 / Exchange Online | `auth: { type: 'OAuth2', ... }` (XOAUTH2) against `smtp.office365.com:587` |
| `smtp` | Self-hosted relay, generic provider | `auth: { user, pass }` with host/port/secure from config |
| `stream`/sink | Local dev & tests | Unauthenticated local SMTP (e.g. Mailpit) |

XOAUTH2 is a first-class mode from day one specifically so the M365 Basic-Auth
deprecation is **not** a future breaking change.

### Delivery model — outbox on `app_notification_log`

Delivery is decoupled from the triggering action:

1. The triggering use-case writes a `pending` row to `app_notification_log`
   **inside the action's own commit** (the outbox).
2. A best-effort send runs out of band; on success the row flips to `sent`, on
   failure to `failed` with the error captured.
3. A unique index on `(trigger, resource_id, recipient_email)` makes sends
   idempotent.
4. A future sweeper (reusing the `job_registry` pattern) retries
   `pending`/`failed` rows. Whether the sweeper ships in v1 is an open question
   in the PRD; the outbox row exists regardless so no event is lost.

A send attempt also writes a `notification.sent` / `notification.failed` event
to `core_audit_log`.

### Environment variables

| Var | Required when | Notes |
| --- | ------------- | ----- |
| `NOTIFICATIONS_ENABLED` | always | `false` disables sends (outbox rows still written or skipped — TBD at build). |
| `SMTP_TRANSPORT_MODE` | always | `oauth2` \| `smtp` \| `stream`. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `smtp`/`oauth2` | Host defaults to `smtp.office365.com:587` for `oauth2`. |
| `SMTP_USER` / `SMTP_PASS` | `smtp` | Basic SMTP AUTH. |
| `M365_TENANT_ID` / `M365_CLIENT_ID` / `M365_CLIENT_SECRET` | `oauth2` | Azure AD app registration for XOAUTH2. |
| `SMTP_FROM` | always | From address / sender mailbox. |

Credentials are environment-only — never persisted to `admin_system_settings`
or written to logs.

## Consequences

**Positive**

- One library, one port; transport mode is config, not code.
- M365 OAuth2 supported from day one — no later breaking migration off Basic
  Auth.
- The outbox guarantees a triggering action never fails because of email, and
  gives a natural audit/retry surface.
- Bodies composed in the application layer keep the adapter provider-agnostic;
  swapping Nodemailer for an HTTP API later is an adapter change only.

**Negative**

- The outbox + idempotency index is more than a fire-and-forget call — extra
  table and write per event. Justified by reliability and de-duplication.
- M365 OAuth2 requires an Azure AD app registration and tenant configuration
  outside the codebase; documented as a deployment prerequisite.

## Open questions

- **Sweeper in v1?** Outbox row + single inline attempt now, periodic retry
  sweeper as a fast follow — confirm at build (PRD §12).
- **M365 grant type** — client-credentials app permission vs. a dedicated
  service-mailbox grant; confirm with the target tenant.
- **`NOTIFICATIONS_ENABLED=false` semantics** — skip the outbox row entirely, or
  write it as `sent`-suppressed for auditability? Decide at build.
