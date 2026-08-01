# PRD — PKI Client-Certificate Auth Under the Admin Card

- **Status**: Draft
- **Date**: 2026-08-01
- **Author**: richy.brasier
- **Target version**: 0.22.0 (bump: MINOR — new runtime settings and UI, no schema or breaking change)
- **Supersedes**: `entra-login-and-auth-methods.prd.md` §4 (PKI as a non-goal)
  and §11 ("Bringing PKI … under the same admin card"). Those deferred this work
  deliberately; this PRD picks it up.

## 1. Problem

PKI / client-certificate sign-in is the only authentication method Wayfinder
cannot configure from the application. Email + Password and Microsoft Entra ID
both moved to runtime database config in v1.45.0 (ADR-025); PKI was explicitly
left behind and is still selected by the `AUTH_METHOD` environment variable at
boot.

That single variable decides three unrelated things at once: whether
`PkiCertAdapter` is constructed, whether `/api/auth/cert` answers at all, and
where `middleware.ts` sends an unauthenticated visitor. Three consequences
follow, and each one blocks a real deployment:

1. **No admin can turn PKI on.** It needs an environment change and a redeploy —
   exactly the barrier ADR-041's DB-first configuration exists to remove, and
   exactly the thing Wayfinder's non-technical operator persona cannot do.
2. **PKI and password sign-in cannot coexist in the UI.** In a PKI mode,
   middleware bounces every unauthenticated visitor straight to
   `/api/auth/cert`; nobody ever reaches a login page. An organisation rolling
   certificates out gradually has no way to offer both.
3. **The option is invisible.** An operator looking at
   `/admin/settings` → Authentication sees Email + Password and Entra ID, and no
   indication that certificate sign-in exists at all, let alone what it needs.

A fourth problem is adjacent and worth fixing in the same pass. ADR-041 §2
established that the first-run wizard requires a **live Test** before a step
counts as done — configuration alone is not enough, because defaults can make an
unconfigured install look configured. That rule is applied to storage and AI
only. Authentication is rendered in the wizard but gated by nothing, so **an
operator can finish setup with a sign-in method that is enabled and broken** and
only discover it when a user cannot sign in.

## 2. Users / Personas

- **Application administrator** — an ops/IT lead configuring the deployment from
  `/admin/settings` or the first-run wizard. Needs to see that PKI exists, learn
  what it requires, and switch it on once the infrastructure is ready — without
  a redeploy.
- **Infrastructure engineer** — owns the mTLS-terminating reverse proxy and the
  environment. Owns `PKI_TRUSTED_PROXY_IPS` and should keep owning it; this is a
  security boundary, not an application preference.
- **End user (procurement officer, HR manager, ops lead)** — signs in with a
  smart card or client certificate issued by their organisation, and during a
  phased rollout may still need the password form.

## 3. Goals

- An admin can enable/disable **PKI client certificates** from
  `/admin/settings` → Authentication and from the first-run setup wizard, taking
  effect without a redeploy.
- The PKI option is **always visible** in both surfaces. When the required
  environment is absent it renders **disabled with subtext naming the variable**,
  so an operator can discover the prerequisite from the UI rather than the docs.
- `PKI_TRUSTED_PROXY_IPS` **stays in the environment** and is never editable,
  or readable, from the application.
- `/login` renders a **"Sign in with your certificate"** control when PKI is
  enabled, so PKI and password sign-in can be offered together.
- The server **refuses to leave zero usable methods**, counting PKI as usable
  only when its environment gate is satisfied.
- Existing PKI deployments keep working across the upgrade with no env change.
- **Every enabled sign-in method has a positive test in the setup wizard**, using
  the same Test-button pattern as AI and object storage. Setup cannot complete
  while an enabled method fails its test. Disabled methods are not tested and do
  not gate.
- Each method reports **its own** result, so an operator sees which one is
  broken rather than that "authentication" is broken.

## 4. Non-goals

- **`PKI_TRUSTED_PROXY_IPS` does not move to the database.** See §9 and §12.
- No certificate-revocation (CRL/OCSP) checking — the reverse proxy owns chain
  validation, unchanged.
- No admin UI for certificate subject-DN → role mapping; roles stay in-app
  (ADR-021).
- No precedence rule between PKI and password sign-in. Entra destroys the
  credential row on link (`applyEntraPrecedence`); PKI keeps today's behaviour of
  adopting an existing account and leaving the password working. Deliberate, and
  tracked as future work in §11.
- No change to how certificates are parsed, or to the `x-ssl-client-*` header
  contract with the proxy.
