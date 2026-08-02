# ADR-042 — PKI Under Runtime Auth Config, and Per-Method Sign-In Verification

- **Status**: Proposed (scoped by `pki-admin-config.prd.md`)
- **Date**: 2026-08-01
- **Supersedes**: ADR-025 §5 ("PKI stays as-is")
- **Builds on**: ADR-025 (runtime auth config, lazy auth instance), ADR-041
  (first-run wizard, DB-first config)

## Context

ADR-025 moved Email + Password and Entra ID out of the `AUTH_METHOD` environment
variable and into runtime database config, and deferred PKI explicitly:

> §5 — The PKI / client-certificate path remains env-configured and outside the
> admin card this phase… Bringing PKI under the same card is future work.

That deferral is now the constraint. `AUTH_METHOD` still decides three unrelated
things at boot:

1. whether `container.ts` constructs `PkiCertAdapter` at all,
2. whether `/api/auth/cert` answers or 404s,
3. where `middleware.ts` sends an unauthenticated visitor (`/login` vs
   `/api/auth/cert`).

Because of (3), a PKI deployment never shows a login page, so PKI and password
sign-in cannot be offered side by side during a phased certificate rollout.
Because of (1) and (2), enabling PKI requires a redeploy — the barrier ADR-041
exists to remove.

A second gap surfaced while scoping this. The first-run wizard (ADR-041 §2)
requires a **live Test** before a required step counts as done — presence of
configuration is not enough, because storage fields have env defaults that make
an unconfigured install read as configured. That rule is applied to storage and
AI only. Authentication is rendered in the wizard but gated by nothing, so an
operator can finish setup with a sign-in method that is enabled and broken.

Constraints carried forward from ADR-025: hexagonal boundary (ADR-001), no
lockout, fail closed, reuse the existing runtime-config pattern.

## Decision

### 1. The switch moves to the database; the trust anchor does not

`AuthConfig` gains `pkiEnabled: boolean` and `pki: { sessionTtlHours: number }`,
persisted in the existing encrypted `auth_config` row. `PKI_TRUSTED_PROXY_IPS`
**stays in the environment and is never editable or readable from the
application.**

This split is the load-bearing decision of this ADR, and it is not symmetric
with how Entra was treated. ADR-025 put the Entra client secret in the database
because the established pattern is "DB overrides `.env`". That reasoning does
not transfer:

- The PKI trust model is *"`x-ssl-client-*` headers are believed only from these
  IPs."* The list **is** the authentication boundary.
- An admin who can edit it can add an attacker-controlled IP, then forge
  certificate headers from that host and sign in as any user, including an
  admin. That is privilege escalation from "can change settings" to "can
  impersonate anyone" — a path that does not exist while the list is env-only.
- Leaking Entra's client secret does not grant impersonation of an arbitrary
  user; the two values are not equivalent, so they do not get the same home.

The environment therefore holds the **precondition** and the database holds the
**switch**. The UI expresses exactly that: the PKI row is always listed, and is
disabled with subtext naming `PKI_TRUSTED_PROXY_IPS` until the environment
provides it. Never hidden — an operator who cannot see the option cannot
discover the prerequisite.

The disabled state is a UI affordance, not an authorisation check:
`setAuthConfig` rejects `pkiEnabled: true` server-side when the gate is
unsatisfied.

### 2. Middleware stops reading auth config

`middleware.ts` drops its `AUTH_METHOD` branch and always redirects
unauthenticated page requests to `/login`. The login page then renders "Sign in
with your certificate" when PKI is enabled, reading the flag from the existing
public `settings.enabledAuthMethods` tRPC query — the same way it already
decides whether to show the Microsoft button. (`/login` is a client component;
what matters is that it runs where config is reachable, which middleware is
not.) The unauthenticated first paint defaults `pki` to false, matching how
`entra` is already handled: the certificate button appears once the query
resolves rather than flashing on an install that does not offer it.

Next.js middleware runs in the Edge runtime, so it cannot query Postgres, and it
runs on every matched request, so a config read there would be undesirable even
if it were possible. The decision has to live somewhere that can read config;
`/login` is that place.

**Accepted cost:** existing PKI installs gain one click. Today they go straight
through to `/api/auth/cert`; afterwards they land on `/login` and choose. This
is a visible change for an operator who did not ask for one and must appear in
the release notes. It is the price of DB-driven config, and it buys the mixed
PKI + password deployment that is impossible today.

### 3. `AUTH_METHOD` degrades to a legacy fallback

`RuntimeConfigStore.getAuthConfig()` seeds `pkiEnabled` from `AUTH_METHOD`
naming PKI, and `pki.sessionTtlHours` from `PKI_SESSION_TTL_HOURS`, so an
existing deployment upgrades with no env change, no admin action and its
configured TTL intact. Beyond seeding those defaults, neither variable decides
anything.

"No longer decides anything" is enforced, not asserted. The `AuthMethod` union
in `better-auth.ts` loses its `pki` and `pki-and-email-password` arms, which
`createAuth` never reads and which only `AUTH_METHOD` could produce; the
environment gate reaches config resolution through a single `EnvDefaults.pki`
group, and every consumer downstream — router, PKI probe, lockout guard — reads
it back through one `RuntimeConfigStore.isPkiEnvConfigured()` accessor rather
than parsing `process.env` for itself. That group carries a **boolean**: the
trusted-proxy addresses never enter config resolution at all.

