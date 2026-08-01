# Phase — PKI under the admin Authentication card

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: 0.22.0 — **MINOR** (new config surface + UI; no DDL)
- **Base branch**: `release/alpha-2` — chosen by the maintainer. See §9 for the
  risk this carries; `/doc-review` should weigh it rather than assume it.
- **PRD**: `docs/development/prd/pki-admin-config.prd.md`
- **ADR**: `docs/development/adr/042-pki-under-runtime-auth-config.adr.md`,
  superseding ADR-025 §5 ("PKI stays as-is").
- **Depends on**:
  - **PR #209** — `/api/auth/cert` must answer `GET` before the login-page
    button can work. It is a plain navigation, not a form post. Do not start
    until #209 is on `release/alpha-2`.
  - ADR-025 (runtime auth config, `RuntimeConfigStore`, `enabledAuthMethods`)
  - ADR-041 (first-run wizard, DB-first config)

## 1. Goal

Let an admin turn PKI / client-certificate sign-in on and off from
`/admin/settings` → Authentication and from the first-run setup wizard, the same
way Entra ID already works — **without** moving the trust anchor out of the
environment.

Today PKI is the only method configured purely by environment. `AUTH_METHOD`
decides three separate things at boot (whether the adapter is built, whether the
route answers, where `middleware.ts` sends unauthenticated requests), so an
operator cannot enable it without a redeploy, and a mixed PKI + password
deployment cannot present both options.

## 2. The split: what moves to the DB, what does not

| Value | Home | Why |
| ----- | ---- | --- |
| `pkiEnabled` | DB (`auth_config`) | An operator switch, like `entraEnabled`. |
| `pki.sessionTtlHours` | DB (`auth_config`) | A preference with no security boundary. |
| `PKI_SESSION_TTL_HOURS` | env, **legacy seed only** | Seeds the DB default so a deployment that tuned the TTL keeps it across the upgrade, exactly as `AUTH_METHOD` seeds `pkiEnabled` (§4). It stays in `env.ts`, `.env.example` and `restart.sh`; it decides nothing once the row exists. |
| `PKI_TRUSTED_PROXY_IPS` | **env, unchanged** | The trust anchor. |

**`PKI_TRUSTED_PROXY_IPS` deliberately stays in the environment.** The whole PKI
trust model is "these headers are believed only from these IPs". Move that list
into the admin UI and a compromised admin account can add an attacker-controlled
IP, then forge `x-ssl-client-*` from it and sign in as anyone — a privilege
escalation that does not exist today. Entra's client secret is safe in the DB
because leaking it does not grant impersonation; the proxy list is a different
class of value.

So the env var becomes the **precondition** and the DB row becomes the
**switch** — which is exactly what the greyed-out UI in §3 expresses.

## 3. UI behaviour (the requirement driving this phase)

`AuthMethodsCard` is rendered by both `/admin/settings` and the first-run wizard
(`setup-wizard.tsx:193`), so one component change covers both surfaces. Do not
fork it.

The PKI row is **always listed**, in both surfaces, in all three states:

| Env state | DB state | Row renders as |
| --------- | -------- | -------------- |
| `PKI_TRUSTED_PROXY_IPS` unset | — | Listed, checkbox **disabled**, subtext: *"Requires `PKI_TRUSTED_PROXY_IPS` to be set in the environment before this can be enabled."* |
| set | `pkiEnabled: false` | Listed, checkbox enabled, unchecked |
| set | `pkiEnabled: true` | Listed, checked; summary shows session TTL |

Never hide the row. An operator who cannot see the option cannot discover what
to set — the greyed-out state with the variable named in the subtext *is* the
documentation.

The disabled state must be enforced server-side too, not only in the checkbox:
`setAuthConfig` rejects `pkiEnabled: true` when the env gate is unsatisfied. A
disabled input is a UI affordance, not an authorisation check.

## 4. What is built

