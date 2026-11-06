# Phase — Sign In with Amazon Cognito

- **Status**: Implemented
- **Date**: 2026-11-06
- **Target version**: 0.42.0 — **MINOR** (new sign-in method, no schema impact)
- **Base branch**: `main` (new feature — see **Release Branching** in [`CLAUDE.md`](../../../../../CLAUDE.md))
- **Decision record**: [ADR-068](../../../adr/068-cognito-sign-in-links-like-entra.adr.md) — Cognito sign-in links like Entra, by verified email
- **Relates to**: ADR-025 (Entra and linking by email), ADR-034 (generic SAML/OIDC federation, still to be built)

## 1. Goal

Let a deployment whose users already have accounts in an Amazon Cognito user
pool offer **Sign in with …** for that pool, with the same account rules
operators already know from Microsoft Entra.

## 2. Change summary

### Business rules changing

- When `COGNITO_ISSUER`, `COGNITO_CLIENT_ID` and `COGNITO_CLIENT_SECRET` are all
  set and the issuer is `https`, the sign-in page offers Cognito. Otherwise it
  doesn't.
- When a Cognito sign-in's email matches no Wayfinder account, no account is
  created and the person is told to ask an administrator.
- When it matches an account and the pool reports the address as verified, the
  identity links to that account. If the address isn't verified, the link is
  refused.
- When a Cognito identity links, the account's password is removed and its
  existing sessions end, as for Entra. Accounts that never use Cognito keep
  their passwords.

### UI / visible behaviour

- Sign-in page: a **Sign in with {COGNITO_DISPLAY_NAME}** button (default
  "Amazon Cognito") below the other methods.
- Sign-in page: a red notice after a failed Cognito sign-in. There are three
  texts: no Wayfinder account, address not verified, and a fixed fallback.
  Nothing from the URL is shown.

### Database & migration impact

- None. Cognito identities are rows in `core_accounts` with
  `provider_id = 'cognito'`, which the table already holds.

### Risks

- Linking removes a password, so a user who links can't fall back to it. An
  admin password reset restores one. This is the same trade-off Entra makes.
- A misconfigured pool that marks unverified addresses as verified would let
  them link. The pool's own verification settings are the control.

### Out of scope

- Admin-configurable or multiple providers (ADR-034).
- A Cognito-only install: the admin auth-methods card still requires
  email/password, Entra or certificates.
- Creating the Cognito app client from `deploy/terraform`. That's a follow-up
  once both changes are in.
- An e2e spec (§5).

## 3. What is built

| Area | Change |
|---|---|
| `packages/adapters` `auth/cognito-provider.ts` | Env resolver (fail closed), generic-oauth config, and strict `email_verified` reading |
| `packages/adapters` `auth/better-auth.ts` | Registers the generic-oauth plugin when configured; Cognito deliberately not in `trustedProviders` |
| `packages/adapters` `auth/entra-precedence.ts` | Applies to Cognito as well as Microsoft |
| `apps/web` `lib/env.ts`, `lib/container-auth.ts`, `lib/container.ts` | The four env vars, resolved once at boot |
| `apps/web` `server/routers/settings-auth.ts` | `enabledAuthMethods.cognito`: `{ displayName }` or `null` |
| `apps/web` `app/(auth)/login/login-form.tsx`, `lib/sso-sign-in-errors.ts` | Button, error notice and its wording |
| `docs/guides/setup-aws.md`, `.env.example` | App client settings, the variables, and how linking behaves |

## 4. Implementation order (tests first)

1. `cognito-provider.test.ts`, then `cognito-provider.ts`.
2. `entra-precedence.test.ts` (Cognito case) and the `createAuth` Cognito tests,
   then the precedence set and plugin registration.
3. `sso-sign-in-errors.test.ts`, then the messages.
4. Env, container and router wiring; then the login form.
5. Guide and `.env.example`.

## 5. Build details

- **Architecture**: complies with ADR-001. Better Auth stays in
  `packages/adapters`; the app reads env and renders.
- **Unit tests**: 2 files new (`cognito-provider.test.ts`,
  `sso-sign-in-errors.test.ts`), 2 amended (`better-auth.test.ts`,
  `entra-precedence.test.ts`), each written before its implementation.
- **E2E**: none. Sign-in is an `e2e-test-policy.md` group (auth session
  lifecycle), but a spec needs an https OIDC issuer. The mocks server is http,
  and the resolver refuses a non-https issuer on purpose. The linking rules are
  covered at the adapter layer. A TLS-fronted OIDC mock would let a spec
  exercise the full redirect.
- **Version**: MINOR → 0.42.0, branch `feature/cognito-sign-in/claude-johntooth`, base and PR target `main`.
