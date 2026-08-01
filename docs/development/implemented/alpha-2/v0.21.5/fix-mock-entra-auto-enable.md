# Bug fix — `restart.sh --with-mocks` silently enabled Entra ID

## Symptom

A fresh local install started with `./restart.sh --with-mocks` comes up with
**Microsoft Entra ID already switched on** in `/admin/settings → Authentication`,
with Tenant ID pre-filled as `mock-tenant`. Nobody enabled it.

The startup line printed by the same script claimed the opposite:

```
mock Entra at http://localhost:4001/entra — switch Entra ID on in /admin/settings to use it
```

Severity: **minor**. Local development only — no released deployment is
affected, and no real installation turns Entra on by itself unless its operator
sets the credentials. But local auth no longer matched a real install, and the
printed instruction was false.

## Reproduction

1. `./restart.sh --with-mocks` against an empty database.
2. Complete first-run setup and open `/admin/settings → Authentication → Edit`.
3. Expected: Microsoft Entra ID off, credentials blank. Actual: on, with Tenant
   ID `mock-tenant`.

## Root cause (verified)

Two correct behaviours combining into a wrong one.

**1. A complete set of `ENTRA_*` env vars enables Entra on its own.** This is
deliberate — ADR-025 §1, so env-only deployments keep the `auth_config` DB row
optional (`packages/adapters/src/config/runtime-config-defaults.ts`):

```ts
export const buildEnvAuthConfig = (env: EnvDefaults): AuthConfig => {
  const defaults = createDefaultAuthConfig();
  const entra = env.entra ?? defaults.entra;
  return {
    emailPasswordEnabled: defaults.emailPasswordEnabled,
    // Env-only deployments: enable Entra automatically when all three
    // credentials are present, so the DB row stays optional.
    entraEnabled: isEntraConfigured(entra),
    entra,
  };
};
```

`apps/web/src/lib/container.ts` only populates `envDefaults.entra` when all three
of `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` are non-empty,
and `getAuthConfig()` falls back to this whenever no `auth_config` row exists —
i.e. on every fresh install.

**2. `restart.sh --with-mocks` exported all three** (added in v0.21.4 alongside
the mock identity provider):

```sh
export ENTRA_TENANT_ID="${ENTRA_TENANT_ID:-mock-tenant}"
export ENTRA_CLIENT_ID="${ENTRA_CLIENT_ID:-mock-client}"
export ENTRA_CLIENT_SECRET="${ENTRA_CLIENT_SECRET:-mock-secret}"
```

So the mocks flag satisfied `isEntraConfigured` and Entra enabled itself. The
v0.21.4 change asserted that "enabling Entra remains an explicit admin action",
which was wrong for exactly this path.

A stock install is unaffected: `.env.example` ships the three keys blank, so
`envDefaults.entra` is `undefined` and `entraEnabled` resolves `false`.

## Decision

The auto-enable rule **stays as-is for real deployments** — an operator who sets
all three credentials wants Entra live, and removing that would break env-only
deployments that rely on it.

The mock is for giving a deployment something to test *against*, not for turning
the feature on. So the mocks path supplies the authority and nothing else.

## Fix

`restart.sh --with-mocks`:

- exports `ENTRA_AUTHORITY` only,
- prints the tenant / client / secret values for the operator to paste into
  `/admin/settings → Authentication`,
- and the flag's help text no longer claims credentials are exported.

A mocked install now starts with exactly the auth methods of any other install.

## Tests

`validate.sh` check 21 fails if `restart.sh` ever exports
`ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` or `ENTRA_CLIENT_SECRET` again.

No Playwright e2e test: the defect lives entirely in a developer shell script,
so there is no application surface to drive. The existing
`fix-entra-account-linking.spec.ts` still covers the mock end to end — it enables
Entra and fills the credentials through the admin UI, which is precisely the flow
this fix restores, and it needs no change because the e2e workflow never exported
the credentials.

Verified by hand:

- `bash -n restart.sh` clean; `./restart.sh --help` renders the full flag block.
- Replaying the mocks block exports `ENTRA_AUTHORITY` only, leaving the three
  credential vars unset.
- Check 21 was confirmed to fail when a credential export is reintroduced, and
  pass once removed.

## Implementation summary (v0.21.5)

- **Root cause:** `restart.sh --with-mocks` exported a complete `ENTRA_*`
  credential set, which `buildEnvAuthConfig` treats as "operator wants Entra on".
- **Fix applied:** mocks path exports `ENTRA_AUTHORITY` only and prints the
  credentials to paste; help text corrected.
- **Regression guard:** `validate.sh` check 21.
- **Unchanged by decision:** env-driven auto-enable for real deployments.
- **Version bump:** PATCH — `0.21.4` → `0.21.5`.