| Layer | File | Change |
| ----- | ---- | ------ |
| domain | `entities/runtime-config.ts` | `AuthConfig` gains `pkiEnabled: boolean` and `pki: { sessionTtlHours: number }`. Add `isPkiUsable(config, envHasTrustedProxies)`. Extend `isAtLeastOneMethodEnabled` — see §5. |
| adapters | `config/runtime-config-defaults.ts` | **The env gate's single entry point.** `EnvDefaults` gains `pki: { authMethodNamesPki: boolean; hasTrustedProxies: boolean; sessionTtlHours: number }`. `buildEnvAuthConfig` seeds `pkiEnabled` from `authMethodNamesPki` and `pki.sessionTtlHours` from the env value, so existing installs come up unchanged. `parseAuthConfig` defaults both new keys for rows written before this phase (§6). Note the boolean, not the IP list: `EnvDefaults` never carries the addresses. |
| adapters | `config/runtime-config-store.ts` | Expose `isPkiEnvConfigured(): boolean` — the one accessor the router, the probe and the lockout guard read the gate through. Extend `redactAuth`. |
| adapters | `auth/pki-cert-adapter.ts` | Resolve `sessionTtlHours` per request from the store. **Remove the constructor throw** on an empty proxy list; return an `INFRA_FAILURE` Result instead — an enabled-but-ungated PKI is a deployment fault, not caller input, and `INFRA_FAILURE` already maps to a 500-class answer (`trpc-errors.ts`). Do **not** add a new `DomainErrorCode`. |
| apps/web | `lib/container.ts` | Build `PkiCertAdapter` unconditionally — config decides whether it answers, not wiring. Populate `EnvDefaults.pki` from `AUTH_METHOD`, `PKI_TRUSTED_PROXY_IPS` and `PKI_SESSION_TTL_HOURS`. Delete the `AuthMethod` switch arms for PKI (§4b). Log the boot warning (§9.3). |
| adapters | `auth/better-auth.ts` | **Collapse the `AuthMethod` union** to `email-password` / `google-oauth` / `other` (§4b). |
| apps/web | `middleware.ts` | **Delete the `AUTH_METHOD` branch.** Always redirect to `/login`. Middleware stops reading auth config entirely. |
| apps/web | `app/api/auth/cert/route.ts` | Return **403** when PKI is not **usable** — disabled *or* env-ungated — replacing the container-presence 404. The check runs before the adapter is called, so the dropped-`PKI_TRUSTED_PROXY_IPS` case answers 403 rather than falling through to the adapter's error. Map the adapter's `INFRA_FAILURE` explicitly too; the route currently special-cases only `UNAUTHORIZED` and sends everything else to 400. |
| apps/web | `app/(auth)/login/page.tsx` | Render "Sign in with your certificate" → `/api/auth/cert?redirect=…` when `enabledAuthMethods.pki`. |
| apps/web | `server/routers/settings.ts` | Extend `authConfigInputSchema`; `getAuthConfig` returns `pki.envConfigured: boolean`; `enabledAuthMethods` gains `pki`. Update the existing `isAtLeastOneMethodEnabled` call (`setAuthConfig`) for the new signature (§5). |
| apps/web | `components/settings/auth-methods-card.tsx` | The three-state PKI row from §3, plus a Test button per enabled method. The card takes a `connectivity: ConnectivityController` prop, as `AiProviderCard` already does; **both** call sites pass it — the settings page and the wizard. |
| domain | `entities/connectivity.ts` | `ConnectivityTarget` gains `auth-entra`, `auth-pki`, `auth-email-password`. Leave the existing `entra` target alone (§4a). |
| adapters | `health/connectivity-probes.ts` | `probeAuthEntra`, `probeAuthPki`, `probeAuthEmailPassword`. |
| adapters | `health/composite-connectivity-tester.ts` | Route the three new targets, and give it the deps they need: the `isPkiEnvConfigured()` accessor for `auth-pki`, and an accounts-with-password lookup for `auth-email-password`. |
| apps/web | `components/onboarding/setup-wizard.tsx` | A `WizardRequirement` per **enabled** method; extend `requiredReady` (currently storage + AI only, line 80). |

## 4a. Per-method sign-in tests

ADR-041 §2 requires a live Test before a wizard step counts as done. That rule
is applied to storage and AI only — authentication renders ungated, so setup can
finish with an enabled, broken sign-in method. This phase closes that.

