# Implementation Summary — Sign In with Amazon Cognito

- **Version**: 0.42.0 — **MINOR** (new sign-in method, no schema impact)
- **Date**: 2026-11-06
- **Phase doc**: [`cognito-sign-in.phase.md`](./cognito-sign-in.phase.md)
- **Decision record**: ADR-068 — Cognito sign-in links like Entra, by verified email

## What was built

A deployment can offer **Sign in with …** for an Amazon Cognito user pool by
setting four env vars. Linking follows the Entra rules: no account creation, a
first sign-in links by email, and a linked account becomes SSO-only. Unlike
Entra, the link happens only when the pool says the address is verified.
Cognito is deliberately left out of Better Auth's trusted providers, because a
trusted provider skips that check.

One trap is handled explicitly. Cognito's userinfo endpoint sends
`email_verified` as the string `"false"`, which is truthy. The profile mapper
accepts only `true` or `"true"`.

## Files created

| File | Purpose |
|---|---|
| `packages/adapters/src/auth/cognito-provider.ts` | `cognitoProviderFor` (fail closed), `cognitoOAuthConfig`, `isCognitoEmailVerified` |
| `packages/adapters/src/auth/__tests__/cognito-provider.test.ts` | 17 tests |
| `apps/web/src/lib/sso-sign-in-errors.ts` | Better Auth error code → wording, never echoing the code |
| `apps/web/src/lib/sso-sign-in-errors.test.ts` | 7 tests |
| `docs/development/adr/068-cognito-sign-in-links-like-entra.adr.md` | The linking decision and why Cognito isn't trusted |

## Files modified

- `packages/adapters/src/auth/better-auth.ts`: `cognito` option; generic-oauth plugin when set; comment on why it isn't trusted.
- `packages/adapters/src/auth/__tests__/better-auth.test.ts`: 3 tests.
- `packages/adapters/src/auth/entra-precedence.ts`: precedence covers Cognito.
- `packages/adapters/src/auth/__tests__/entra-precedence.test.ts`: 1 test.
- `packages/adapters/src/auth/index.ts`: export.
- `apps/web/src/lib/env.ts`: `COGNITO_ISSUER`, `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `COGNITO_DISPLAY_NAME`.
- `apps/web/src/lib/container-auth.ts`: `resolveCognitoEnv`; passes the provider to `createAuth`.
- `apps/web/src/lib/container.ts`: resolves it once; exposes `cognitoSignIn`.
- `apps/web/src/server/routers/settings-auth.ts`: `enabledAuthMethods.cognito`.
- `apps/web/src/app/(auth)/login/login-form.tsx`: button and error notice.
- `docs/guides/setup-aws.md`: §11, app client settings and behaviour.
- `.env.example`: the four variables.
- `VERSION`, `package.json`: 0.42.0.

## Migrations

None.

## Tests

- 28 new unit tests across the four files above.
- E2E: none. A spec needs an https OIDC issuer; the mocks are http and the
  resolver refuses http on purpose. See the phase doc §5.

## Known limitations

- Not exercised against a live user pool by this change's tests. The protocol
  steps (discovery, PKCE, id-token verification) are Better Auth's generic-oauth
  plugin, configured, not reimplemented.
- One provider, env-only. Admin-registered providers are ADR-034's phase.
- An install can't run on Cognito alone: the admin auth-methods card requires
  another method.
- The Cognito app client isn't created by `deploy/terraform`.

## Deviations

None from the phase doc.