- No multi-tenant / per-organisation auth config — settings stay global.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `AuthConfig` | `packages/domain/src/entities/runtime-config.ts` | existing | Gains `pkiEnabled: boolean` and `pki: { sessionTtlHours: number }`. |
| `isPkiUsable` | `packages/domain/src/entities/runtime-config.ts` | new | Enabled **and** environment gate satisfied. Fail-closed, mirroring `isEntraConfigured`. |
| `isAtLeastOneMethodEnabled` | `packages/domain/src/entities/runtime-config.ts` | existing | Extended to count PKI, but only when usable. |
| `PkiCertAdapter` | `packages/adapters/src/auth/pki-cert-adapter.ts` | existing | Session TTL resolved per request instead of at construction. |
| `admin_system_settings` | `packages/adapters/src/db/schema/wayfinder.ts` | existing | Stores the extended `auth_config` JSON row. No schema change. |
| `EnvDefaults` | `packages/adapters/src/config/runtime-config-defaults.ts` | existing | Gains a `pki` group — `authMethodNamesPki`, `hasTrustedProxies`, `sessionTtlHours`. The single point at which the environment enters config resolution, and it carries a **boolean**, never the addresses. |
| `RuntimeConfigStore.isPkiEnvConfigured()` | `packages/adapters/src/config/runtime-config-store.ts` | new | The one accessor the router, the PKI probe and the lockout guard read the environment gate through. |
| `PKI_TRUSTED_PROXY_IPS` | environment | existing | Unchanged. Read-only precondition. |
| `PKI_SESSION_TTL_HOURS` | environment | existing | Degrades to a legacy seed for `pki.sessionTtlHours`, mirroring `AUTH_METHOD`, so a deployment that tuned the TTL keeps it across the upgrade. |
| `ConnectivityTarget` | `packages/domain/src/entities/connectivity.ts` | existing | Gains `auth-entra`, `auth-pki`, `auth-email-password`. The existing `entra` target is left alone — see §12. |
| `probeAuthEntra` / `probeAuthPki` / `probeAuthEmailPassword` | `packages/adapters/src/health/connectivity-probes.ts` | new | One per method, following `probeAiConnectivity`. |
| `WizardRequirement` | `apps/web/src/components/onboarding/wizard-requirement.tsx` | existing | Reused per enabled method. No component change expected. |

### What each test actually verifies

| Method | Verifies |
| ------ | -------- |
| Entra ID | OIDC discovery document fetched from `{authority}/{tenantId}/v2.0/.well-known/openid-configuration`, then a client-credentials token request. Proves the authority is reachable, the tenant is real, and the client ID + secret are valid. |
| PKI | `PKI_TRUSTED_PROXY_IPS` parses to ≥1 valid address, `pkiEnabled` is true, and the certificate route is mounted. **Configuration only** — see §12. |
| Email + Password | The credential provider is enabled on the built auth instance, and at least one account carries a password. |

## 6. User stories

- As an **admin** on a deployment with no certificate infrastructure, I see PKI
  listed but greyed out, with subtext telling me `PKI_TRUSTED_PROXY_IPS` must be
  set — so I know what to ask my infrastructure team for.
- As an **admin** whose infrastructure team has set that variable, I open
  Authentication, tick **PKI client certificates**, save, and certificate
  sign-in works on the next request.
- As an **admin** running a phased rollout, I leave Email + Password on
  alongside PKI, and my users see both options on `/login`.
- As an **admin** setting up a brand-new install, I see the same PKI row in the
  first-run wizard as in the settings screen.
- As an **admin**, I am stopped with a clear message if I try to save a
  configuration that would leave no usable sign-in method.
- As an **admin** in the first-run wizard, every sign-in method I have turned on
  shows a Test button, and I cannot finish setup until each one passes — so I
  never hand the app to my users with a broken login.
- As an **admin** who mistyped an Entra client secret, the wizard tells me
  *Entra* failed and why, rather than that "authentication" failed.
- As an **end user**, I click "Sign in with your certificate" and my smart card
  signs me in.
- As an **operator upgrading** an existing PKI deployment, my `AUTH_METHOD`
  setting continues to work with no env change.

## 7. Pages / surfaces affected

| Surface | Change |
| ------- | ------ |
| `/admin/settings` → Authentication card | PKI row in three states (absent env / off / on). |
| First-run setup wizard | Inherits the same row — the wizard renders `AuthMethodsCard` directly (`setup-wizard.tsx:193`). One component, not two. Additionally gains a `WizardRequirement` per **enabled** method, joining storage and AI in `requiredReady` (`setup-wizard.tsx:80`). |
| `/admin/settings` → Authentication card | Test buttons per enabled method, driven by the same shared `useConnectivity()` controller the storage and AI cards already use. |
| `/login` | "Sign in with your certificate" control when PKI is enabled. |
| Unauthenticated page requests | Always redirect to `/login`; the `AUTH_METHOD` branch in `middleware.ts` is removed. |
| `/api/auth/cert` | 403 when PKI is not **usable** — disabled, or enabled with the environment gate unsatisfied (replacing a container-presence 404). |

