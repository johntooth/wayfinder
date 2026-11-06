# ADR-068 — Cognito Sign-In Links Like Entra, by Verified Email

- **Status**: Proposed (scoped by `cognito-sign-in.phase.md`)
- **Date**: 2026-11-06
- **Builds on**: ADR-025 (configurable auth methods and Entra; linking by
  email and Entra taking precedence over a password)
- **Relates to**: ADR-034 and `federated-sso-saml-oidc.phase.md` (generic,
  admin-registered SAML/OIDC providers), which this doesn't replace

## Context

Some deployments sit beside services that already sign their users in through
an Amazon Cognito user pool. Their users want one identity, not a second
password for Wayfinder.

Wayfinder already has one email-linking provider, Entra (ADR-025). Its rules
are tested and documented:

- A first Entra sign-in links to the existing account with the same email.
- Once linked, the account is Entra-only: `applyEntraPrecedence` removes the
  password and ends existing sessions. That's what makes
  `requireLocalEmailVerified: false` safe. A password someone registered at the
  victim's address doesn't survive the victim's first SSO sign-in.

Entra is a **trusted** provider in Better Auth, so Better Auth links without
checking the provider's verified-email flag. That's acceptable for an Entra
tenant, whose addresses come from its directory. A Cognito user pool is
different: depending on its configuration, users can sign up with, or change to,
an address they haven't verified. Trusting Cognito the same way would let an
unverified address link to someone else's Wayfinder account.

The planned federated-SSO phase (ADR-034) covers arbitrary admin-registered
providers. It's a larger piece of work, and it needs an admin registry and a
library decision first.

## Decision

### 1. One Cognito provider, configured by environment only.

`COGNITO_ISSUER`, `COGNITO_CLIENT_ID` and `COGNITO_CLIENT_SECRET` turn it on,
and `COGNITO_DISPLAY_NAME` labels the button. It's env-only for the same reason
as `ENTRA_AUTHORITY`: sign-in links accounts by email, so repointing the issuer
must take a deployment change. Better Auth's generic-oauth plugin does the
protocol work: discovery, PKCE, and id-token verification against the pool's
JWKS (signature, issuer, audience, nonce). The resolver fails closed: any
missing setting, or an issuer that isn't `https`, offers nothing.

### 2. It links exactly as Entra does.

- **No account creation.** Sign-up is off for the provider. An admin creates
  the account; someone with no account is told to ask one.
- **Link by email on first sign-in.**
- **Cognito takes precedence over the password.** `applyEntraPrecedence` covers
  both providers: on link, the password is removed and sessions end.

### 3. Unlike Entra, it isn't trusted, so the address must be verified.

Cognito isn't in `trustedProviders`. Better Auth then links only when the
provider reports the address as verified. Cognito's id token carries
`email_verified` as a boolean, but its userinfo endpoint sends the string
`"true"` or `"false"`. A `mapProfileToUser` reads only `true` or `"true"` as
verified, so `"false"` can't pass as truthy.

### 4. It's a step towards ADR-034, not a substitute.

Nothing here builds the admin registry ADR-034 plans. When that lands, this
provider can become one registered entry, keeping the same linking rules.

## Consequences

- A deployment with a Cognito pool can offer it with four env vars and an app
  client.
- Once someone links Cognito, they can't sign in with their password, the same
  trade-off Entra already makes. An admin password reset gives the account a
  password again, as it does for Entra.
- `applyEntraPrecedence` now covers more than Entra. Its name is kept to avoid
  churn; its doc comment says so.
- An install can't yet run on Cognito alone. The admin auth-methods card still
  requires email/password, Entra or certificates, because Cognito isn't in the
  runtime auth config.

## Alternatives considered

- **Trust Cognito, as Entra is trusted.** Rejected: it skips the verified-email
  check, and a pool can hold unverified addresses.
- **Keep the password after linking.** Rejected: anyone can self-register while
  registration is open, so a password registered at the victim's address in
  advance would survive the link. Entra precedence exists to stop exactly that.
- **Explicit linking only (sign in with the password, then link from
  Settings).** Safe and keeps passwords, but adds a step for every user and a new
  settings surface. Not chosen, to match the Entra behaviour operators already
  know.
- **Wait for ADR-034.** It would cover this, but it needs an admin registry and
  a SAML library decision first.
