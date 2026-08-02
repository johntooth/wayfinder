# Implementation summary — PKI under the admin Authentication card (v0.23.0)

## What shipped

PKI / client-certificate sign-in is now an operator switch in
`/admin/settings` → Authentication and in the first-run wizard, applying on the
next request with no redeploy. `PKI_TRUSTED_PROXY_IPS` deliberately did **not**
move: the environment holds the precondition, the database holds the switch
(ADR-042 §1).

Alongside it, the wizard's "a live Test must pass" rule (ADR-041 §2) now reaches
authentication. Every **enabled** sign-in method renders its own requirement and
must report a passing test before setup can finish; disabled methods are neither
tested nor gate, which is the escape hatch when a probe fails transiently.

## Version

**MINOR → 0.23.0.** New configuration surface and UI. No DDL: `auth_config` is a
JSON value in the existing `admin_system_settings` key/value table, already in
`SENSITIVE_SETTING_KEYS` and so encrypted at rest, and the new fields are
additive. **No migration was generated or run.**

## Files created

| File | Why |
| ---- | --- |
| `packages/adapters/src/auth/credential-accounts.ts` | Counts accounts carrying a password, for the email + password probe. Lives in adapters because `apps/*` may not import the ORM. |
| `apps/web/src/lib/container-auth.ts` | PKI env resolution, the legacy-`AUTH_METHOD` boot warning, and `AuthMethod` selection — extracted to keep `container.ts` under the 800-line ceiling. |
| `apps/web/src/server/routers/settings-auth.ts` | The auth-config input schema and `mergeAuthConfig`, extracted for the same reason. |
| `apps/web/e2e/enhance-pki-admin-config.spec.ts` | E2E cover (below). |

## Files modified

**Domain**
- `entities/runtime-config.ts` — `AuthConfig` gains `pkiEnabled` and
  `pki.sessionTtlHours`; new `isPkiUsable(config, envHasTrustedProxies)`;
  `isAtLeastOneMethodEnabled` takes the environment gate as a **required**
  second parameter, so a caller that forgets it is a compile error rather than
  a quiet fail-closed answer.
- `entities/connectivity.ts` — `auth-entra`, `auth-pki`, `auth-email-password`.
  The existing `entra` (Graph `User.Read.All`) target is untouched.

**Adapters**
- `config/runtime-config-defaults.ts` — `EnvDefaults.pki`, the single point at
  which the PKI environment enters config resolution. It carries **booleans and
  a number, never the addresses**. `buildEnvAuthConfig` seeds `pkiEnabled` from
  `AUTH_METHOD` and `pki.sessionTtlHours` from `PKI_SESSION_TTL_HOURS`;
  `parseAuthConfig` defaults both for rows written before this phase.
- `config/runtime-config-store.ts` — `isPkiEnvConfigured()`, the one accessor
  every consumer reads the gate through; `redactAuth` extended.
- `auth/pki-cert-adapter.ts` — constructor no longer throws on an empty proxy
  list; the session TTL is resolved per request from the store; an ungated or
  disabled PKI returns a Result rather than minting a session.
- `auth/better-auth.ts` — the `pki` and `pki-and-email-password` arms of
  `AuthMethod` are gone. `createAuth` never read them and only `AUTH_METHOD`
  could produce them.
- `health/connectivity-probes.ts`, `health/composite-connectivity-tester.ts` —
  the three sign-in probes and their routing.

**Web**
- `lib/container.ts` — `PkiCertAdapter` is built unconditionally; the connectivity
  tester gains the credential-account probe and the Entra authority.
- `middleware.ts` — the `AUTH_METHOD` branch is gone; unauthenticated page
  requests always go to `/login`, carrying the requested path so the deep link
  survives the extra click.
- `app/api/auth/cert/route.ts` — 403 when PKI is not **usable** (disabled *or*
  env-ungated), checked before the adapter; `INFRA_FAILURE` maps to 500 rather
  than falling into the caller-blaming 400.
- `app/(auth)/login/page.tsx` — "Sign in with your certificate" as a plain
  navigation, so the proxy can attach `x-ssl-client-*` to the browser's own request.
- `server/routers/settings.ts` — `pki.envConfigured` (boolean only),
  `enabledAuthMethods.pki`, server-side rejection of an ungated enable, and
  per-method enabled flags on `getSetupStatus`.
- `components/settings/auth-methods-card.tsx` — the three-state PKI row and a
  Test button per enabled method; takes a `connectivity` controller, passed by
  both the settings page and the wizard.