## 8. Database changes

**None.** `auth_config` is a JSON value in the existing `admin_system_settings`
key/value table and is already in `SENSITIVE_SETTING_KEYS`, so it is encrypted at
rest. The new fields are additive.

Rows written before this change will not carry the new keys, so reads must
default them — covered by an explicit acceptance criterion in §10.

## 9. Architectural decisions

Recorded in **[ADR-042 — PKI Under Runtime Auth Config, and Per-Method Sign-In
Verification](../adr/042-pki-under-runtime-auth-config.adr.md)**, which
supersedes ADR-025 §5. That section now carries a pointer to ADR-042 so a reader
of the older ADR is not misled. ADR-042 records:

- The **env/DB split**: the switch and the TTL are application config; the
  trusted-proxy list is a security boundary and stays in the environment.
- **Why the trust anchor does not move.** The PKI trust model is "these headers
  are believed only from these IPs". In the admin UI, a compromised admin
  account could add an attacker-controlled IP and then forge `x-ssl-client-*`
  headers to sign in as any user — an escalation that does not exist while the
  list is env-only. Entra's client secret is safe in the DB because leaking it
  does not grant impersonation; this value is not equivalent.
- **The middleware simplification** and its user-visible consequence (§12).
- That `AUTH_METHOD` and `PKI_SESSION_TTL_HOURS` degrade to **legacy fallbacks**,
  seeding the initial `pkiEnabled` and `pki.sessionTtlHours` defaults and
  deciding nothing thereafter.

## 10. Acceptance criteria

- [ ] `AuthConfig` carries `pkiEnabled` and `pki.sessionTtlHours`, with unit
      tests; `packages/domain` keeps zero external dependencies.
- [ ] `isAtLeastOneMethodEnabled` counts PKI **only** when the environment gate
      is satisfied; a config with PKI as the sole enabled method and no
      `PKI_TRUSTED_PROXY_IPS` is rejected as zero-usable-methods.
- [ ] `RuntimeConfigStore.getAuthConfig()` defaults `pkiEnabled` from
      `AUTH_METHOD` naming PKI and `pki.sessionTtlHours` from
      `PKI_SESSION_TTL_HOURS`, so an existing deployment upgrades with no env
      change, no admin action, and its configured TTL intact.
- [ ] Reading an `auth_config` row written before this change yields the new
      fields at their defaults rather than `undefined`.
- [ ] The environment reaches config resolution only through `EnvDefaults.pki`
      and `RuntimeConfigStore.isPkiEnvConfigured()`; no router, probe or
      component reads `process.env.PKI_TRUSTED_PROXY_IPS` directly.
- [ ] `settings.getAuthConfig` returns `pki.envConfigured` as a boolean and
      **never** returns the trusted-proxy IP values in any form.
- [ ] `settings.setAuthConfig` rejects `pkiEnabled: true` when the environment
      gate is unsatisfied, server-side, independently of the disabled checkbox.
- [ ] `settings.enabledAuthMethods` is callable unauthenticated and reports
      `pki` as enabled only when it is usable.
- [ ] With `PKI_TRUSTED_PROXY_IPS` unset, both `/admin/settings` and the
      first-run wizard show the PKI row with its checkbox disabled and subtext
      naming `PKI_TRUSTED_PROXY_IPS`.
- [ ] With the variable set, the checkbox is enabled, saving persists, and the
      change applies on the next request without a restart.
- [ ] With PKI enabled, `/login` shows "Sign in with your certificate" and a
      certificate presented through the trusted proxy creates a session.
- [ ] With PKI and Email + Password both enabled, `/login` shows both controls.
- [ ] `/api/auth/cert` returns 403 when PKI is disabled in config, **and** when
      it is enabled with `PKI_TRUSTED_PROXY_IPS` absent — the check runs before
      the adapter, so the dropped-variable case is a 403 rather than a 400 from
      the adapter's error path.
- [ ] `PkiCertAdapter` constructs with an empty trusted-proxy list and returns an
      `INFRA_FAILURE` Result per request instead of throwing; no new
      `DomainErrorCode` is introduced.
- [ ] `middleware.ts` no longer reads `AUTH_METHOD`; an unauthenticated request
      to a protected route redirects to `/login` in every configuration.
- [ ] The `AuthMethod` union no longer carries `pki` or `pki-and-email-password`,
      and no code path consults `AUTH_METHOD` beyond seeding the `pkiEnabled`
      default.