One target per method, not one aggregate: the operator needs to know *which*
method failed.

| Target | Verifies |
| ------ | -------- |
| `auth-entra` | OIDC discovery doc from `{authority}/{tenantId}/v2.0/.well-known/openid-configuration`, then a client-credentials token request. |
| `auth-pki` | `PKI_TRUSTED_PROXY_IPS` parses to ≥1 valid address, `pkiEnabled` true, cert route mounted. |
| `auth-email-password` | Credential provider enabled on the built instance, and ≥1 account carries a password. |

**Do not reuse the existing `entra` target.** It probes Graph `/users` and needs
the `User.Read.All` application permission, which serves the people-directory
feature — sign-in needs none of it. A registration configured correctly for
sign-in only would fail it while sign-in works. Gating the wizard on that probe
would block setup on a permission the login flow never uses.

**`auth-pki` must not overstate itself.** The app is behind the proxy and cannot
originate a certificate handshake, so this is a configuration check. Its success
message says so.

Only **enabled** methods are tested and gate. That is also the escape hatch when
a probe fails transiently: turning the method off unblocks the wizard.

`getAuthConfig` returns **only the boolean** `envConfigured` — never the IP list
itself. The client has no business knowing the trust anchor's contents, and an
admin-scoped tRPC response is still a network payload.

## 4b. What `AUTH_METHOD` stops deciding

`AuthMethod` (`better-auth.ts:10`) is a discriminated union with `pki` and
`pki-and-email-password` arms, built from `AUTH_METHOD` in `container.ts` and
passed to `createAuth`. Once the adapter is constructed unconditionally and
middleware no longer branches, those two arms gate nothing — `createAuth` only
ever tests `type === "google-oauth"`.

Delete them. The union becomes `email-password` / `google-oauth` / `other`, the
matching `container.ts` switch arms go, and the two `better-auth.test.ts` cases
asserting the PKI variants go with them. Leaving inert variants that still *look*
like they select an auth method is the same silent contradiction §9.3 is about,
and `CLAUDE.md` forbids dead code outright.

After this, `AUTH_METHOD` and `PKI_SESSION_TTL_HOURS` seed two DB defaults on
first read and are consulted nowhere else.

## 5. The lockout guard (sharp edge — get this right first)

`isAtLeastOneMethodEnabled` currently reads `emailPasswordEnabled ||
entraEnabled`. Once PKI can be the sole method it must count — but only when
**usable**, i.e. the env gate is satisfied.

The failure this prevents: an admin disables email + Entra, leaves PKI on, and
the next deploy ships without `PKI_TRUSTED_PROXY_IPS`. Every method is now
unusable and nobody can sign in to fix it. So the guard takes env state as an
argument and treats an enabled-but-ungated PKI as **not** a method.

**Signature:** a required second parameter —
`isAtLeastOneMethodEnabled(config, envHasTrustedProxies)`. Not a defaulted one.
Forgetting to pass the env state *is* the lockout bug, so it should be a compile
error, not a quiet fail-closed answer. One guard, one truth: no parallel
`isAtLeastOneUsableMethod` alongside it. The existing caller in `setAuthConfig`
and the existing unit tests are updated as part of step 1.

Consequence to implement deliberately: `setAuthConfig` must refuse a save that
would leave zero *usable* methods, with a message naming what is missing.

## 6. Database changes

**None.** `auth_config` is a JSON value in `admin_system_settings`, already in
`SENSITIVE_SETTING_KEYS` (encrypted at rest). Additive fields on an existing
JSON blob need no DDL. Reads of rows written before this phase must tolerate the
absent keys and default them — cover it with a test.

## 7. ADR — written

ADR-025 §5 stated "The PKI / client-certificate path remains env-configured and
outside the admin card this phase… Bringing PKI under the same card is future
work." This phase *is* that work, so §5 could not be left standing as current
guidance.

**[ADR-042 — PKI Under Runtime Auth Config, and Per-Method Sign-In
Verification](../adr/042-pki-under-runtime-auth-config.adr.md)** supersedes it,
recording the env/DB split (§2), why the trust anchor does not move, the
middleware simplification (§8), and the per-method wizard tests (§4a).

