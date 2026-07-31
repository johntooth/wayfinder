# Bug fix — Entra sign-in refuses to link to an existing email/password account

## Symptom

An installation that runs email + password authentication and later enables
Microsoft Entra ID cannot move its existing users onto Entra. The first Entra
sign-in for an address that already has a password account fails: the user is
redirected to the error URL with `error=account_not_linked` and no session is
issued.

The account is **not** duplicated — `core_users` still holds exactly one row for
that email — so the same-email-same-account invariant is intact. The user is
simply locked out of the second method, permanently, with no in-app remedy.

Severity: **minor**. It only affects installations that turn Entra on after
users already exist, and there is a workaround (sign in with a fresh address).
No data loss, no duplication.

## Reproduction

1. Start the stack with email + password enabled.
2. Register `person@example.com` at `/register`.
3. As an admin, enable Entra ID at `/admin/settings` with valid credentials.
4. Sign out, then choose "Sign in with Microsoft" and authenticate as
   `person@example.com` in the tenant.
5. Expected: the Microsoft account links to the existing user and a session is
   issued. Actual: redirect to the error URL with `error=account_not_linked`.

## Root cause (verified)

Verified by reading `better-auth@1.6.25` in `node_modules`, not from memory.

`handleOAuthUserInfo` (`better-auth/dist/oauth2/link-account.mjs`) gates
implicit linking on four conditions:

```js
if ((!isTrustedProvider && !userInfo.emailVerified)
 || (requireLocalEmailVerified && !dbUser.user.emailVerified)   // ← this one
 || accountLinking?.enabled === false
 || accountLinking?.disableImplicitLinking === true)
   return { error: "account not linked", data: null };
```

`requireLocalEmailVerified` resolves as
`accountLinking?.requireLocalEmailVerified ?? true` and is never set in
`createAuth`, so it is `true`.

The second condition therefore requires the **local** user row to already carry
`email_verified = true`. Nothing in Wayfinder ever writes that column as true:

- `packages/adapters/src/db/schema/core.ts` — `email_verified` defaults to `false`.
- `packages/adapters/src/auth/better-auth.ts` — `emailAndPassword` sets
  `requireEmailVerification: false`, and no `emailVerification` block or
  `sendVerificationEmail` is configured anywhere in the codebase.
- Better Auth's own credential sign-up (`dist/api/routes/sign-up.mjs`) inserts
  `emailVerified: false`.

So every password-registered user sits at `email_verified = false` and fails the
gate. Being listed in `trustedProviders` does not help: that only satisfies the
*first* condition. The existing config —

```ts
accountLinking: {
  enabled: true,
  trustedProviders: ["microsoft", "email-password"],
},
```

— is necessary but not sufficient.

### What the gate is actually protecting

`requireLocalEmailVerified` exists to stop an account-takeover: an attacker
pre-registers a password account at a victim's address, the victim later signs
in through the IdP, and the IdP identity is linked **into the attacker's row**,
handing the attacker access. Simply disabling the flag reopens that hole — and
public registration (`settings.ts`, `registrationEnabled`) makes pre-registration
a realistic path.

### Secondary defect — email is not consistently normalised

The match key is `core_users.email`. Better Auth lowercases on both sides of the
OAuth path (`sign-up.mjs` normalises on insert; `findOAuthUser` queries
`email.toLowerCase()`), but three app-owned paths compare verbatim:

- `packages/adapters/src/auth/admin-account-creator.ts` promotes the bootstrap
  admin with `eq(core_users.email, input.email)` **after** Better Auth stored the
  lowercased address. A first-admin email typed with any capital letter fails to
  promote and returns `INFRA_FAILURE`.
- `packages/adapters/src/repositories/drizzle-user-repository.ts` `findByEmail`
  matches exactly.
- `packages/adapters/src/auth/pki-cert-adapter.ts` feeds that method a
  certificate SAN email verbatim; a mixed-case SAN creates a second `core_users`
  row that a later Entra sign-in (always lowercased) can never match.

`core_users.email` is `text ... unique`, and Postgres unique constraints are
case-sensitive, so `Person@example.com` and `person@example.com` can coexist.

## Fix plan

### 1. Precedence, not a bypass

Product decision: **where an Entra identity exists it takes precedence**, and
there is deliberately no path for an Entra user to set a password.