Where the two sources can still disagree — `AUTH_METHOD` naming PKI while the
stored row says disabled — boot logs a warning. A silent contradiction between
an environment variable and the database is harder to debug than a log line.

### 4. The lockout guard counts PKI only when usable

`isAtLeastOneMethodEnabled` is extended to count PKI, but only when its
environment gate is satisfied. The failure this prevents: an admin disables
email + Entra leaving PKI as the sole method, and a later deploy ships without
`PKI_TRUSTED_PROXY_IPS` — every method is now unusable and nobody can sign in to
repair it. An enabled-but-ungated PKI is therefore **not** a method for the
purposes of the guard.

### 5. Every enabled sign-in method gets a positive wizard test

The wizard's requirement rule (ADR-041 §2) extends to authentication: each
**enabled** method must report a successful test before setup can complete,
using the same `ConnectivityResult` / `WizardRequirement` machinery as storage
and AI. Disabled methods are not tested and do not gate.

Three new `ConnectivityTarget` values rather than one aggregate — an operator
needs to know *which* method failed, not that "auth" did:

| Target | What it actually verifies |
| ------ | ------------------------- |
| `auth-entra` | OIDC discovery document fetched from `{authority}/{tenantId}/v2.0/.well-known/openid-configuration`, then a client-credentials token request. Proves authority reachable, tenant real, client ID and secret valid. |
| `auth-pki` | `PKI_TRUSTED_PROXY_IPS` parses to ≥1 valid address, `pkiEnabled` is true, and the certificate route is mounted. |
| `auth-email-password` | The credential provider is enabled on the built auth instance, and at least one account carries a password. |

**The existing `entra` target is deliberately not reused.** It probes Microsoft
Graph `/users` and therefore needs the `User.Read.All` **application**
permission. That permission serves the people-directory feature — sign-in needs
none of it. An app registration configured correctly for sign-in only
(`openid`/`profile`/`email`) fails that probe while sign-in works perfectly.
Gating the wizard on it would block setup on a permission the login flow does
not use. The two probes answer different questions and stay separate.

**`auth-pki` must not overstate what it checked.** The application sits *behind*
the mTLS proxy and cannot originate a client-certificate handshake, so no live
end-to-end test is possible from here. Its success message says what was
verified — configuration, not a completed certificate exchange — rather than
implying certificate sign-in has been proven working. A green tick that means
less than the operator thinks is worse than no tick.

## Alternatives considered

- **Move `PKI_TRUSTED_PROXY_IPS` into the DB for consistency with Entra.**
  Rejected: it converts an admin-settings compromise into full user
  impersonation (see §1). Consistency is not worth a new escalation path.
- **Keep the middleware branch and read `AUTH_METHOD` alongside DB config.**
  Rejected: two sources of truth for one decision, and the env half still needs
  a redeploy, so the feature would not actually be achieved.
- **Enable Node runtime middleware (`experimental.nodeMiddleware`) to read the
  DB in middleware.** Rejected: an experimental flag plus a database read on
  every matched request, to preserve one click.
- **One aggregate `auth` connectivity target.** Rejected: it cannot say which
  method is broken, which is the only thing the operator needs to know.
- **Reuse the existing `entra` Graph probe for sign-in.** Rejected: it tests
  `User.Read.All`, a directory permission unrelated to sign-in (§5).
- **Skip the PKI test as "unsupported"** (the `resolveRequirement` state Bedrock
  uses). Rejected: the configuration checks in §5 are real and catch the common
  misconfiguration — an empty or malformed proxy list — so reporting "no test
  available" would throw away a genuine signal.

## Consequences

**Positive**

- PKI becomes an operator-controlled switch with no redeploy, matching every
  other runtime setting; the option is discoverable even when unusable.
- Mixed PKI + password deployments become possible for the first time.
- The environment keeps sole ownership of the authentication boundary.
- Setup can no longer complete with an enabled sign-in method that is broken.
- No schema change: additive fields on an existing encrypted JSON row.

**Negative**

- Existing PKI deployments gain a login-page click (§2). Release-note material.
- `AUTH_METHOD` may now contradict the DB (names PKI while the DB says off),
  mitigated by the boot warning in §3 rather than left silent.
- Three new probes to maintain, one of which (`auth-pki`) verifies configuration
  rather than end-to-end behaviour and must be described honestly wherever its
  result is surfaced.
- `PkiCertAdapter` no longer fails fast at construction on an empty proxy list;
  the error moves to a per-request `INFRA_FAILURE` Result — an existing code, so
  no `DomainErrorCode` is added for one call site, and it maps to a 500-class
  answer rather than blaming the caller. `/api/auth/cert` answers 403 on a
  not-**usable** configuration before the adapter is reached, so that Result is
  a backstop; both paths need tests, or the misconfiguration stops being loud.
- `isAtLeastOneMethodEnabled` takes the environment gate as a required second
  parameter. Every existing caller must be updated — deliberately, since a
  defaulted parameter would let a forgetful caller silently receive the
  fail-closed answer instead of a compile error, and that caller is the lockout
  bug this guard exists to prevent.