- `components/onboarding/setup-wizard.tsx` — a `WizardRequirement` per enabled
  method, folded into `requiredReady`.

## Decisions taken during the build

- **`INFRA_FAILURE`, not a new `CONFIGURATION_ERROR`.** The phase doc named a
  code that does not exist in `DomainErrorCode`. Reusing `INFRA_FAILURE` keeps
  the union unchanged and maps to a 500-class answer, which is honest: an
  enabled-but-ungated PKI is a deployment fault, not caller input.
- **Invalid entries are dropped when parsing `PKI_TRUSTED_PROXY_IPS`.**
  `hasTrustedProxies` therefore means "at least one real address", so a stray
  `PKI_TRUSTED_PROXY_IPS=,` cannot read as a configured trust anchor.
- **Adapter-level defence in depth.** The route owns the 403, but
  `authenticate()` also refuses when PKI is disabled. It is the last line before
  a session is minted, and the route is not guaranteed to stay its only caller.

## Known limitations

- **`auth-pki` verifies configuration, not sign-in.** The app sits behind the
  mTLS proxy and cannot originate a certificate handshake. Its success message
  says what was checked; a green tick that means more than it verified would be
  worse than none.
- **"Cert route mounted" is no longer checked.** The phase listed it among
  `auth-pki`'s checks, but the route is a static file and the adapter is now
  built unconditionally, so it is a constant rather than a condition. Encoding a
  constant as a check would be dead weight; the two real checks (switch on,
  gate satisfied) are what the probe asserts.
- **`AUTH_METHOD` still exists in `env.ts` and `.env.example`.** It seeds
  `pkiEnabled` on first read and decides nothing else. Boot logs a warning when
  it names PKI while the stored config has it off.
- **Existing PKI deployments gain one click** — release-note material, see below.

## Behaviour change to call out in the release notes

A PKI-mode install used to bounce unauthenticated users straight to
`/api/auth/cert`; a login page was never seen. They now land on `/login` and
click "Sign in with your certificate". This is the price of DB-driven config —
middleware runs in the Edge runtime and cannot read the database — and it buys
the mixed PKI + password deployment that was impossible before.

## Test cover

**Unit** — 28 domain cases (PKI fields, `isPkiUsable`, and the lockout guard
including the enabled-but-ungated case); 8 store cases (seeding from
`AUTH_METHOD` and `PKI_SESSION_TTL_HOURS`, the pre-existing-row default, a
stored row overriding the env seed, the gate as a boolean); 5 adapter cases
(non-throwing construction, `INFRA_FAILURE` with no session minted, refusal when
disabled, per-request TTL); 18 probe cases including one per probe asserting no
secret material reaches `message`; router cases for the merge and the PKI
passthrough; 4 cert-route cases (403 disabled, 403 ungated, 500 on
misconfiguration, 401 untrusted).

**E2E — `apps/web/e2e/enhance-pki-admin-config.spec.ts`** (project `chromium`;
each test asserts the branch matching the app it is pointed at, so the
greyed-out state is covered by the default run rather than skipped):

1. The PKI row is listed in both states — greyed out with `PKI_TRUSTED_PROXY_IPS`
   named when the environment is absent, live when it is present.
2. `/api/auth/cert` answers from config, not container wiring: 403 when not
   usable, 401 when usable but the caller is not a trusted proxy.
3. `setAuthConfig` refuses `pkiEnabled: true` when the gate is unsatisfied,
   driven as a crafted client would rather than through the disabled checkbox.
4. `getAuthConfig` never returns an address — only `envConfigured`.
5. `/login` shows the certificate control exactly when PKI is usable, as a link
   to `/api/auth/cert?redirect=…`.
6. An unauthenticated visitor always reaches `/login`, with the requested path
   preserved.
7. The wizard renders a requirement per enabled method, none for disabled ones,
   blocks Continue until tested, and resolves to an explicit `ok`/`failed`
   rather than the "unsupported" state that would silently count as satisfied.

`apps/web/e2e/enhance-mock-pki-login.spec.ts` was updated: its skip guard keyed
on the old 404, which this phase replaced with 403.

**Not run locally.** The E2E suite runs in CI on the pull request, against a
full stack.

## Related work in flight

`claude/entra-admin-recovery-36vdf4` (v0.21.7) adds a break-glass
`recover-admin` CLI. It complements the §5 lockout guard — the guard prevents
locking yourself out through the UI, the CLI is the way back in when something
else does. The branches overlap only in `better-auth.ts` (different hunks) and
the version line, where this MINOR supersedes that PATCH.