- Set `accountLinking.requireLocalEmailVerified: false` explicitly.
- Add a `databaseHooks.account.create.after` hook: when a `microsoft` account row
  is created for a user, delete that user's `credential` account row and revoke
  that user's other sessions.

The second half is what makes the first half safe. The takeover the flag guards
against depends on the attacker retaining password access to the row the victim's
identity was linked into. Deleting the credential row and revoking live sessions
in the same flow removes exactly that. The attacker keeps nothing.

This also implements the precedence rule directly: after a first Entra sign-in
the account is Entra-only. Password sign-in for that user stops working because
the credential row is gone, not because of a special-case check on the sign-in
path.

### 2. Pin `better-auth` to `~1.6.25`

`requireLocalEmailVerified` is marked in `@better-auth/core`'s types as
*"deprecated — the option will be removed on the next minor; the gate will
become unconditional."* The current range is `^1.6.22`, so a routine
`pnpm install` could pull 1.7 and silently re-break linking. Pin to `~1.6.25`
and revisit deliberately on upgrade.

Follow-up for the eventual 1.7 upgrade: the durable replacement is to set
`email_verified = true` on the local row at the moment the credential row is
destroyed, so the gate passes on its own terms.

### 3. Normalise email at every app-owned boundary

Lowercase before comparison in `admin-account-creator.ts`,
`drizzle-user-repository.findByEmail`, and the PKI identity path.

Deliberately **not** in this fix: a `unique index on lower(email)`. That is the
real backstop but it is a migration, which is a MINOR bump, and this is a PATCH.
Recorded as follow-up.

### 4. Mock Entra for local development

Better Auth's Microsoft provider derives its endpoints from
`options.authority || "https://login.microsoftonline.com"`. Nothing in Wayfinder
passes `authority`, so there is no way to point Entra at anything local.

- Add an `ENTRA_AUTHORITY` env var (env-only, no admin UI field — an
  admin-editable outbound URL in the auth path is a surface this fix does not
  need). Sovereign-cloud support via the admin card is noted as future work.
- Add `mocks/entra/oidc.mjs` on path `/entra`, following the contract at the top
  of `mocks/server.mjs`: one port, one path per mock.
  - `GET /entra/:tenant/oauth2/v2.0/authorize` — HTML picker with seeded test
    identities plus a free-text email box; redirects back to `redirect_uri` with
    `code` and the original `state`.
  - `POST /entra/:tenant/oauth2/v2.0/token` — returns an `id_token` carrying
    `sub`, `name`, `email`, `tid` and `email_verified: true`. The provider's
    `getUserInfo` uses `decodeJwt` with no signature check on the authorization-code
    flow, so an unsigned token is sufficient; a JWKS endpoint is served anyway.
  - `GET /entra/:tenant/discovery/v2.0/keys` — JWKS.
- `restart.sh --with-mocks` exports `ENTRA_AUTHORITY` plus mock
  `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` fallbacks, and
  prints a hint that Entra still has to be switched on in `/admin/settings`
  (that toggle is DB state by design — ADR-025).

## Tests

- **Unit regression (fails before the fix):**
  `packages/adapters/src/auth/__tests__/better-auth.test.ts` asserts the
  constructed instance carries `requireLocalEmailVerified: false` and an
  `account.create.after` database hook, plus direct tests of the credential-teardown
  behaviour.
- **Unit:** email normalisation in the admin account creator, the user
  repository, and the PKI identity path.
- **E2E:** `apps/web/e2e/fix-entra-account-linking.spec.ts` — register with a
  password, enable Entra, sign in through the mock as the same address, assert a
  session is issued against the same user id and that the password no longer
  works. Written, not run locally; CI runs the suite.

## Implementation summary (v0.21.4)

**Root cause.** `better-auth@1.6.25` gates implicit account linking on
`requireLocalEmailVerified && !dbUser.user.emailVerified`. The flag defaults to
`true`; Wayfinder never sets `core_users.email_verified`, so every password
account failed the gate and the Entra callback returned `account not linked`.

**Fix applied.**

- `packages/adapters/src/auth/better-auth.ts` — set
  `accountLinking.requireLocalEmailVerified: false` and registered a
  `databaseHooks.account.create.after` hook.
