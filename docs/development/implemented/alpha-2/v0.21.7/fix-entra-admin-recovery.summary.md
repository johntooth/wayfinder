# Implementation summary — admin recovery when Entra fails (v0.21.7)

## Root cause

Entra takes precedence over a password: `applyEntraPrecedence`
(`packages/adapters/src/auth/entra-precedence.ts:36`), wired as Better Auth's
`account.create.before` hook, deletes an account's `credential` row and revokes
its sessions the moment a Microsoft identity links. It makes no distinction
between an ordinary user and an administrator.

Nothing replaced that password out of band:

- `createFirstAdmin` refuses as soon as any administrator exists
  (`admin-account-creator.ts:53-60`), and the locked-out administrator's row
  still carries `is_admin: true`, so the bootstrap path is correctly closed.
- `seedAdmin` only promotes an existing user; it never creates a credential.
- `isAtLeastOneMethodEnabled` (`runtime-config.ts:207`) is satisfied by Entra
  alone, so an administrator can — reasonably — switch email/password off
  entirely once the organisation is on Entra.
- `/admin/settings`, the only place those settings can be changed, is behind the
  login that has stopped working.

Once every administrator has signed in through Entra at least once — the
expected steady state after adopting it — an expired client secret or a tenant
outage locks the deployment out permanently.

## What was deliberately *not* changed

The credential deletion stays exactly as it was. It is what makes
`accountLinking.requireLocalEmailVerified: false` (`better-auth.ts:148`) safe:
Wayfinder never verifies email addresses locally, so Better Auth's own gate
would reject every legitimate link, and deleting the password at link time is
what strips an attacker who pre-registered at the victim's address. Exempting
administrators would reinstate that hijack on the highest-value accounts.

The recovery added instead requires shell and database access to the deployment
— which a remote pre-registration attacker does not have — so the protection is
untouched.

## Fix applied

**`packages/domain/src/ports/admin-recovery.ts`** (new) — `IAdminRecovery`,
`RecoverAdminAccessInput`, `AdminRecoveryOutcome`.

**`packages/adapters/src/auth/admin-recovery.ts`** (new) —
`BetterAuthAdminRecovery`:

1. Normalises the address and looks the user up; `NOT_FOUND` if absent,
   `VALIDATION_FAILED` on an empty password.
2. Hashes with Better Auth's own hasher via `(await auth.$context).password.hash`.
   Verified in `better-auth@1.6.25`: `dist/context/create-context.mjs:181-183`
   defines it, `dist/api/routes/sign-in.mjs:293-310` verifies against the same
   pair, and `dist/api/routes/sign-up.mjs:236-241` fixes the row shape
   (`provider_id: "credential"`, `account_id` = the user's own id).
3. Deletes any stale credential row, inserts the restored one, then revokes the
   user's sessions.
4. Merges `emailPasswordEnabled: true` into the stored `AuthConfig` through the
   **encrypted** settings repository (`auth_config` is in
   `SENSITIVE_SETTING_KEYS`). An absent row is left absent — the effective
   config then comes from env, where the method is already on, and writing one
   would pin blank Entra credentials over the env values.
5. Writes an `admin.recovery.password_reset` entry to `core_audit_log`.

Credential first, config second: a config change that outlived a failed
credential write would leave the deployment offering a sign-in method nobody
could use.

**`packages/adapters/src/auth/better-auth.ts`** — `Auth` gains `$context`, the
minimal structural surface needed to reach the provider's hasher.

**`apps/api/src/cli/recover-admin.ts`** (new) + the `recover-admin` package
script — the operator entrypoint. `apps/api` already carries `tsx`, `dotenv`,
the database client and the encrypted settings repository. The password is read
from stdin by default so it stays out of shell history and the process list.
The audit logger is given the real `HttpSiemForwarder`, because a break-glass
credential reset is precisely the event a SIEM-integrated deployment wants.

```bash
printf %s 'new-password' | pnpm --filter @wayfinder/api recover-admin -- --email admin@example.com
./restart.sh
```

The restart is required and the command says so: `RuntimeConfigStore` caches
`AuthConfig` in-process for the lifetime of each instance
(`runtime-config-store.ts:282`) and only clears it through `invalidateAuth()`,
which is reachable from the admin mutation this recovery exists to work around.

### Scope held deliberately narrow

The command never touches `is_admin`. It restores a password for an account that
already exists and warns when that account is not an administrator. A tool that
could also grant administrator rights would be an escalation route rather than a
recovery one, and it is not needed: a locked-out administrator's row already
carries the flag.

## Regression test added

`packages/adapters/src/auth/__tests__/admin-recovery.test.ts` — 10 tests, written
before the implementation and failing against it. Covers the restored row's
shape, delete-before-insert ordering, session revocation, the
`emailPasswordEnabled` merge (and the no-op when it is already on), the audit
entry (asserting the password does not appear in it), case-insensitive matching,
the `wasAdmin` report, `NOT_FOUND` writing nothing, and the empty-password
rejection.

## e2e test added

`apps/web/e2e/fix-entra-admin-recovery.spec.ts` — drives the mock Entra identity
provider on `:4001`: registers a password user, promotes them to administrator
through `/admin/users`, enables Entra, signs in through Microsoft, confirms the
original password is now rejected, runs `recover-admin` via `spawnSync`, then
signs in with the new password and reaches `/admin/users`. Entra is switched
back off in `finally`. Fails on the unfixed code — the package script and the
module it runs do not exist there.

## Docs

- `docs/guides/recovering-admin-access.md` (new) — admin-facing runbook: when
  this happens and why, when it is *not* the right tool, the command, the
  mandatory restart, every error message, and the follow-up (change the recovery
  password, review the audit entry, keep a second route in).
- `docs/guides/setup-admin.md` — row added to **Common issues**.
- `README.md` — a **Locked out of admin** pointer.

## Version

PATCH — `0.21.6` → `0.21.7`. No schema change; `core_accounts` already had every
column the restored row needs.

## Verification

- `./validate.sh` — 21/21 pass.
- `packages/adapters` unit tests — 10/10 new tests pass.
- e2e typechecks clean but was **not executed here**: this sandbox has no
  database, no running app and no mocks server. It runs in CI.