ADR-025 §5 was **not** rewritten — it carries a pointer to ADR-042 and keeps its
original text, so the reasoning that made the deferral correct at the time stays
readable.

## 8. Behaviour change for existing PKI deployments

Today, a PKI-mode install bounces unauthenticated users straight to
`/api/auth/cert`; they never see a login page. After this phase they land on
`/login` and click "Sign in with your certificate" — one extra click.

This is the deliberate trade for making the DB the source of truth: middleware
runs in the Edge runtime and cannot read config, so the decision has to move to
a page that can. It also unlocks the mixed PKI + password deployment that is
impossible today.

Call this out in the release notes. It is a visible change for an operator who
did not ask for one.

## 9. Risks / open questions

1. **Release-line risk.** This deletes a middleware branch and changes the
   sign-in flow for every existing PKI install. `CLAUDE.md` reserves
   `release/alpha-2` for stabilisation and routes features to `main`. The
   maintainer chose `release/alpha-2` with that trade-off stated; recorded here
   so `/doc-review` can weigh it rather than rediscover it.
2. **Lockout.** §5 is the mitigation. Treat its tests as the first thing
   written, not the last.
3. **`AUTH_METHOD` becomes legacy.** It seeds the initial `pkiEnabled` default
   and nothing else (§4b). **Decided:** `container.ts` logs a warning at boot when
   `AUTH_METHOD` names PKI while the resolved config has `pkiEnabled` false — a
   silent contradiction is worse than a log line. One line, no behaviour change.
4. **Wizard "configured" semantics.** `resolveRequirement(configured, status)`
   maps a configured target with no live probe to `unsupported`, which counts as
   satisfied. All three auth probes in §4a return a real ok/failed status, so
   none should land there — if one does, the gate silently passes. Assert the
   status explicitly in tests rather than trusting the default.
5. **Gating setup on auth tests can strand an operator.** A transient Entra
   outage makes the wizard unfinishable. Disabling the method is the escape
   hatch, since only enabled methods gate — confirm the UI makes that obvious
   rather than leaving the operator stuck on a red badge.
6. **The `entra` badge changes meaning.** After this phase, `entra` (Graph)
   and `auth-entra` (sign-in) answer different questions. Anyone reading the old
   badge as "sign-in works" was already wrong, but the split makes it explicit —
   check nothing in the UI implies otherwise.

## 10. Implementation order (tests first)

1. Domain: `AuthConfig` fields, `isPkiUsable`, and the §5 lockout guard — with
   its new second parameter, its `setAuthConfig` caller, and its existing tests
   updated in the same step.
2. `EnvDefaults.pki` + `buildEnvAuthConfig` / `parseAuthConfig` defaulting (incl.
   the pre-existing-row case), then `isPkiEnvConfigured()` and redaction on
   `RuntimeConfigStore`. Everything downstream reads the gate through that
   accessor, so it lands before its consumers.
3. `PkiCertAdapter` per-request config; drop the constructor throw for an
   `INFRA_FAILURE` Result.
4. Router: schema, `envConfigured`, `enabledAuthMethods.pki`, server-side
   rejection of an ungated enable.
5. `AuthMethodsCard` three-state row (§3).
6. `middleware.ts` simplification + `/login` certificate button + route 403 on
   not-usable; `AuthMethod` union collapse and the boot warning (§4b, §9.3).
7. Connectivity targets + the three probes (§4a), each with a test asserting no
   secret material reaches `message`.
8. Wizard requirements per enabled method; extend `requiredReady`.
9. E2E: `apps/web/e2e/enhance-pki-admin-config.spec.ts` — greyed-out with
   subtext when the env gate is unset; enabled and toggleable when set; the
   certificate button appears on `/login`; sign-in completes through the mock
   proxy at `:4001/pki` (PR #209); the wizard blocks Finish while an enabled
   method's test has not passed, and unblocks when that method is disabled.

Step 0 is **write ADR-042** — done; `docs/development/adr/042-pki-under-runtime-auth-config.adr.md`.