- [ ] Boot logs a warning when `AUTH_METHOD` names PKI while the resolved config
      has `pkiEnabled` false.
- [ ] `ConnectivityTarget` gains `auth-entra`, `auth-pki` and
      `auth-email-password`; the existing `entra` (Graph/directory) target is
      unchanged and still probes `User.Read.All`.
- [ ] `probeAuthEntra` succeeds against a valid tenant + client ID + secret
      **without** requiring the `User.Read.All` application permission, and
      fails with a sanitised reason on a bad secret or unknown tenant.
- [ ] `probeAuthPki` succeeds only when `PKI_TRUSTED_PROXY_IPS` parses to at
      least one valid address **and** `pkiEnabled` is true; its success message
      states that configuration was verified, not that a certificate exchange
      completed.
- [ ] `probeAuthEmailPassword` fails when the method is enabled but no account
      carries a password.
- [ ] No probe returns secret material in `message` — asserted per probe.
- [ ] The wizard renders a `WizardRequirement` for each **enabled** method and
      for no disabled method; toggling a method off removes its requirement.
- [ ] `requiredReady` in the wizard is false while any enabled method's test has
      not passed, and the Finish control stays blocked.
- [ ] Each method's failure surfaces its own name and reason, distinguishable
      from the other methods' results.
- [ ] `./validate.sh` passes; version is `0.22.0` in both `VERSION` and root
      `package.json`.

## 11. Out of scope / future work

- A **precedence rule** for PKI, matching `applyEntraPrecedence` — should
  presenting a certificate retire an existing password on that account? A
  product decision, deliberately not bundled here.
- Certificate revocation (CRL/OCSP) checking inside the application.
- Subject-DN → role or group mapping.
- Making the trusted-proxy list configurable by a dedicated, separately-audited
  role (a plausible future answer to §12, but not this phase).
- Per-organisation auth configuration.

## 12. Risks / open questions

- **Behaviour change for existing PKI deployments.** Today a PKI-mode install
  bounces unauthenticated users straight to `/api/auth/cert` and no login page
  is ever seen. After this change they land on `/login` and click once. This is
  the necessary trade for DB-driven config: middleware runs in the Edge runtime
  and cannot read the database, so the decision has to move to a page that can.
  Must appear in the release notes — it is a visible change for an operator who
  did not ask for one.
- **Lockout.** The realistic path is an admin leaving PKI as the only method and
  a later deploy dropping `PKI_TRUSTED_PROXY_IPS`. The §10 criterion on
  `isAtLeastOneMethodEnabled` is the mitigation; its tests should be written
  first, not last.
- **Release-line risk.** This is feature-shaped work targeting
  `release/alpha-2`, which `CLAUDE.md` reserves for stabilisation. The
  maintainer chose that base with the trade-off stated. Recorded so it is a
  decision on the record rather than an oversight.
- **Silent contradiction.** After the upgrade, `AUTH_METHOD` may name PKI while
  the DB says disabled. **Resolved:** boot logs a warning when the two disagree —
  a silent contradiction is harder to debug than a log line. The inert `pki`
  arms of the `AuthMethod` union are deleted in the same pass, so nothing else
  still looks like it selects an auth method from the environment.
- **Depends on the `GET` fix.** The `/login` control is a plain navigation to
  `/api/auth/cert`, which answered 405 until PR #209. This phase must not start
  until #209 is on the base branch.

- **The existing `entra` probe tests the wrong thing for sign-in.**
  `probeEntraConnectivity` calls Microsoft Graph `/users`, which needs the
  `User.Read.All` **application** permission. That permission serves the
  people-directory feature; sign-in needs none of it. An app registration set up
  correctly for sign-in only (`openid`/`profile`/`email`) would **fail** that
  probe while sign-in works perfectly — so reusing it as a wizard gate would
  block setup on a permission the login flow does not use. Hence a separate
  `auth-entra` probe. Worth confirming during build that no deployment currently
  relies on the `entra` badge to mean "sign-in works", because after this change
  it explicitly does not.

- **A PKI test cannot be end-to-end.** The application sits behind the mTLS
  proxy and cannot originate a client-certificate handshake, so `auth-pki`
  verifies configuration only. The wording wherever its result is surfaced must
  not imply certificate sign-in has been proven working — a green tick that
  means less than the operator thinks is worse than no tick at all.

- **Gating setup on auth tests can strand an operator.** If a method's probe
  fails for a transient reason (Entra tenant briefly unreachable), the wizard
  becomes unfinishable. Decide during build whether disabling the offending
  method is a sufficient escape hatch — it should be, since a disabled method
  does not gate — and confirm the UI makes that path obvious.
