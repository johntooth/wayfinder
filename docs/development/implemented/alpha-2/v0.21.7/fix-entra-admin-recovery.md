# Bug fix — no admin recovery when Entra fails

- **Severity**: Blocker
- **Base branch**: `release/alpha-2`
- **Affects**: `/login` and every page behind it, for every deployment that has
  enabled Entra ID

## Symptom

An administrator signs in with Microsoft Entra ID. Their email/password
credential is destroyed by that sign-in. If Entra later stops working — an
expired client secret, a tenant outage, a rotated redirect URI, the app
registration being removed — nobody can sign in, and there is no way back in.
The administration UI that could turn email/password back on is itself behind
the broken login.

## Reproduction

1. As an admin, open `/admin/settings` → General → Authentication, enable
   Entra ID and save valid tenant/client/secret values.
2. Sign out. Sign in again with **Sign in with Microsoft**.
3. Sign out. Try the original email and password on `/login` — it is rejected.
   (This much is intended; step 4 is the bug.)
4. Break Entra: change the stored client secret to a wrong value, or take the
   identity provider offline.
5. Try to sign in by any method. Microsoft fails at the provider; email and
   password fails because the credential row no longer exists. There is no
   third option, and no supported way to create one.

The lockout is total once every administrator has signed in through Entra at
least once, which is the expected steady state for a deployment that adopted
Entra.

## Root cause (verified)

Three behaviours combine. Each is individually deliberate; together they leave
no recovery path.

### 1. Linking an Entra identity deletes the password

`packages/adapters/src/auth/entra-precedence.ts:36`

```ts
export const applyEntraPrecedence = async (database, account) => {
  if (account.providerId !== ENTRA_PROVIDER_ID) return;
  await database.delete(core_accounts).where(and(
    eq(core_accounts.user_id, account.userId),
    eq(core_accounts.provider_id, CREDENTIAL_PROVIDER_ID),
  ));
  await database.delete(core_sessions).where(eq(core_sessions.user_id, account.userId));
};
```

Registered at `packages/adapters/src/auth/better-auth.ts:173` as
`databaseHooks.account.create.before`. It makes no distinction between an
ordinary user and an administrator.

**This deletion is load-bearing and must stay.** It is what makes
`accountLinking.requireLocalEmailVerified: false`
(`packages/adapters/src/auth/better-auth.ts:148`) safe. Wayfinder never verifies
email addresses locally — no verification sender is configured — so Better
Auth's own gate would reject every legitimate link. The gate exists to stop an
attacker who pre-registers a password account at a victim's address from
retaining access once the victim's Entra identity links into that row. Deleting
the password and revoking the sessions at link time strips the attacker of
exactly what the gate protected.

Exempting administrators from the deletion would reinstate that hijack on the
highest-value accounts in the system, so it is not the fix.

### 2. Nothing can create a replacement administrator

`packages/adapters/src/auth/admin-account-creator.ts:53-60` — `createFirstAdmin`
returns `CONFLICT` as soon as any row in `core_users` has `is_admin = true`. The
locked-out administrator still *is* an administrator; the row is intact and the
`is_admin` flag is still set. The bootstrap path is therefore closed, correctly,
and offers nothing here.

`seedAdmin` (`packages/adapters/src/auth/seed-admin.ts:8`) only promotes an
existing user to admin. It never creates a credential, so it cannot restore
sign-in either.

### 3. Email/password can be switched off entirely

`packages/domain/src/entities/runtime-config.ts:207`

```ts
export const isAtLeastOneMethodEnabled = (config: AuthConfig): boolean =>
  config.emailPasswordEnabled || config.entraEnabled;
```

The invariant is "at least one method", not "at least one method that works".
An administrator who has moved the organisation onto Entra will reasonably turn
email/password off. Restoring a credential row is then still not enough:
`emailAndPassword.enabled` is false in the Better Auth instance
(`better-auth.ts:161`), so sign-in never reaches the credential.

### 4. The auth config is cached in-process with no expiry

`packages/adapters/src/config/runtime-config-store.ts:282` caches `AuthConfig`
on first read and only clears it in `invalidateAuth()`
(`runtime-config-store.ts:419`), which is called from the `setAuthConfig` tRPC
mutation. A repair written straight to the database by an operator is invisible
to an already-running process. Any recovery has to say so.

## Fix plan

Keep the link-time deletion exactly as it is, and add the out-of-band recovery
that is currently missing: a break-glass command run by whoever operates the
deployment, which requires shell and database access — something the
pre-registration attacker of §1 does not have. This restores recovery without
weakening the protection.

### `packages/adapters/src/auth/admin-recovery.ts` (new)

`recoverAdminAccess(dependencies, input): Promise<Result<AdminRecoveryOutcome>>`

1. Normalise the email (`normaliseEmail`), look the user up in `core_users`.
   `NOT_FOUND` if there is no such user.
2. Hash the new password with Better Auth's own hasher, reached through
   `(await auth.$context).password.hash`. Verified in
   `node_modules/better-auth@1.6.25`: `dist/context/create-context.mjs:181-183`
   defines `password.hash`, and `dist/api/routes/sign-in.mjs:293-310` verifies
   the stored hash with the matching `password.verify`. Using the library's
   hasher is what guarantees the restored row is in the format sign-in expects.
3. Upsert the `credential` row for that user —
   `{ provider_id: "credential", account_id: <userId>, password: <hash> }`,
   matching what sign-up writes (`dist/api/routes/sign-up.mjs:236-241`).
4. Delete the user's sessions, so no stale session survives the reset.
5. Merge `emailPasswordEnabled: true` into the stored `AuthConfig` and write it
   through the **encrypted** settings repository — `auth_config` is in
   `SENSITIVE_SETTING_KEYS` (`runtime-config.ts:381`), so writing it raw would
   corrupt it.
6. Write a `core_audit_log` entry (`IAuditLogger`). A break-glass credential
   reset must leave a trace; the log is append-only and tamper-evident
   (ADR-033).
7. Report whether the target user is an administrator, and whether
   email/password had to be re-enabled, so the CLI can print it.

**Out of scope by design:** the command never sets `is_admin`. Granting
administrator rights is not recovery, and a tool that can do it is a
privilege-escalation tool. A locked-out administrator's row already carries
`is_admin: true`; restoring their password fully restores their access. If no
administrator exists at all, `createFirstAdmin` already covers that case.

### `apps/api/src/cli/recover-admin.ts` (new)

Thin entrypoint: parse `--email` and `--password`, build the database client,
the encrypted settings repository, the audit logger and a Better Auth instance,
call `recoverAdminAccess`, print the outcome, exit non-zero on error. `apps/api`
already carries `tsx`, `dotenv` and this wiring; `apps/web` carries none of it.

Exposed as `pnpm --filter @wayfinder/api recover-admin -- --email … --password …`.

The output must tell the operator to restart the application, because of §4.

### Tests

- **Regression (unit)** — `admin-recovery.test.ts`, written first and failing
  before the fix: a user whose credential row has been deleted by
  `applyEntraPrecedence` gets a usable credential row back, sessions cleared,
  `emailPasswordEnabled` forced true, an audit entry written, and `NOT_FOUND`
  for an unknown address.
- **e2e** — `apps/web/e2e/fix-entra-admin-recovery.spec.ts`, modelled on
  `fix-entra-account-linking.spec.ts`, driving the mock Entra provider on
  `:4001`: register a password user, sign in through Entra, confirm the password
  is dead, run the recovery command, confirm the password works again.

## Version

PATCH — `0.21.6` → `0.21.7`. No schema change; `core_accounts` already has
every column the restored row needs.