- `packages/adapters/src/auth/entra-precedence.ts` (new) — `applyEntraPrecedence`
  deletes the user's `credential` account row and revokes their sessions when a
  `microsoft` account row is created. Reached from both `linkAccount` and
  `createOAuthUser`.

  **It must be a `create.before` hook.** The first attempt used `create.after`
  and failed e2e: Better Auth wraps each request in `runWithAdapter`, which
  collects after-hooks and flushes them when the request *ends* — past the point
  where the post-link session is issued — so the revocation deleted the session
  belonging to the sign-in that had just succeeded, and the user was bounced back
  to `/login`. The library's own doc comment on `queueAfterTransactionHook` says
  the hook "will execute immediately" outside a transaction, which is only true
  when no async-storage store exists at all; during an endpoint one always does.
  `create.before` is awaited inline, so the revocation lands strictly before the
  new session. Pinned by
  `packages/adapters/src/auth/__tests__/better-auth-hook-ordering.test.ts`, which
  observes the real ordering (`account.before → session.create → account.after`)
  through a memory-adapter Better Auth instance.
- Dropped `"email-password"` from `trustedProviders`. It was inert — the
  credential `providerId` is `"credential"`, and `trustedProviders` is only
  consulted for the OAuth provider being signed in with.
- Pinned `better-auth` to `~1.6.25` in `apps/web` and `packages/adapters`, and —
  the part that actually binds — narrowed the root `pnpm.overrides` entry from
  `>=1.6.22` to `>=1.6.22 <1.7.0`. That override supersedes every package.json
  range in the workspace, so without it the pin was decorative. The lower bound
  is preserved because it is a security floor. The `packages/adapters` **peer**
  range stays `^1.0.0`: narrowing it would change the published framework
  contract for downstream consumers. Noted as follow-up.
- `packages/domain/src/entities/user.ts` — added `normaliseEmail`, applied in
  `admin-account-creator.ts`, `drizzle-user-repository.ts` (`create`, `update`,
  `findByEmail`) and `pki-cert-adapter.ts`.
- `packages/adapters/src/auth/entra-user-info.ts` (new) — resolves the identity
  from the id token, installed as `getUserInfo` **only when `authority` is
  overridden**. Not in the original plan: the stock Microsoft provider fetches a
  profile photo from a hardcoded `graph.microsoft.com`, and `betterFetch` was
  measured to *throw* (not return an error) on an unreachable host, so sign-in
  would have failed on any offline or Graph-blocked machine. A custom authority
  is not Graph's tenant anyway.
- `ENTRA_AUTHORITY` added to `apps/web/src/lib/env.ts`, `.env.example` and the
  container wiring.
- `mocks/entra/oidc.mjs` (new) plus registration in `mocks/server.mjs`;
  `restart.sh --with-mocks` exports the mock `ENTRA_*` values;
  `.github/workflows/e2e.yml` starts the mocks server and sets
  `ENTRA_AUTHORITY` so the spec can run a real code flow in CI.

**Verification beyond the unit tests.** The mock was driven end to end through
Better Auth's *real* Microsoft provider (`createAuthorizationURL` →
picker → `validateAuthorizationCode` → `getUserInfo`): the authorization URL
resolves to the mock, `state` round-trips, a mixed-case `Person@Example.com`
comes back as `person@example.com`, and a replayed code is rejected with
`invalid_grant`.

**Regression test added.** `packages/adapters/src/auth/__tests__/entra-precedence.test.ts`
(5 cases, renders the generated SQL to assert the exact predicates) and three
cases in `better-auth.test.ts` covering the linking options and the hook. Both
fail on the unfixed code. `entra-user-info.test.ts` and
`packages/domain/src/entities/user.test.ts` cover the new helpers.

**E2E test added.** `apps/web/e2e/fix-entra-account-linking.spec.ts`.

**Version bump.** PATCH — `0.21.3` → `0.21.4`.

## Follow-up (not in this fix)

- `unique index on lower(email)` as the DB-level backstop — a migration, so MINOR.
- On the eventual `better-auth` 1.7 upgrade the linking gate becomes
  unconditional; replace the flag by setting `email_verified = true` on the local
  row at the moment the credential row is destroyed.
- Narrowing the `packages/adapters` peer range, and a sovereign-cloud authority
  field on the admin card.
